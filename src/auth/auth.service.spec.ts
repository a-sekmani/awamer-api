import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  HttpException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ErrorCode } from '../common/error-codes.enum';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { GeoipService } from '../common/geoip.service';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_value'),
  hashSync: jest.fn().mockReturnValue('dummy_hashed_value'),
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
  registrationIp: null as string | null,
  detectedCountry: null as string | null,
  locale: 'ar',
  status: 'ACTIVE',
  emailVerified: false,
  refreshToken: 'hashed_refresh',
  passwordResetToken: null as string | null,
  passwordResetExpires: null as Date | null,
  failedLoginAttempts: 0,
  lockedUntil: null as Date | null,
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
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue(mockUser),
  },
  userProfile: {
    create: jest.fn(),
    findUnique: jest.fn().mockResolvedValue({ onboardingCompleted: false }),
  },
  userRole: {
    create: jest.fn(),
    findMany: jest.fn().mockResolvedValue([{ role: 'LEARNER' }]),
  },
  subscription: { create: jest.fn() },
  subscriptionPlan: {
    findFirst: jest
      .fn()
      .mockResolvedValue({ id: 'free-plan-id', isDefault: true }),
  },
  emailVerification: {
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  rateLimitedRequest: {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
  },
  $transaction: jest.fn().mockImplementation((cbOrArray) => {
    if (typeof cbOrArray === 'function') return cbOrArray(mockTx);
    return Promise.all(cbOrArray);
  }),
};

const mockMailService = {
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock_token'),
  verify: jest.fn().mockReturnValue({
    sub: 'user-uuid',
    email: 'test@example.com',
    emailVerified: false,
    onboardingCompleted: false,
    roles: ['LEARNER'],
  }),
};

