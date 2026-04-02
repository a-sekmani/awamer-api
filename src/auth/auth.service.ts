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
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from '@prisma/client';

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const VERIFICATION_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const VERIFICATION_RATE_LIMIT_MAX = 3;
const VERIFICATION_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const defaultPlan = await this.prisma.subscriptionPlan.findFirst({
      where: { isDefault: true },
    });

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name: dto.name,
          email,
          passwordHash,
          country: dto.country ?? null,
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

    const { accessToken, refreshToken } = await this.generateTokens(user);

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
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is inactive or suspended');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken, refreshToken } = await this.generateTokens(user);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  async refresh(refreshTokenFromCookie: string) {
    if (!refreshTokenFromCookie) {
      throw new UnauthorizedException('Refresh token is required');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshTokenFromCookie, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is inactive or suspended');
    }

    const tokenValid = await bcrypt.compare(
      refreshTokenFromCookie,
      user.refreshToken,
    );
    if (!tokenValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const { accessToken, refreshToken } = await this.generateTokens(user);

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();

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
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        refreshToken: null,
      },
    });
  }

  async sendVerificationCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    const windowStart = new Date(
      Date.now() - VERIFICATION_RATE_LIMIT_WINDOW_MS,
    );
    const recentCount = await this.prisma.emailVerification.count({
      where: {
        userId,
        createdAt: { gte: windowStart },
      },
    });
    if (recentCount >= VERIFICATION_RATE_LIMIT_MAX) {
      throw new HttpException(
        'Too many verification requests. Please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MS);

    await this.prisma.$transaction([
      this.prisma.emailVerification.updateMany({
        where: { userId, used: false },
        data: { used: true },
      }),
      this.prisma.emailVerification.create({
        data: {
          userId,
          code,
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

    if (verification.code !== code) {
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

    return { emailVerified: true };
  }

  async getLatestCodeByEmail(email: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const verification = await this.prisma.emailVerification.findFirst({
      where: { userId: user.id, used: false },
      orderBy: { createdAt: 'desc' },
      select: { code: true },
    });
    if (!verification) {
      throw new BadRequestException('No verification code found');
    }

    return verification.code;
  }

  private async generateTokens(user: User) {
    const payload: JwtPayload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
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
