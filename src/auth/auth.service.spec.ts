import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_value'),
  compare: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require('bcryptjs');

const mockUser = {
  id: 'user-uuid',
  name: 'Test User',
  email: 'test@example.com',
  passwordHash: 'hashed_value',
  country: 'SA',
  locale: 'ar',
  status: 'ACTIVE',
  refreshToken: 'hashed_refresh',
  passwordResetToken: null as string | null,
  passwordResetExpires: null as Date | null,
  lastLoginAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockTx = {
  user: {
    create: jest.fn().mockResolvedValue(mockUser),
  },
  userProfile: {
    create: jest.fn().mockResolvedValue({}),
  },
  userRole: {
    create: jest.fn().mockResolvedValue({}),
  },
  subscription: {
    create: jest.fn().mockResolvedValue({}),
  },
};

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue(mockUser),
    create: jest.fn().mockResolvedValue(mockUser),
  },
  userProfile: { create: jest.fn() },
  userRole: { create: jest.fn() },
  subscription: { create: jest.fn() },
  subscriptionPlan: {
    findFirst: jest
      .fn()
      .mockResolvedValue({ id: 'free-plan-id', isDefault: true }),
  },
  $transaction: jest.fn().mockImplementation((cb) => cb(mockTx)),
};

const mockMailService = {
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock_token'),
  verify: jest.fn().mockReturnValue({ sub: 'user-uuid', email: 'test@example.com' }),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('test_secret'),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MailService, useValue: mockMailService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // register (7 tests)
  // =========================================================================
  describe('register', () => {
    const registerDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'Test1234',
      country: 'SA',
    };

    it('should create user + profile + role + subscription', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.register(registerDto);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.user.create).toHaveBeenCalled();
      expect(mockTx.userProfile.create).toHaveBeenCalled();
      expect(mockTx.userRole.create).toHaveBeenCalled();
      expect(mockTx.subscription.create).toHaveBeenCalled();
      expect(result.user).toBeDefined();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject duplicate email with ConflictException', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.register(registerDto)).rejects.toThrow(
        'Email already registered',
      );
    });

    it('should hash password with bcrypt 12 rounds', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await service.register(registerDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('Test1234', 12);
    });

    it('should normalize email to lowercase', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await service.register({
        ...registerDto,
        email: '  Test@Example.COM  ',
      });

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should reject weak password via DTO validation', async () => {
      const dto = plainToInstance(RegisterDto, {
        name: 'Test',
        email: 'test@example.com',
        password: 'weak',
        country: 'SA',
      });
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      const passwordError = errors.find((e) => e.property === 'password');
      expect(passwordError).toBeDefined();
    });

    it('should rollback transaction on failure', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockRejectedValue(
        new Error('Transaction failed'),
      );

      await expect(service.register(registerDto)).rejects.toThrow(
        'Transaction failed',
      );
    });

    it('should create subscription to default free plan', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation((cb) => cb(mockTx));

      await service.register(registerDto);

      expect(mockPrismaService.subscriptionPlan.findFirst).toHaveBeenCalledWith(
        { where: { isDefault: true } },
      );
      expect(mockTx.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planId: 'free-plan-id',
            status: 'ACTIVE',
          }),
        }),
      );
    });
  });

  // =========================================================================
  // login (5 tests)
  // =========================================================================
  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'Test1234' };

    it('should return user and tokens on valid credentials', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject incorrect password with UnauthorizedException', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);
      await expect(service.login(loginDto)).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should reject non-existent email with same error message', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.login(loginDto)).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should update lastLoginAt', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.login(loginDto);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({
            lastLoginAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should store hashed refresh token in DB', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.login(loginDto);

      // generateTokens calls bcrypt.hash for the refresh token
      expect(bcrypt.hash).toHaveBeenCalled();
      // user.update is called by generateTokens to store hashed refresh
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refreshToken: 'hashed_value',
          }),
        }),
      );
    });
  });

  // =========================================================================
  // refresh (4 tests)
  // =========================================================================
  describe('refresh', () => {
    it('should return new tokens with valid refresh token', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-uuid',
        email: 'test@example.com',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.refresh('valid_refresh_token');

      expect(result.user).toBeDefined();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject invalid token with UnauthorizedException', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      await expect(service.refresh('invalid_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject expired token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refresh('expired_token')).rejects.toThrow(
        UnauthorizedException,
      );
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      await expect(service.refresh('expired_token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });

    it('should invalidate old token after rotation', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-uuid',
        email: 'test@example.com',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.refresh('old_token');

      // After rotation, the stored hash is updated
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refreshToken: 'hashed_value',
          }),
        }),
      );

      // Now the old token doesn't match the new hash
      bcrypt.compare.mockResolvedValue(false);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        refreshToken: 'new_hashed_value',
      });

      await expect(service.refresh('old_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // =========================================================================
  // logout (3 tests)
  // =========================================================================
  describe('logout', () => {
    it('should set refreshToken to null in DB', async () => {
      await service.logout('user-uuid');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { refreshToken: null },
      });
    });

    it('should require userId parameter', async () => {
      await service.logout('user-uuid');

      expect(mockPrismaService.user.update).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid' },
        }),
      );
    });

    it('should confirm refreshToken is null after logout', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        ...mockUser,
        refreshToken: null,
      });

      await service.logout('user-uuid');

      const updateCall = mockPrismaService.user.update.mock.calls[0][0];
      expect(updateCall.data.refreshToken).toBeNull();
    });
  });

  // =========================================================================
  // forgotPassword (3 tests)
  // =========================================================================
  describe('forgotPassword', () => {
    it('should return without error for non-existent email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'nonexistent@test.com' }),
      ).resolves.toBeUndefined();

      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should store passwordResetToken and passwordResetExpires', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await service.forgotPassword({ email: 'test@example.com' });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passwordResetToken: expect.any(String),
            passwordResetExpires: expect.any(Date),
          }),
        }),
      );

      const updateCall = mockPrismaService.user.update.mock.calls[0][0];
      const expiry = updateCall.data.passwordResetExpires as Date;
      const oneHourFromNow = Date.now() + 60 * 60 * 1000;
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
      expect(expiry.getTime()).toBeLessThanOrEqual(oneHourFromNow + 1000);
    });

    it('should call MailService.sendPasswordResetEmail', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await service.forgotPassword({ email: 'test@example.com' });

      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        mockUser.email,
        expect.any(String),
        mockUser.name,
      );
    });
  });

  // =========================================================================
  // resetPassword (4 tests)
  // =========================================================================
  describe('resetPassword', () => {
    it('should update password with valid token', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);

      await service.resetPassword({
        token: 'valid_token',
        password: 'NewPass123',
      });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({
            passwordHash: 'hashed_value',
            passwordResetToken: null,
            passwordResetExpires: null,
            refreshToken: null,
          }),
        }),
      );
    });

    it('should reject expired token with BadRequestException', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'expired_token',
          password: 'NewPass123',
        }),
      ).rejects.toThrow(BadRequestException);
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      await expect(
        service.resetPassword({
          token: 'expired_token',
          password: 'NewPass123',
        }),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('should reject previously used token (single-use)', async () => {
      // First call succeeds
      mockPrismaService.user.findFirst.mockResolvedValueOnce(mockUser);
      await service.resetPassword({
        token: 'used_token',
        password: 'NewPass123',
      });

      // Second call fails — token was cleared
      mockPrismaService.user.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.resetPassword({
          token: 'used_token',
          password: 'NewPass123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject weak new password via DTO validation', async () => {
      const dto = plainToInstance(ResetPasswordDto, {
        token: 'valid_token',
        password: 'weak',
      });
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      const passwordError = errors.find((e) => e.property === 'password');
      expect(passwordError).toBeDefined();
    });
  });

  // =========================================================================
  // sanitizeUser (1 test)
  // =========================================================================
  describe('sanitizeUser', () => {
    it('should exclude sensitive fields from output', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        password: 'Test1234',
      });

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('refreshToken');
      expect(result.user).not.toHaveProperty('passwordResetToken');
      expect(result.user).not.toHaveProperty('passwordResetExpires');

      expect(result.user).toHaveProperty('id');
      expect(result.user).toHaveProperty('name');
      expect(result.user).toHaveProperty('email');
      expect(result.user).toHaveProperty('country');
      expect(result.user).toHaveProperty('locale');
      expect(result.user).toHaveProperty('status');
    });
  });
});
