import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { GeoipService } from '../common/geoip.service';
import { ErrorCode } from '../common/error-codes.enum';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User, RateLimitType } from '@prisma/client';

const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 60 seconds per email
const RATE_LIMIT_HOURLY_MAX = 5; // 5 per hour per email
const RATE_LIMIT_DAILY_MAX_PER_IP = 10; // 10 per 24 hours per IP
const LOGIN_MAX_FAILED_ATTEMPTS = 10;
const LOGIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const VERIFICATION_CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const VERIFICATION_MAX_ATTEMPTS = 5;

const REFRESH_TOKEN_EXPIRY_DEFAULT = '7d';
const REFRESH_TOKEN_EXPIRY_REMEMBER = '30d';
const COOKIE_MAX_AGE_DEFAULT = 7 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE_REMEMBER = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly geoipService: GeoipService,
  ) {}

  async register(dto: RegisterDto, ip?: string) {
    const email = dto.email;

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Email already registered',
        errorCode: ErrorCode.EMAIL_ALREADY_EXISTS,
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const detectedCountry = ip ? this.geoipService.getCountryFromIp(ip) : null;

    const defaultPlan = await this.prisma.subscriptionPlan.findFirst({
      where: { isDefault: true },
    });

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name: dto.name,
          email,
          passwordHash,
          country: dto.country ?? detectedCountry ?? null,
          registrationIp: ip ?? null,
          detectedCountry: detectedCountry ?? null,
        },
      });

      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          onboardingCompleted: false,
        },
      });

      await tx.userRole.create({
        data: {
          userId: newUser.id,
          role: 'LEARNER',
        },
      });

      if (defaultPlan) {
        await tx.subscription.create({
          data: {
            userId: newUser.id,
            planId: defaultPlan.id,
            status: 'ACTIVE',
          },
        });
      }

      return newUser;
    });

    const rememberMe = dto.rememberMe ?? false;
    const { accessToken, refreshToken } = await this.generateTokens(user, rememberMe);

    try {
      await this.sendVerificationCode(user.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send verification code during registration: ${message}`,
      );
    }

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
      cookieMaxAge: rememberMe ? COOKIE_MAX_AGE_REMEMBER : COOKIE_MAX_AGE_DEFAULT,
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw new UnauthorizedException({
        message: 'Invalid credentials',
        errorCode: ErrorCode.INVALID_CREDENTIALS,
      });
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        message: 'Invalid credentials',
        errorCode: ErrorCode.INVALID_CREDENTIALS,
      });
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        message: 'Invalid credentials',
        errorCode: ErrorCode.INVALID_CREDENTIALS,
      });
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      const newFailedAttempts = user.failedLoginAttempts + 1;
      const lockout =
        newFailedAttempts >= LOGIN_MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOGIN_LOCKOUT_DURATION_MS)
          : undefined;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newFailedAttempts,
          ...(lockout && { lockedUntil: lockout }),
        },
      });

      throw new UnauthorizedException({
        message: 'Invalid credentials',
        errorCode: ErrorCode.INVALID_CREDENTIALS,
      });
    }

    const rememberMe = dto.rememberMe ?? false;
    const { accessToken, refreshToken } = await this.generateTokens(user, rememberMe);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
      cookieMaxAge: rememberMe ? COOKIE_MAX_AGE_REMEMBER : COOKIE_MAX_AGE_DEFAULT,
    };
  }

  async refresh(refreshTokenFromCookie: string) {
    if (!refreshTokenFromCookie) {
      throw new UnauthorizedException({
        message: 'Invalid session',
        errorCode: ErrorCode.INVALID_SESSION,
      });
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshTokenFromCookie, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        message: 'Invalid session',
        errorCode: ErrorCode.INVALID_SESSION,
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException({
        message: 'Invalid session',
        errorCode: ErrorCode.INVALID_SESSION,
      });
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        message: 'Invalid session',
        errorCode: ErrorCode.INVALID_SESSION,
      });
    }

    const tokenValid = await bcrypt.compare(
      refreshTokenFromCookie,
      user.refreshToken,
    );
    if (!tokenValid) {
      throw new UnauthorizedException({
        message: 'Invalid session',
        errorCode: ErrorCode.INVALID_SESSION,
      });
    }

    // Maintain the original remember-me preference from the token's TTL
    const wasRememberMe = payload.exp && payload.iat
      ? (payload.exp - payload.iat) > 8 * 24 * 60 * 60 // > 8 days means it was 30d
      : false;

    const { accessToken, refreshToken } = await this.generateTokens(user, wasRememberMe);

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
      cookieMaxAge: wasRememberMe ? COOKIE_MAX_AGE_REMEMBER : COOKIE_MAX_AGE_DEFAULT,
    };
  }

  async logout(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto, ip: string) {
    const email = dto.email;

    await this.checkRateLimit(email, ip, RateLimitType.FORGOT_PASSWORD);

    await this.prisma.rateLimitedRequest.create({
      data: { email, ip, type: RateLimitType.FORGOT_PASSWORD },
    });

    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
      });
      if (!user) {
        return;
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS),
        },
      });

      await this.mailService.sendPasswordResetEmail(
        user.email,
        resetToken,
        user.name,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Forgot password error: ${message}`);
    }
  }

  private async checkRateLimit(
    email: string,
    ip: string,
    type: RateLimitType,
  ): Promise<void> {
    const now = new Date();

    // 1. Per-email cooldown: 1 request every 60 seconds
    const cooldownStart = new Date(now.getTime() - RATE_LIMIT_COOLDOWN_MS);
    const recentRequest =
      await this.prisma.rateLimitedRequest.findFirst({
        where: { type, email, createdAt: { gte: cooldownStart } },
        orderBy: { createdAt: 'desc' },
      });

    if (recentRequest) {
      const retryAfter = Math.ceil(
        (recentRequest.createdAt.getTime() +
          RATE_LIMIT_COOLDOWN_MS -
          now.getTime()) /
          1000,
      );
      throw new HttpException(
        {
          message: 'Too many requests. Please try again later.',
          errorCode: ErrorCode.RATE_LIMIT_EXCEEDED,
          retryAfter: Math.max(retryAfter, 1),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Per-email hourly limit: 5 requests per hour
    const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
    const hourlyCount = await this.prisma.rateLimitedRequest.count({
      where: { type, email, createdAt: { gte: hourStart } },
    });

    if (hourlyCount >= RATE_LIMIT_HOURLY_MAX) {
      const oldestInWindow =
        await this.prisma.rateLimitedRequest.findFirst({
          where: { type, email, createdAt: { gte: hourStart } },
          orderBy: { createdAt: 'asc' },
        });
      const retryAfter = oldestInWindow
        ? Math.ceil(
            (oldestInWindow.createdAt.getTime() +
              60 * 60 * 1000 -
              now.getTime()) /
              1000,
          )
        : 3600;
      throw new HttpException(
        {
          message: 'Too many requests. Please try again later.',
          errorCode: ErrorCode.RATE_LIMIT_EXCEEDED,
          retryAfter: Math.max(retryAfter, 1),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 3. Per-IP daily limit: 10 requests per 24 hours
    const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dailyCount = await this.prisma.rateLimitedRequest.count({
      where: { type, ip, createdAt: { gte: dayStart } },
    });

    if (dailyCount >= RATE_LIMIT_DAILY_MAX_PER_IP) {
      const oldestInWindow =
        await this.prisma.rateLimitedRequest.findFirst({
          where: { type, ip, createdAt: { gte: dayStart } },
          orderBy: { createdAt: 'asc' },
        });
      const retryAfter = oldestInWindow
        ? Math.ceil(
            (oldestInWindow.createdAt.getTime() +
              24 * 60 * 60 * 1000 -
              now.getTime()) /
              1000,
          )
        : 86400;
      throw new HttpException(
        {
          message: 'Too many requests. Please try again later.',
          errorCode: ErrorCode.RATE_LIMIT_EXCEEDED,
          retryAfter: Math.max(retryAfter, 1),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async verifyResetToken(token: string) {
    if (!token) {
      throw new BadRequestException({
        message: 'Invalid or expired reset token',
        errorCode: ErrorCode.INVALID_RESET_TOKEN,
      });
    }

    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException({
        message: 'Invalid or expired reset token',
        errorCode: ErrorCode.INVALID_RESET_TOKEN,
      });
    }

    return { valid: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const hashedToken = crypto
      .createHash('sha256')
      .update(dto.token)
      .digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException({
        message: 'Invalid or expired reset token',
        errorCode: ErrorCode.INVALID_RESET_TOKEN,
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetToken: null,
          passwordResetExpires: null,
          refreshToken: null,
        },
      }),
    ]);
  }

  async sendVerificationCode(userId: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    if (ip) {
      await this.checkRateLimit(
        user.email,
        ip,
        RateLimitType.VERIFICATION_RESEND,
      );

      await this.prisma.rateLimitedRequest.create({
        data: {
          email: user.email,
          ip,
          type: RateLimitType.VERIFICATION_RESEND,
        },
      });
    }

    const code = String(crypto.randomInt(100000, 999999));
    const hashedCode = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MS);

    await this.prisma.$transaction([
      this.prisma.emailVerification.updateMany({
        where: { userId, used: false },
        data: { used: true },
      }),
      this.prisma.emailVerification.create({
        data: {
          userId,
          code: hashedCode,
          expiresAt,
        },
      }),
    ]);

    await this.mailService.sendVerificationEmail(user.email, code, user.name);
  }

  async verifyEmail(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    const verification = await this.prisma.emailVerification.findFirst({
      where: {
        userId,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      throw new BadRequestException(
        'No valid verification code found. Please request a new one',
      );
    }

    if (verification.attempts >= VERIFICATION_MAX_ATTEMPTS) {
      await this.prisma.emailVerification.update({
        where: { id: verification.id },
        data: { used: true },
      });
      throw new BadRequestException(
        'Verification code has been invalidated due to too many attempts. Please request a new one',
      );
    }

    const hashedInput = crypto.createHash('sha256').update(code).digest('hex');
    const codeMatch =
      verification.code.length === hashedInput.length &&
      crypto.timingSafeEqual(
        Buffer.from(verification.code, 'hex'),
        Buffer.from(hashedInput, 'hex'),
      );

    if (!codeMatch) {
      const newAttempts = verification.attempts + 1;
      await this.prisma.emailVerification.update({
        where: { id: verification.id },
        data: {
          attempts: newAttempts,
          used: newAttempts >= VERIFICATION_MAX_ATTEMPTS ? true : undefined,
        },
      });
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { id: verification.id },
        data: { used: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      }),
    ]);

    const updatedUser = { ...user, emailVerified: true };
    const { accessToken, refreshToken } = await this.generateTokens(updatedUser);

    return { emailVerified: true, accessToken, refreshToken };
  }

  private async generateTokens(user: User, rememberMe = false) {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      select: { role: true },
    });
    const roles = userRoles.map((r) => r.role);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      roles,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: rememberMe ? REFRESH_TOKEN_EXPIRY_REMEMBER : REFRESH_TOKEN_EXPIRY_DEFAULT,
    });

    const hashedRefreshToken = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken },
    });

    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      country: user.country,
      locale: user.locale,
      status: user.status,
      emailVerified: user.emailVerified,
      requiresVerification: !user.emailVerified,
    };
  }
}