const mockGeoipService = {
  getCountryFromIp: jest.fn().mockReturnValue('SA'),
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
        { provide: GeoipService, useValue: mockGeoipService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Restore default $transaction behavior after clearAllMocks wipes implementations
    mockPrismaService.$transaction.mockImplementation((cbOrArray) => {
      if (typeof cbOrArray === 'function') return cbOrArray(mockTx);
      return Promise.all(cbOrArray);
    });
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

    it('should reject duplicate email with ConflictException and EMAIL_ALREADY_EXISTS', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      try {
        await service.register(registerDto);
        fail('Expected ConflictException');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        const response = (error as ConflictException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.errorCode).toBe(ErrorCode.EMAIL_ALREADY_EXISTS);
      }
    });

    it('should hash password with bcrypt 12 rounds', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await service.register(registerDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('Test1234', 12);
    });

    it('should normalize email via DTO @Transform', async () => {
      const dto = plainToInstance(RegisterDto, {
        name: 'Test',
        email: '  Test@Example.COM  ',
        password: 'Test1234!',
        country: 'SA',
      });

      expect(dto.email).toBe('test@example.com');
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

    it('should store registrationIp and detectedCountry when IP is provided', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockGeoipService.getCountryFromIp.mockReturnValue('SA');

      await service.register(registerDto, '185.0.0.1');

      expect(mockGeoipService.getCountryFromIp).toHaveBeenCalledWith(
        '185.0.0.1',
      );
      expect(mockTx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            registrationIp: '185.0.0.1',
            detectedCountry: 'SA',
          }),
        }),
      );
    });

    it('should use detectedCountry when country is not provided in body', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockGeoipService.getCountryFromIp.mockReturnValue('AE');

      await service.register(
        { name: 'Test', email: 'test@example.com', password: 'Test1234!' },
        '185.0.0.2',
      );

      expect(mockTx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            country: 'AE',
            detectedCountry: 'AE',
          }),
        }),
      );
    });

    it('should prefer frontend country over detectedCountry', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockGeoipService.getCountryFromIp.mockReturnValue('AE');

      await service.register({ ...registerDto, country: 'EG' }, '185.0.0.3');

      expect(mockTx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            country: 'EG',
            detectedCountry: 'AE',
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

    it('should reject incorrect password with INVALID_CREDENTIALS', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);

      try {
        await service.login(loginDto);
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (
          error as UnauthorizedException
        ).getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS);
      }
    });

    it('should reject non-existent email with same INVALID_CREDENTIALS errorCode', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      try {
        await service.login(loginDto);
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (
          error as UnauthorizedException
        ).getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS);
      }
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
  // login — account lockout (6 tests)
  // =========================================================================
  describe('login — account lockout', () => {
    const loginDto = { email: 'test@example.com', password: 'Test1234' };

    it('should increment failedLoginAttempts on wrong password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 3,
      });
      bcrypt.compare.mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failedLoginAttempts: 4,
          }),
        }),
      );
    });

    it('should lock account after 10 failed attempts', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 9,
      });
      bcrypt.compare.mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failedLoginAttempts: 10,
            lockedUntil: expect.any(Date),
          }),
        }),
      );

      const updateCall = mockPrismaService.user.update.mock.calls[0][0];
      const lockedUntil = updateCall.data.lockedUntil as Date;
      const fifteenMinFromNow = Date.now() + 15 * 60 * 1000;
      expect(lockedUntil.getTime()).toBeGreaterThan(Date.now());
      expect(lockedUntil.getTime()).toBeLessThanOrEqual(
        fifteenMinFromNow + 1000,
      );
    });

    it('should reject locked account without checking password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 10,
        lockedUntil: new Date(Date.now() + 10 * 60 * 1000), // locked for 10 more min
      });

      try {
        await service.login(loginDto);
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (
          error as UnauthorizedException
        ).getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS);
      }

      // bcrypt.compare should NOT have been called
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should return INVALID_CREDENTIALS for locked account (no leak)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        lockedUntil: new Date(Date.now() + 5 * 60 * 1000),
      });

      try {
        await service.login(loginDto);
        fail('Expected UnauthorizedException');
      } catch (error) {
        const response = (
          error as UnauthorizedException
        ).getResponse() as Record<string, unknown>;
        expect(response.message).toBe('Invalid credentials');
        expect(response.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS);
      }
    });

    it('should reset failedLoginAttempts on successful login', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
      });
      bcrypt.compare.mockResolvedValue(true);

      await service.login(loginDto);

      // The login-success update (second update call, after generateTokens)
      const updateCalls = mockPrismaService.user.update.mock.calls;
      const loginUpdate = updateCalls.find(
        (call) => call[0].data.failedLoginAttempts === 0,
      );
      expect(loginUpdate).toBeDefined();
      expect(loginUpdate[0].data).toEqual(
        expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      );
    });

    it('should allow login after lockout period expires', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 10,
        lockedUntil: new Date(Date.now() - 1000), // expired 1 second ago
      });
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result.user).toBeDefined();
      expect(result.accessToken).toBeDefined();
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

    it('should reject invalid token with INVALID_SESSION', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      try {
        await service.refresh('invalid_token');
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (
          error as UnauthorizedException
        ).getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe(ErrorCode.INVALID_SESSION);
      }
    });

    it('should reject expired token with INVALID_SESSION', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      try {
        await service.refresh('expired_token');
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (
          error as UnauthorizedException
        ).getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe(ErrorCode.INVALID_SESSION);
      }
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

      expect(mockPrismaService.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { refreshToken: null },
      });
    });

    it('should require userId parameter', async () => {
      await service.logout('user-uuid');

      expect(mockPrismaService.user.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid' },
        }),
      );
    });

    it('should confirm refreshToken is null after logout', async () => {
      await service.logout('user-uuid');

      const updateCall = mockPrismaService.user.updateMany.mock.calls[0][0];
      expect(updateCall.data.refreshToken).toBeNull();
    });

    it('should not throw when user does not exist', async () => {
      mockPrismaService.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('non-existent-uuid')).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // forgotPassword (3 tests)
  // =========================================================================
  describe('forgotPassword', () => {
    const testIp = '127.0.0.1';

    beforeEach(() => {
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.rateLimitedRequest.count.mockResolvedValue(0);
    });

    it('should return without error for non-existent email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'nonexistent@test.com' }, testIp),
      ).resolves.toBeUndefined();

      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should store passwordResetToken and passwordResetExpires', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await service.forgotPassword({ email: 'test@example.com' }, testIp);

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

      await service.forgotPassword({ email: 'test@example.com' }, testIp);

      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        mockUser.email,
        expect.any(String),
        mockUser.name,
      );
    });

    it('should log the request in rateLimitedRequest table', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await service.forgotPassword({ email: 'test@example.com' }, testIp);

      expect(mockPrismaService.rateLimitedRequest.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          ip: testIp,
          type: 'FORGOT_PASSWORD',
        },
      });
    });
  });

  // =========================================================================
  // forgotPassword — rate limiting (5 tests)
  // =========================================================================
  describe('forgotPassword — rate limiting', () => {
    const testIp = '127.0.0.1';

    beforeEach(() => {
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.rateLimitedRequest.count.mockResolvedValue(0);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
    });

    it('should succeed on first request', async () => {
      await expect(
        service.forgotPassword({ email: 'test@example.com' }, testIp),
      ).resolves.not.toThrow();
    });

    it('should reject second request within 60 seconds (per-email cooldown)', async () => {
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        email: 'test@example.com',
        ip: testIp,
        createdAt: new Date(Date.now() - 15 * 1000), // 15 seconds ago
      });

      try {
        await service.forgotPassword({ email: 'test@example.com' }, testIp);
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(429);
        const response = httpError.getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.retryAfter).toBeGreaterThan(0);
        expect(response.retryAfter).toBeLessThanOrEqual(60);
      }
    });

    it('should reject when 5 requests per hour per email exceeded', async () => {
      // No recent request in last 60s
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce(
        null,
      );
      // But 5 requests in last hour
      mockPrismaService.rateLimitedRequest.count.mockResolvedValueOnce(5);
      // Oldest request in window
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce({
        id: 'req-old',
        email: 'test@example.com',
        ip: testIp,
        createdAt: new Date(Date.now() - 50 * 60 * 1000), // 50 minutes ago
      });

      try {
        await service.forgotPassword({ email: 'test@example.com' }, testIp);
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(429);
        const response = httpError.getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.retryAfter).toBeGreaterThan(0);
      }
    });

    it('should reject when 10 requests per 24 hours per IP exceeded', async () => {
      // No per-email cooldown hit
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce(
        null,
      );
      // Hourly per-email count is fine
      mockPrismaService.rateLimitedRequest.count.mockResolvedValueOnce(2);
      // But daily per-IP count is 10
      mockPrismaService.rateLimitedRequest.count.mockResolvedValueOnce(10);
      // Oldest request in IP window
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce({
        id: 'req-ip-old',
        email: 'other@example.com',
        ip: testIp,
        createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000), // 20 hours ago
      });

      try {
        await service.forgotPassword({ email: 'test@example.com' }, testIp);
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(429);
        const response = httpError.getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.retryAfter).toBeGreaterThan(0);
      }
    });

    it('should succeed after cooldown period expires', async () => {
      // No recent request found (cooldown expired)
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.rateLimitedRequest.count.mockResolvedValue(0);

      await expect(
        service.forgotPassword({ email: 'test@example.com' }, testIp),
      ).resolves.not.toThrow();
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

    it('should reject expired token with INVALID_RESET_TOKEN', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      try {
        await service.resetPassword({
          token: 'expired_token',
          password: 'NewPass123',
        });
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.errorCode).toBe(ErrorCode.INVALID_RESET_TOKEN);
      }
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

    it('should use a transaction for password update and token clearing', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);

      await service.resetPassword({
        token: 'valid_token',
        password: 'NewPass123',
      });

      // $transaction should be called with an array
      const txCall = mockPrismaService.$transaction.mock.calls.find((call) =>
        Array.isArray(call[0]),
      );
      expect(txCall).toBeDefined();
    });
  });

  // =========================================================================
  // verifyResetToken (5 tests)
  // =========================================================================
  describe('verifyResetToken', () => {
    it('should return { valid: true } for a valid token', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);

      const result = await service.verifyResetToken('valid_token');

      expect(result).toEqual({ valid: true });
    });

    it('should throw INVALID_RESET_TOKEN for an invalid token', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      try {
        await service.verifyResetToken('invalid_token');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.errorCode).toBe(ErrorCode.INVALID_RESET_TOKEN);
      }
    });

    it('should throw INVALID_RESET_TOKEN for an expired token', async () => {
      // Prisma findFirst with passwordResetExpires > now returns null for expired
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      try {
        await service.verifyResetToken('expired_token');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.errorCode).toBe(ErrorCode.INVALID_RESET_TOKEN);
      }
    });

    it('should throw INVALID_RESET_TOKEN when token is empty', async () => {
      try {
        await service.verifyResetToken('');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.errorCode).toBe(ErrorCode.INVALID_RESET_TOKEN);
      }
    });

    it('should return 400 after token has been used by resetPassword (single-use)', async () => {
      // First: resetPassword succeeds and clears the token
      mockPrismaService.user.findFirst.mockResolvedValueOnce(mockUser);
      await service.resetPassword({
        token: 'one_time_token',
        password: 'NewPass123',
      });

      // Second: verifyResetToken fails because token was cleared
      mockPrismaService.user.findFirst.mockResolvedValueOnce(null);

      try {
        await service.verifyResetToken('one_time_token');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.errorCode).toBe(ErrorCode.INVALID_RESET_TOKEN);
      }
    });
  });

  // =========================================================================
  // sanitizeUser (2 tests)
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

    it('should include emailVerified and requiresVerification fields', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        password: 'Test1234',
      });

      expect(result.user).toHaveProperty('emailVerified', false);
      expect(result.user).toHaveProperty('requiresVerification', true);
    });
  });

  // =========================================================================
  // sendVerificationCode (8 tests)
  // =========================================================================
  describe('sendVerificationCode', () => {
    it('should generate and send a verification code', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.count.mockResolvedValue(0);

      await service.sendVerificationCode('user-uuid');

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
        mockUser.email,
        expect.stringMatching(/^\d{6}$/),
        mockUser.name,
      );
    });

    it('should throw 400 if email is already verified', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        emailVerified: true,
      });

      await expect(service.sendVerificationCode('user-uuid')).rejects.toThrow(
        BadRequestException,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        emailVerified: true,
      });
      await expect(service.sendVerificationCode('user-uuid')).rejects.toThrow(
        'Email already verified',
      );
    });

    it('should throw 429 with RATE_LIMIT_EXCEEDED if per-email cooldown hit', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce({
        id: 'req-1',
        email: mockUser.email,
        ip: '127.0.0.1',
        type: 'VERIFICATION_RESEND',
        createdAt: new Date(Date.now() - 15 * 1000), // 15 seconds ago
      });

      try {
        await service.sendVerificationCode('user-uuid', '127.0.0.1');
        fail('Expected HttpException');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(429);
        const response = (e as HttpException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.errorCode).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
        expect(response.retryAfter).toBeGreaterThan(0);
      }
    });

    it('should invalidate all previous codes before creating new one', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.count.mockResolvedValue(0);

      await service.sendVerificationCode('user-uuid');

      // $transaction is called with an array containing updateMany and create
      const transactionCall = mockPrismaService.$transaction.mock.calls.find(
        (call) => Array.isArray(call[0]),
      );
      expect(transactionCall).toBeDefined();
    });

    it('should send a plaintext 6-digit code via email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.count.mockResolvedValue(0);

      await service.sendVerificationCode('user-uuid');

      const sentCode = mockMailService.sendVerificationEmail.mock.calls[0][1];
      expect(sentCode).toMatch(/^\d{6}$/);
      expect(parseInt(sentCode, 10)).toBeGreaterThanOrEqual(100000);
      expect(parseInt(sentCode, 10)).toBeLessThanOrEqual(999999);
    });

    it('should store the code as a SHA-256 hash, not plaintext', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.count.mockResolvedValue(0);

      await service.sendVerificationCode('user-uuid');

      const createCall =
        mockPrismaService.emailVerification.create.mock.calls[0][0];
      const storedCode = createCall.data.code as string;

      // SHA-256 hex is 64 characters
      expect(storedCode).toMatch(/^[a-f0-9]{64}$/);

      // It should NOT be the plaintext 6-digit code
      const sentCode = mockMailService.sendVerificationEmail.mock.calls[0][1];
      expect(storedCode).not.toBe(sentCode);
    });

    it('should set expiresAt to approximately 10 minutes from now', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.count.mockResolvedValue(0);

      const beforeCall = Date.now();
      await service.sendVerificationCode('user-uuid');
      const afterCall = Date.now();

      // The create call is inside the $transaction array — capture the create arg
      const createCall =
        mockPrismaService.emailVerification.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt as Date;

      const tenMinMs = 10 * 60 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        beforeCall + tenMinMs - 100,
      );
      expect(expiresAt.getTime()).toBeLessThanOrEqual(
        afterCall + tenMinMs + 100,
      );
    });

    it('should call mailService.sendVerificationEmail with correct email, code, and name', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.count.mockResolvedValue(0);

      await service.sendVerificationCode('user-uuid');

      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String),
        'Test User',
      );
    });

    it('should throw if mailService.sendVerificationEmail throws (SES failure)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.count.mockResolvedValue(0);
      mockMailService.sendVerificationEmail.mockRejectedValueOnce(
        new Error('SES connection failed'),
      );

      await expect(service.sendVerificationCode('user-uuid')).rejects.toThrow(
        'SES connection failed',
      );

      // Transaction should still have been called (codes were created before mail)
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // sendVerificationCode — rate limiting (5 tests)
  // =========================================================================
  describe('sendVerificationCode — rate limiting', () => {
    const testIp = '127.0.0.1';

    beforeEach(() => {
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.rateLimitedRequest.count.mockResolvedValue(0);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
    });

    it('should succeed on first request', async () => {
      await expect(
        service.sendVerificationCode('user-uuid', testIp),
      ).resolves.not.toThrow();
    });

    it('should reject second request within 60 seconds (per-email cooldown)', async () => {
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce({
        id: 'req-1',
        email: mockUser.email,
        ip: testIp,
        type: 'VERIFICATION_RESEND',
        createdAt: new Date(Date.now() - 15 * 1000), // 15 seconds ago
      });

      try {
        await service.sendVerificationCode('user-uuid', testIp);
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(429);
        const response = httpError.getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.retryAfter).toBeGreaterThan(0);
        expect(response.retryAfter).toBeLessThanOrEqual(60);
      }
    });

    it('should reject when 5 requests per hour per email exceeded', async () => {
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce(
        null,
      );
      mockPrismaService.rateLimitedRequest.count.mockResolvedValueOnce(5);
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce({
        id: 'req-old',
        email: mockUser.email,
        ip: testIp,
        type: 'VERIFICATION_RESEND',
        createdAt: new Date(Date.now() - 50 * 60 * 1000),
      });

      try {
        await service.sendVerificationCode('user-uuid', testIp);
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(429);
        const response = httpError.getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.retryAfter).toBeGreaterThan(0);
      }
    });

    it('should reject when 10 requests per 24 hours per IP exceeded', async () => {
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce(
        null,
      );
      mockPrismaService.rateLimitedRequest.count.mockResolvedValueOnce(2);
      mockPrismaService.rateLimitedRequest.count.mockResolvedValueOnce(10);
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValueOnce({
        id: 'req-ip-old',
        email: 'other@example.com',
        ip: testIp,
        type: 'VERIFICATION_RESEND',
        createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
      });

      try {
        await service.sendVerificationCode('user-uuid', testIp);
        fail('Expected HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(429);
        const response = httpError.getResponse() as Record<string, unknown>;
        expect(response.errorCode).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.retryAfter).toBeGreaterThan(0);
      }
    });

    it('should succeed after cooldown period expires', async () => {
      mockPrismaService.rateLimitedRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.rateLimitedRequest.count.mockResolvedValue(0);

      await expect(
        service.sendVerificationCode('user-uuid', testIp),
      ).resolves.not.toThrow();
    });

    it('should skip rate limit when ip is not provided (register flow)', async () => {
      // No IP = called from register(), should not check rate limit
      await expect(
        service.sendVerificationCode('user-uuid'),
      ).resolves.not.toThrow();

      expect(
        mockPrismaService.rateLimitedRequest.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should log the request in rateLimitedRequest table', async () => {
      await service.sendVerificationCode('user-uuid', testIp);

      expect(mockPrismaService.rateLimitedRequest.create).toHaveBeenCalledWith({
        data: {
          email: mockUser.email,
          ip: testIp,
          type: 'VERIFICATION_RESEND',
        },
      });
    });
  });

  // =========================================================================
  // verifyEmail (10 tests)
  // =========================================================================
  describe('verifyEmail', () => {
    // SHA-256 of '123456'
    const hashedCode =
      '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';
    const validVerification = {
      id: 'verification-uuid',
      userId: 'user-uuid',
      code: hashedCode,
      expiresAt: new Date(Date.now() + 600000),
      attempts: 0,
      used: false,
      createdAt: new Date(),
    };

    it('should verify email successfully with correct code', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue(
        validVerification,
      );

      const result = await service.verifyEmail('user-uuid', '123456');

      expect(result.emailVerified).toBe(true);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw 400 if email is already verified', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        emailVerified: true,
      });

      await expect(service.verifyEmail('user-uuid', '123456')).rejects.toThrow(
        BadRequestException,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        emailVerified: true,
      });
      await expect(service.verifyEmail('user-uuid', '123456')).rejects.toThrow(
        'Email already verified',
      );
    });

    it('should throw 400 if no valid code found (all expired or used)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue(null);

      await expect(service.verifyEmail('user-uuid', '123456')).rejects.toThrow(
        'No valid verification code found',
      );
    });

    it('should throw 400 and increment attempts on incorrect code', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue(
        validVerification,
      );

      await expect(service.verifyEmail('user-uuid', '999999')).rejects.toThrow(
        'Invalid verification code',
      );

      expect(mockPrismaService.emailVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: validVerification.id },
          data: expect.objectContaining({ attempts: 1 }),
        }),
      );
    });

    it('should invalidate code after 5 failed attempts', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue({
        ...validVerification,
        attempts: 5,
      });

      await expect(service.verifyEmail('user-uuid', '123456')).rejects.toThrow(
        'too many attempts',
      );

      expect(mockPrismaService.emailVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ used: true }),
        }),
      );
    });

    it('should set emailVerified = true on User within the transaction', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue(
        validVerification,
      );

      await service.verifyEmail('user-uuid', '123456');

      // $transaction should be called with an array
      const txCall = mockPrismaService.$transaction.mock.calls.find((call) =>
        Array.isArray(call[0]),
      );
      expect(txCall).toBeDefined();

      // user.update should be called with emailVerified: true
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { emailVerified: true },
      });
    });

    it('should set used = true on the EmailVerification after success', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue(
        validVerification,
      );

      await service.verifyEmail('user-uuid', '123456');

      expect(mockPrismaService.emailVerification.update).toHaveBeenCalledWith({
        where: { id: 'verification-uuid' },
        data: { used: true },
      });
    });

    it('should use prisma.$transaction for the verify operation', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue(
        validVerification,
      );

      await service.verifyEmail('user-uuid', '123456');

      // Verify transaction was called with an array of exactly 2 operations
      const txCall = mockPrismaService.$transaction.mock.calls.find((call) =>
        Array.isArray(call[0]),
      );
      expect(txCall).toBeDefined();
      expect(txCall![0]).toHaveLength(2);
    });

    it('should throw 400 for expired code (findFirst returns null when expiresAt < now)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      // Prisma's findFirst with { expiresAt: { gt: new Date() } } returns null for expired codes
      mockPrismaService.emailVerification.findFirst.mockResolvedValue(null);

      await expect(service.verifyEmail('user-uuid', '123456')).rejects.toThrow(
        BadRequestException,
      );
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue(null);
      await expect(service.verifyEmail('user-uuid', '123456')).rejects.toThrow(
        'No valid verification code found. Please request a new one',
      );
    });

    it('should increment attempts by exactly 1 on each failed attempt', async () => {
      // attempts = 2, submitting wrong code should make it 3
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.emailVerification.findFirst.mockResolvedValue({
        ...validVerification,
        attempts: 2,
      });

      await expect(service.verifyEmail('user-uuid', '999999')).rejects.toThrow(
        'Invalid verification code',
      );

      expect(mockPrismaService.emailVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: validVerification.id },
          data: expect.objectContaining({ attempts: 3 }),
        }),
      );
    });
  });

  // =========================================================================
  // VerifyEmailDto validation (7 tests)
  // =========================================================================
  describe('VerifyEmailDto', () => {
    it('should accept valid 6-digit code "123456"', async () => {
      const dto = plainToInstance(VerifyEmailDto, { code: '123456' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject 5-digit code "12345"', async () => {
      const dto = plainToInstance(VerifyEmailDto, { code: '12345' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject 7-digit code "1234567"', async () => {
      const dto = plainToInstance(VerifyEmailDto, { code: '1234567' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject all-letter code "abcdef"', async () => {
      const dto = plainToInstance(VerifyEmailDto, { code: 'abcdef' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject mixed alphanumeric code "12ab56"', async () => {
      const dto = plainToInstance(VerifyEmailDto, { code: '12ab56' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject empty string ""', async () => {
      const dto = plainToInstance(VerifyEmailDto, { code: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject null and undefined', async () => {
      const dtoNull = plainToInstance(VerifyEmailDto, { code: null });
      const errorsNull = await validate(dtoNull);
      expect(errorsNull.length).toBeGreaterThan(0);

      const dtoUndefined = plainToInstance(VerifyEmailDto, {});
      const errorsUndefined = await validate(dtoUndefined);
      expect(errorsUndefined.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // register — email verification modifications (4 tests)
  // =========================================================================
  describe('register — email verification', () => {
    const registerDto = {
      name: 'Test User',
      email: 'new@example.com',
      password: 'Test1234',
      country: 'SA',
    };

    it('should return emailVerified: false in the response user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.register(registerDto);

      expect(result.user.emailVerified).toBe(false);
    });

    it('should return requiresVerification: true in the response user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.register(registerDto);

      expect(result.user.requiresVerification).toBe(true);
    });

    it('should call sendVerificationCode after user creation', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      // Make sendVerificationCode succeed by providing a valid user for lookup
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(null) // first call: duplicate check
        .mockResolvedValueOnce(mockUser); // second call: inside sendVerificationCode
      mockPrismaService.emailVerification.count.mockResolvedValue(0);

      await service.register(registerDto);

      // sendVerificationCode calls mailService.sendVerificationEmail
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('should still succeed registration even if sendVerificationCode throws', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      // sendVerificationCode will fail because user.findUnique returns null
      // (the "User not found" path). Registration should still succeed.

      const result = await service.register(registerDto);

      expect(result.user).toBeDefined();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });
  });

  // =========================================================================
  // login — email verification modifications (3 tests)
  // =========================================================================
  describe('login — email verification', () => {
    const loginDto = { email: 'test@example.com', password: 'Test1234' };

    it('should return emailVerified: true and requiresVerification: false for verified user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        emailVerified: true,
      });
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result.user.emailVerified).toBe(true);
      expect(result.user.requiresVerification).toBe(false);
    });

    it('should return emailVerified: false and requiresVerification: true for unverified user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        emailVerified: false,
      });
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result.user.emailVerified).toBe(false);
      expect(result.user.requiresVerification).toBe(true);
    });

    it('should always include emailVerified field in login response', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result.user).toHaveProperty('emailVerified');
      expect(result.user).toHaveProperty('requiresVerification');
    });
  });

  // =========================================================================
  // rememberMe (5 tests)
  // =========================================================================
  describe('rememberMe', () => {
    it('should use 30d refresh token expiry when login with rememberMe=true', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.login({
        email: 'test@example.com',
        password: 'Test1234',
        rememberMe: true,
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ expiresIn: '30d' }),
      );
    });

    it('should use 7d refresh token expiry when login with rememberMe=false', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.login({
        email: 'test@example.com',
        password: 'Test1234',
        rememberMe: false,
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });

    it('should default to 7d refresh token expiry when login without rememberMe', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.login({ email: 'test@example.com', password: 'Test1234' });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });

    it('should use 30d refresh token expiry when register with rememberMe=true', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await service.register({
        name: 'Test',
        email: 'new@example.com',
        password: 'Test1234',
        rememberMe: true,
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ expiresIn: '30d' }),
      );
    });

    it('should maintain 30d expiry on refresh after rememberMe=true login', async () => {
      // Simulate a token that was issued with 30d expiry
      const now = Math.floor(Date.now() / 1000);
      mockJwtService.verify.mockReturnValue({
        sub: 'user-uuid',
        email: 'test@example.com',
        iat: now,
        exp: now + 30 * 24 * 60 * 60, // 30 days
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.refresh('valid_refresh_token');

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ expiresIn: '30d' }),
      );
    });

    it('should return 30d cookieMaxAge when login with rememberMe=true', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        password: 'Test1234',
        rememberMe: true,
      });

      expect(result.cookieMaxAge).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('should return 7d cookieMaxAge when login with rememberMe=false', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        password: 'Test1234',
        rememberMe: false,
      });

      expect(result.cookieMaxAge).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
