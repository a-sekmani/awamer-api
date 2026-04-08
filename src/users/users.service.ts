import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ErrorCode } from '../common/error-codes.enum';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  SubmitOnboardingDto,
  VALID_BACKGROUNDS,
  VALID_INTERESTS,
  VALID_GOALS,
  MIN_INTERESTS,
  MAX_INTERESTS,
} from './dto/onboarding.dto';
import { User } from '@prisma/client';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_EXPIRY_DEFAULT = '7d';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        roles: true,
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const role = user.roles[0]?.role?.toLowerCase() ?? 'learner';
    const subscription = user.subscriptions[0] ?? null;

    return {
      user: this.sanitizeUser(user),
      profile: user.profile,
      role,
      subscription,
    };
  }

  async updateUser(userId: string, dto: UpdateUserDto) {
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });

    return this.sanitizeUser(updatedUser);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updatedProfile = await this.prisma.userProfile.update({
      where: { userId },
      data: dto,
    });

    return updatedProfile;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const isValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isValid) {
      throw new BadRequestException({
        message: 'Current password is incorrect',
        errorCode: ErrorCode.WRONG_CURRENT_PASSWORD,
      });
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        refreshToken: null,
      },
    });
  }

  async submitOnboarding(userId: string, dto: SubmitOnboardingDto) {
    // 1. Check if already completed
    const existingProfile = await this.prisma.userProfile.findUnique({
      where: { userId },
    });
    if (existingProfile?.onboardingCompleted) {
      throw new BadRequestException({
        message: 'Onboarding already completed',
        errorCode: ErrorCode.ONBOARDING_ALREADY_COMPLETED,
      });
    }

    // 2. Validate all 3 required keys are present
    const keys = dto.responses.map((r) => r.questionKey);
    for (const required of ['background', 'interests', 'goals'] as const) {
      if (!keys.includes(required)) {
        throw new BadRequestException(
          `Missing required questionKey: ${required}`,
        );
      }
    }

    const backgroundResponse = dto.responses.find(
      (r) => r.questionKey === 'background',
    )!;
    const interestsResponse = dto.responses.find(
      (r) => r.questionKey === 'interests',
    )!;
    const goalsResponse = dto.responses.find(
      (r) => r.questionKey === 'goals',
    )!;

    // 3. Validate stepNumber consistency
    if (backgroundResponse.stepNumber !== 1) {
      throw new BadRequestException(
        'background must have stepNumber 1',
      );
    }
    if (interestsResponse.stepNumber !== 2) {
      throw new BadRequestException(
        'interests must have stepNumber 2',
      );
    }
    if (goalsResponse.stepNumber !== 3) {
      throw new BadRequestException('goals must have stepNumber 3');
    }

    // 4. Validate background answer
    if (
      !(VALID_BACKGROUNDS as readonly string[]).includes(
        backgroundResponse.answer,
      )
    ) {
      throw new BadRequestException({
        message: 'Invalid background value',
        errorCode: ErrorCode.INVALID_BACKGROUND,
        field: 'background',
      });
    }

    // 5. Validate goals answer
    if (
      !(VALID_GOALS as readonly string[]).includes(goalsResponse.answer)
    ) {
      throw new BadRequestException({
        message: 'Invalid goals value',
        errorCode: ErrorCode.INVALID_GOALS,
        field: 'goals',
      });
    }

    // 6. Validate interests answer
    let interestsArray: unknown;
    try {
      interestsArray = JSON.parse(interestsResponse.answer);
    } catch {
      throw new BadRequestException({
        message: 'interests answer must be a valid JSON array',
        errorCode: ErrorCode.INTERESTS_PARSE_ERROR,
        field: 'interests',
      });
    }

    if (!Array.isArray(interestsArray)) {
      throw new BadRequestException({
        message: 'interests answer must be a JSON array',
        errorCode: ErrorCode.INTERESTS_PARSE_ERROR,
        field: 'interests',
      });
    }

    if (
      interestsArray.length < MIN_INTERESTS ||
      interestsArray.length > MAX_INTERESTS
    ) {
      throw new BadRequestException({
        message: `interests must contain between ${MIN_INTERESTS} and ${MAX_INTERESTS} items`,
        errorCode: ErrorCode.INTERESTS_COUNT_INVALID,
        field: 'interests',
      });
    }

    for (const item of interestsArray) {
      if (
        typeof item !== 'string' ||
        !(VALID_INTERESTS as readonly string[]).includes(item)
      ) {
        throw new BadRequestException({
          message: 'Invalid interest value',
          errorCode: ErrorCode.INVALID_INTERESTS,
          field: 'interests',
        });
      }
    }

    const uniqueInterests = new Set(interestsArray);
    if (uniqueInterests.size !== interestsArray.length) {
      throw new BadRequestException({
        message: 'interests must not contain duplicate values',
        errorCode: ErrorCode.INVALID_INTERESTS,
        field: 'interests',
      });
    }

    // 7. Transaction: delete old + create new + update profile
    const profile = await this.prisma.$transaction(async (tx) => {
      await tx.onboardingResponse.deleteMany({
        where: { userId },
      });

      await tx.onboardingResponse.createMany({
        data: dto.responses.map((r) => ({
          userId,
          questionKey: r.questionKey,
          answer: r.answer,
          stepNumber: r.stepNumber,
        })),
      });

      const updatedProfile = await tx.userProfile.update({
        where: { userId },
        data: {
          background: backgroundResponse.answer,
          goals: goalsResponse.answer,
          interests: interestsResponse.answer,
          onboardingCompleted: true,
        },
      });

      return updatedProfile;
    });

    // 8. Analytics
    this.analyticsService.capture(userId, 'onboarding_completed');

    // 9. Reissue tokens with onboardingCompleted: true
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });

    const roles = user!.roles.map((r) => r.role);
    const payload: JwtPayload = {
      sub: userId,
      email: user!.email,
      emailVerified: user!.emailVerified,
      onboardingCompleted: true,
      roles,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: REFRESH_TOKEN_EXPIRY_DEFAULT,
    });

    const hashedRefreshToken = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedRefreshToken },
    });

    return { profile, accessToken, refreshToken };
  }

  async getOnboardingStatus(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
    });

    const responses = await this.prisma.onboardingResponse.findMany({
      where: { userId },
      orderBy: { stepNumber: 'asc' },
    });

    return {
      completed: profile?.onboardingCompleted ?? false,
      responses,
    };
  }

  private sanitizeUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      country: user.country,
      locale: user.locale,
      status: user.status,
    };
  }
}
