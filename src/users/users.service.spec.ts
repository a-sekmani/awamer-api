import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
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
  onboardingResponse: {
    createMany: jest.fn().mockResolvedValue({ count: 3 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
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

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock_token'),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('test_secret'),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
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
    const validDto = {
      responses: [
        { questionKey: 'background', answer: 'student', stepNumber: 1 },
        { questionKey: 'interests', answer: '["ai","programming"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    };

    beforeEach(() => {
      mockPrismaService.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        onboardingCompleted: false,
      });
      // Mock for token reissue after onboarding
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        email: 'test@example.com',
        emailVerified: true,
        roles: [{ role: 'LEARNER' }],
      });
    });

    // -----------------------------------------------------------------------
    // Happy path (11 tests)
    // -----------------------------------------------------------------------
    describe('happy path', () => {
      it('should delete existing responses before creating new ones (idempotency)', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        expect(mockTx.onboardingResponse.deleteMany).toHaveBeenCalledWith({
          where: { userId: 'user-uuid' },
        });
      });

      it('should create exactly 3 OnboardingResponse records', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        const callData = mockTx.onboardingResponse.createMany.mock.calls[0][0].data;
        expect(callData).toHaveLength(3);
      });

      it('should include userId in each response record', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        const callData = mockTx.onboardingResponse.createMany.mock.calls[0][0].data;
        callData.forEach((r: { userId: string }) => {
          expect(r.userId).toBe('user-uuid');
        });
      });

      it('should store background value in UserProfile.background', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        expect(mockTx.userProfile.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ background: 'student' }),
          }),
        );
      });

      it('should store goals value in UserProfile.goals', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        expect(mockTx.userProfile.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ goals: 'learn_new_skill' }),
          }),
        );
      });

      it('should store interests JSON array string in UserProfile.interests', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        expect(mockTx.userProfile.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ interests: '["ai","programming"]' }),
          }),
        );
      });

      it('should set onboardingCompleted to true', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        expect(mockTx.userProfile.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ onboardingCompleted: true }),
          }),
        );
      });

      it('should fire analyticsService.capture with onboarding_completed', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        expect(mockAnalyticsService.capture).toHaveBeenCalledWith('user-uuid', 'onboarding_completed');
      });

      it('should use prisma.$transaction for atomicity', async () => {
        await service.submitOnboarding('user-uuid', validDto);

        expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      });

      it('should return profile and new tokens', async () => {
        const expected = { ...mockProfile, onboardingCompleted: true };
        mockTx.userProfile.update.mockResolvedValue(expected);

        const result = await service.submitOnboarding('user-uuid', validDto);

        expect(result.profile).toEqual(expected);
        expect(result.accessToken).toBe('mock_token');
        expect(result.refreshToken).toBe('mock_token');
      });

      it('should throw on transaction failure (rollback)', async () => {
        mockPrismaService.$transaction.mockRejectedValue(new Error('Transaction failed'));

        await expect(service.submitOnboarding('user-uuid', validDto)).rejects.toThrow('Transaction failed');
      });
    });

    // -----------------------------------------------------------------------
    // Validation (15 tests)
    // -----------------------------------------------------------------------
    describe('validation', () => {
      it('should throw ONBOARDING_ALREADY_COMPLETED if profile.onboardingCompleted is true', async () => {
        mockPrismaService.userProfile.findUnique.mockResolvedValue({
          ...mockProfile,
          onboardingCompleted: true,
        });

        await expect(service.submitOnboarding('user-uuid', validDto)).rejects.toThrow('Onboarding already completed');
      });

      it('should throw if "background" questionKey is missing', async () => {
        const dto = {
          responses: [
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('Missing required questionKey: background');
      });

      it('should throw if "interests" questionKey is missing', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('Missing required questionKey: interests');
      });

      it('should throw if "goals" questionKey is missing', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('Missing required questionKey: goals');
      });

      it('should throw if background stepNumber is not 1', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 2 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('background must have stepNumber 1');
      });

      it('should throw if interests stepNumber is not 2', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 1 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('interests must have stepNumber 2');
      });

      it('should throw if goals stepNumber is not 3', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 1 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('goals must have stepNumber 3');
      });

      it('should throw if background answer is not in VALID_BACKGROUNDS', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'astronaut', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('Invalid background value');
      });

      it('should throw if goals answer is not in VALID_GOALS', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'become_famous', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('Invalid goals value');
      });

      it('should throw if interests answer is not valid JSON', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: 'not-json', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('valid JSON array');
      });

      it('should throw if interests answer is not a JSON array (e.g., JSON object)', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '{"key":"value"}', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('must be a JSON array');
      });

      it('should throw if interests answer is an empty array', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '[]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('between 1 and 4');
      });

      it('should throw if interests has more than 4 items', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai","programming","cybersecurity","cloud_devops","blockchain"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('between 1 and 4');
      });

      it('should throw if interests contains a value not in VALID_INTERESTS', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai","cooking"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('Invalid interest value');
      });

      it('should throw if interests contains duplicate values', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai","ai"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).rejects.toThrow('duplicate values');
      });
    });

    // -----------------------------------------------------------------------
    // Edge cases (5 tests)
    // -----------------------------------------------------------------------
    describe('edge cases', () => {
      beforeEach(() => {
        mockPrismaService.userProfile.findUnique.mockResolvedValue({
          ...mockProfile,
          onboardingCompleted: false,
        });
        mockPrismaService.$transaction.mockImplementation((cb) => cb(mockTx));
      });

      it('should accept interests with exactly 1 item (minimum)', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).resolves.not.toThrow();
      });

      it('should accept interests with exactly 4 items (maximum)', async () => {
        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai","programming","cybersecurity","cloud_devops"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).resolves.not.toThrow();
      });

      it('should accept all valid background values one by one', async () => {
        for (const bg of ['student', 'freelancer', 'employee', 'job_seeker']) {
          jest.clearAllMocks();
          mockPrismaService.userProfile.findUnique.mockResolvedValue({ ...mockProfile, onboardingCompleted: false });
          mockPrismaService.$transaction.mockImplementation((cb) => cb(mockTx));

          const dto = {
            responses: [
              { questionKey: 'background', answer: bg, stepNumber: 1 },
              { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
              { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
            ],
          };

          await expect(service.submitOnboarding('user-uuid', dto)).resolves.not.toThrow();
        }
      });

      it('should accept all valid goal values one by one', async () => {
        for (const goal of ['learn_new_skill', 'level_up', 'advance_career', 'switch_career', 'build_project']) {
          jest.clearAllMocks();
          mockPrismaService.userProfile.findUnique.mockResolvedValue({ ...mockProfile, onboardingCompleted: false });
          mockPrismaService.$transaction.mockImplementation((cb) => cb(mockTx));

          const dto = {
            responses: [
              { questionKey: 'background', answer: 'student', stepNumber: 1 },
              { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
              { questionKey: 'goals', answer: goal, stepNumber: 3 },
            ],
          };

          await expect(service.submitOnboarding('user-uuid', dto)).resolves.not.toThrow();
        }
      });

      it('should accept all valid interest values', async () => {
        const allInterests = ['programming', 'data_science', 'ai', 'mobile_dev'];

        const dto = {
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: JSON.stringify(allInterests), stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
          ],
        };

        await expect(service.submitOnboarding('user-uuid', dto)).resolves.not.toThrow();
      });
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
