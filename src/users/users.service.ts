import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ErrorCode } from '../common/error-codes.enum';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SubmitOnboardingDto } from './dto/onboarding.dto';
import { User } from '@prisma/client';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
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
    const profile = await this.prisma.$transaction(async (tx) => {
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
          background: dto.background ?? undefined,
          goals: dto.goals ?? undefined,
          interests: dto.interests ?? undefined,
          onboardingCompleted: true,
        },
      });

      return updatedProfile;
    });

    this.analyticsService.capture(userId, 'onboarding_completed');

    return profile;
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
