import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ErrorCode } from '../common/error-codes.enum';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_value'),
  compare: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require('bcryptjs');

const mockProfile = {
  id: 'profile-uuid',
  userId: 'user-uuid',
  displayName: 'Ahmad',
  avatarUrl: 'https://example.com/avatar.png',
  background: 'Engineer',
  goals: 'Learn AI',
  interests: 'ML, Cloud',
  preferredLanguage: 'ar',
  onboardingCompleted: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPlan = {
  id: 'plan-uuid',
  name: 'Free',
  billingCycle: 'FREE',
  price: 0,
  currency: 'USD',
  durationDays: 0,
  isDefault: true,
  stripePriceId: null,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSubscription = {
  id: 'sub-uuid',
  userId: 'user-uuid',
  planId: 'plan-uuid',
  status: 'ACTIVE',
  stripeSubscriptionId: null,
  stripeCustomerId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  plan: mockPlan,
};

const mockUser = {
  id: 'user-uuid',
  name: 'Test User',
  email: 'test@example.com',
  passwordHash: 'hashed_pw',
  country: 'SA',
  locale: 'ar',
  status: 'ACTIVE',
  refreshToken: 'hashed_refresh',
  passwordResetToken: null,
  passwordResetExpires: null,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: mockProfile,
  roles: [{ id: 'role-uuid', userId: 'user-uuid', role: 'LEARNER', createdAt: new Date() }],
  subscriptions: [mockSubscription],
};

const mockTx = {
  onboardingResponse: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
  userProfile: { update: jest.fn().mockResolvedValue({ ...mockProfile, onboardingCompleted: true }) },
};

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  userProfile: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  onboardingResponse: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((cb) => cb(mockTx)),
};

const mockAnalyticsService = {
  capture: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getMe
  // =========================================================================
  describe('getMe', () => {
    it('should return user, profile, role, and subscription with plan', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getMe('user-uuid');

      expect(result.user).toBeDefined();
      expect(result.user.id).toBe('user-uuid');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.profile).toBeDefined();
      expect(result.role).toBe('learner');
      expect(result.subscription).toBeDefined();
      expect(result.subscription.plan).toBeDefined();
      expect(result.subscription.plan.name).toBe('Free');
    });

    it('should throw BadRequestException if user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('nonexistent')).rejects.toThrow(
        BadRequestException,
      );
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.getMe('nonexistent')).rejects.toThrow(
        'User not found',
      );
    });
  });

  // =========================================================================
  // updateUser
  // =========================================================================
  describe('updateUser', () => {
    it('should update name only', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        ...mockUser,
        name: 'New Name',
      });

      const result = await service.updateUser('user-uuid', {
        name: 'New Name',
      });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { name: 'New Name' },
      });
      expect(result.name).toBe('New Name');
    });

    it('should update country only', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        ...mockUser,
        country: 'US',
      });

      await service.updateUser('user-uuid', { country: 'US' });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { country: 'US' },
      });
    });

    it('should update locale to ar', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        ...mockUser,
        locale: 'ar',
      });

      await service.updateUser('user-uuid', { locale: 'ar' });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { locale: 'ar' },
      });
    });

    it('should update locale to en', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        ...mockUser,
        locale: 'en',
      });

      await service.updateUser('user-uuid', { locale: 'en' });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { locale: 'en' },
      });
    });

    it('should return sanitized user after update', async () => {
      mockPrismaService.user.update.mockResolvedValue(mockUser);

      const result = await service.updateUser('user-uuid', {
        name: 'Test',
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('email');
      expect(result).toHaveProperty('country');
      expect(result).toHaveProperty('locale');
      expect(result).toHaveProperty('status');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result).not.toHaveProperty('passwordResetToken');
      expect(result).not.toHaveProperty('passwordResetExpires');
    });

    it('should handle empty body gracefully', async () => {
      mockPrismaService.user.update.mockResolvedValue(mockUser);

      await expect(
        service.updateUser('user-uuid', {}),
      ).resolves.toBeDefined();

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: {},
      });
    });
  });

  // =========================================================================
  // updateProfile
  // =========================================================================
  describe('updateProfile', () => {
    it('should update displayName only', async () => {
      mockPrismaService.userProfile.update.mockResolvedValue({
        ...mockProfile,
        displayName: 'New Name',
      });

      await service.updateProfile('user-uuid', { displayName: 'New Name' });

      expect(mockPrismaService.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
        data: { displayName: 'New Name' },
      });
    });

    it('should update avatarUrl', async () => {
      mockPrismaService.userProfile.update.mockResolvedValue({
        ...mockProfile,
        avatarUrl: 'https://new.url/avatar.png',
      });

      await service.updateProfile('user-uuid', {
        avatarUrl: 'https://new.url/avatar.png',
      });

      expect(mockPrismaService.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
        data: { avatarUrl: 'https://new.url/avatar.png' },
      });
    });

    it('should update preferredLanguage to ar', async () => {
      mockPrismaService.userProfile.update.mockResolvedValue({
        ...mockProfile,
        preferredLanguage: 'ar',
      });

      await service.updateProfile('user-uuid', { preferredLanguage: 'ar' });

      expect(mockPrismaService.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
        data: { preferredLanguage: 'ar' },
      });
    });

    it('should update preferredLanguage to en', async () => {
      mockPrismaService.userProfile.update.mockResolvedValue({
        ...mockProfile,
        preferredLanguage: 'en',
      });

      await service.updateProfile('user-uuid', { preferredLanguage: 'en' });

      expect(mockPrismaService.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
        data: { preferredLanguage: 'en' },
      });
    });

    it('should return profile after update', async () => {
      const updatedProfile = { ...mockProfile, displayName: 'Updated' };
      mockPrismaService.userProfile.update.mockResolvedValue(updatedProfile);

      const result = await service.updateProfile('user-uuid', {
        displayName: 'Updated',
      });

      expect(result).toEqual(updatedProfile);
    });
  });

  // =========================================================================
  // changePassword
  // =========================================================================
  describe('changePassword', () => {
    const dto = { currentPassword: 'OldPass123', newPassword: 'NewPass456' };

    it('should update password hash when current password is correct', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);
      bcrypt.hash.mockResolvedValue('new_hashed_pw');

      await service.changePassword('user-uuid', dto);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: {
          passwordHash: 'new_hashed_pw',
          refreshToken: null,
        },
      });
    });

    it('should throw BadRequestException with WRONG_CURRENT_PASSWORD when current password is incorrect', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);

      try {
        await service.changePassword('user-uuid', dto);
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe(ErrorCode.WRONG_CURRENT_PASSWORD);
      }
    });

    it('should call bcrypt.hash with 12 rounds', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.changePassword('user-uuid', dto);

      expect(bcrypt.hash).toHaveBeenCalledWith('NewPass456', 12);
    });

    it('should not call prisma.user.update if bcrypt.compare returns false', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);

      try {
        await service.changePassword('user-uuid', dto);
      } catch {
        // expected to throw
      }

      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // submitOnboarding
  // =========================================================================
  describe('submitOnboarding', () => {
    const onboardingDto = {
      responses: [
        { questionKey: 'level', answer: 'beginner', stepNumber: 1 },
        { questionKey: 'goal', answer: 'career', stepNumber: 2 },
        { questionKey: 'interest', answer: 'ai', stepNumber: 3 },
      ],
      background: 'Student',
      goals: 'AI Career',
      interests: 'ML, Cloud',
    };

    it('should create correct number of OnboardingResponse records', async () => {
      await service.submitOnboarding('user-uuid', onboardingDto);

      expect(mockTx.onboardingResponse.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ questionKey: 'level' }),
          expect.objectContaining({ questionKey: 'goal' }),
          expect.objectContaining({ questionKey: 'interest' }),
        ]),
      });

      const callData =
        mockTx.onboardingResponse.createMany.mock.calls[0][0].data;
      expect(callData).toHaveLength(3);
    });

    it('should include userId, questionKey, answer, stepNumber in each record', async () => {
      await service.submitOnboarding('user-uuid', onboardingDto);

      const callData =
        mockTx.onboardingResponse.createMany.mock.calls[0][0].data;
      callData.forEach(
        (record: {
          userId: string;
          questionKey: string;
          answer: string;
          stepNumber: number;
        }) => {
          expect(record).toHaveProperty('userId', 'user-uuid');
          expect(record).toHaveProperty('questionKey');
          expect(record).toHaveProperty('answer');
          expect(record).toHaveProperty('stepNumber');
        },
      );
    });

    it('should update profile with background, goals, interests, onboardingCompleted', async () => {
      await service.submitOnboarding('user-uuid', onboardingDto);

      expect(mockTx.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
        data: expect.objectContaining({
          background: 'Student',
          goals: 'AI Career',
          interests: 'ML, Cloud',
          onboardingCompleted: true,
        }),
      });
    });

    it('should call analytics capture with onboarding_completed', async () => {
      await service.submitOnboarding('user-uuid', onboardingDto);

      expect(mockAnalyticsService.capture).toHaveBeenCalledWith(
        'user-uuid',
        'onboarding_completed',
      );
    });

    it('should return updated profile', async () => {
      const expectedProfile = {
        ...mockProfile,
        onboardingCompleted: true,
      };
      mockTx.userProfile.update.mockResolvedValue(expectedProfile);

      const result = await service.submitOnboarding(
        'user-uuid',
        onboardingDto,
      );

      expect(result).toEqual(expectedProfile);
    });

    it('should use prisma.$transaction', async () => {
      await service.submitOnboarding('user-uuid', onboardingDto);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should throw on transaction failure', async () => {
      mockPrismaService.$transaction.mockRejectedValue(
        new Error('Transaction failed'),
      );

      await expect(
        service.submitOnboarding('user-uuid', onboardingDto),
      ).rejects.toThrow('Transaction failed');
    });
  });

  // =========================================================================
  // getOnboardingStatus
  // =========================================================================
  describe('getOnboardingStatus', () => {
    it('should return completed true with responses', async () => {
      mockPrismaService.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        onboardingCompleted: true,
      });
      const mockResponses = [
        { questionKey: 'q1', answer: 'a1', stepNumber: 1 },
        { questionKey: 'q2', answer: 'a2', stepNumber: 2 },
      ];
      mockPrismaService.onboardingResponse.findMany.mockResolvedValue(
        mockResponses,
      );

      const result = await service.getOnboardingStatus('user-uuid');

      expect(result.completed).toBe(true);
      expect(result.responses).toEqual(mockResponses);
    });

    it('should return completed false with empty responses', async () => {
      mockPrismaService.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        onboardingCompleted: false,
      });
      mockPrismaService.onboardingResponse.findMany.mockResolvedValue([]);

      const result = await service.getOnboardingStatus('user-uuid');

      expect(result.completed).toBe(false);
      expect(result.responses).toEqual([]);
    });

    it('should sort responses by stepNumber ascending', async () => {
      mockPrismaService.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrismaService.onboardingResponse.findMany.mockResolvedValue([]);

      await service.getOnboardingStatus('user-uuid');

      expect(
        mockPrismaService.onboardingResponse.findMany,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
        orderBy: { stepNumber: 'asc' },
      });
    });
  });
});
