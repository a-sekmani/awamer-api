import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const COOKIE_MAX_AGE_DEFAULT = 7 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE_REMEMBER = 30 * 24 * 60 * 60 * 1000;

const mockAuthService = {
  register: jest.fn().mockResolvedValue({
    user: { id: 'uuid', name: 'Test', email: 'test@example.com' },
    accessToken: 'at',
    refreshToken: 'rt',
    cookieMaxAge: COOKIE_MAX_AGE_DEFAULT,
  }),
  login: jest.fn().mockResolvedValue({
    user: { id: 'uuid', name: 'Test', email: 'test@example.com' },
    accessToken: 'at',
    refreshToken: 'rt',
    cookieMaxAge: COOKIE_MAX_AGE_DEFAULT,
  }),
  logout: jest.fn().mockResolvedValue(undefined),
  refresh: jest.fn().mockResolvedValue({
    user: { id: 'uuid', name: 'Test', email: 'test@example.com' },
    accessToken: 'at',
    refreshToken: 'rt',
    cookieMaxAge: COOKIE_MAX_AGE_DEFAULT,
  }),
  forgotPassword: jest.fn().mockResolvedValue(undefined),
  verifyResetToken: jest.fn().mockResolvedValue({ valid: true }),
  resetPassword: jest.fn().mockResolvedValue(undefined),
  sendVerificationCode: jest.fn().mockResolvedValue(undefined),
  verifyEmail: jest.fn().mockResolvedValue({ emailVerified: true }),
  getLatestCodeByEmail: jest.fn().mockResolvedValue('654321'),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('development'),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should validate DTOs with class-validator', async () => {
    // RegisterDto — empty name
    const registerDto = plainToInstance(RegisterDto, {
      name: '',
      email: 'bad-email',
      password: 'weak',
    });
    const registerErrors = await validate(registerDto);
    expect(registerErrors.length).toBeGreaterThan(0);

    // LoginDto — invalid email
    const loginDto = plainToInstance(LoginDto, {
      email: 'not-an-email',
      password: '',
    });
    const loginErrors = await validate(loginDto);
    expect(loginErrors.length).toBeGreaterThan(0);

    // ForgotPasswordDto — empty email
    const forgotDto = plainToInstance(ForgotPasswordDto, { email: '' });
    const forgotErrors = await validate(forgotDto);
    expect(forgotErrors.length).toBeGreaterThan(0);

    // ResetPasswordDto — short password
    const resetDto = plainToInstance(ResetPasswordDto, {
      token: '',
      password: 'short',
    });
    const resetErrors = await validate(resetDto);
    expect(resetErrors.length).toBeGreaterThan(0);
  });

  it('should set httpOnly cookies on register/login', async () => {
    const mockRes = {
      cookie: jest.fn(),
    } as any;

    // Test register
    await controller.register(
      { name: 'Test', email: 'test@example.com', password: 'Test1234' },
      mockRes,
    );

    expect(mockRes.cookie).toHaveBeenCalledTimes(2);
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'access_token',
      'at',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'rt',
      expect.objectContaining({ httpOnly: true }),
    );

    jest.clearAllMocks();

    // Test login
    await controller.login(
      { email: 'test@example.com', password: 'Test1234' },
      mockRes,
    );

    expect(mockRes.cookie).toHaveBeenCalledTimes(2);
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'access_token',
      'at',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'rt',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('should set 30-day refresh cookie maxAge when rememberMe=true', async () => {
    mockAuthService.login.mockResolvedValueOnce({
      user: { id: 'uuid', name: 'Test', email: 'test@example.com' },
      accessToken: 'at',
      refreshToken: 'rt',
      cookieMaxAge: COOKIE_MAX_AGE_REMEMBER,
    });

    const mockRes = { cookie: jest.fn() } as any;

    await controller.login(
      { email: 'test@example.com', password: 'Test1234', rememberMe: true },
      mockRes,
    );

    expect(mockRes.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'rt',
      expect.objectContaining({ maxAge: COOKIE_MAX_AGE_REMEMBER }),
    );
  });

  it('should set 7-day refresh cookie maxAge when rememberMe=false', async () => {
    const mockRes = { cookie: jest.fn() } as any;

    await controller.login(
      { email: 'test@example.com', password: 'Test1234', rememberMe: false },
      mockRes,
    );

    expect(mockRes.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'rt',
      expect.objectContaining({ maxAge: COOKIE_MAX_AGE_DEFAULT }),
    );
  });

  it('should clear cookies on logout', async () => {
    const mockReq = {
      user: { userId: 'user-uuid' },
    } as any;
    const mockRes = {
      clearCookie: jest.fn(),
    } as any;

    await controller.logout(mockReq, mockRes);

    expect(mockAuthService.logout).toHaveBeenCalledWith('user-uuid');
    expect(mockRes.clearCookie).toHaveBeenCalledWith('access_token', {
      path: '/',
    });
    expect(mockRes.clearCookie).toHaveBeenCalledWith('refresh_token', {
      path: '/api/v1/auth',
    });
  });

  // ===========================================================================
  // GET /auth/verify-reset-token (2 tests)
  // ===========================================================================
  describe('GET /auth/verify-reset-token', () => {
    it('should return { valid: true } for a valid token', async () => {
      const result = await controller.verifyResetToken('valid_token');

      expect(mockAuthService.verifyResetToken).toHaveBeenCalledWith('valid_token');
      expect(result).toEqual({
        data: { valid: true },
        message: 'Token is valid',
      });
    });

    it('should propagate BadRequestException from service', async () => {
      mockAuthService.verifyResetToken.mockRejectedValueOnce(
        new BadRequestException({ message: 'Invalid or expired reset token', errorCode: 'INVALID_RESET_TOKEN' }),
      );

      await expect(controller.verifyResetToken('bad_token')).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // POST /auth/send-verification (3 tests)
  // ===========================================================================
  describe('POST /auth/send-verification', () => {
    it('should call authService.sendVerificationCode with userId and ip', async () => {
      const mockReq = { user: { userId: 'user-uuid' }, ip: '127.0.0.1' } as any;

      await controller.sendVerification(mockReq);

      expect(mockAuthService.sendVerificationCode).toHaveBeenCalledWith(
        'user-uuid',
        '127.0.0.1',
      );
    });

    it('should return 200 with correct message', async () => {
      const mockReq = { user: { userId: 'user-uuid' } } as any;

      const result = await controller.sendVerification(mockReq);

      expect(result).toEqual({
        data: null,
        message: 'Verification code sent to your email',
      });
    });

    it('should propagate errors from authService', async () => {
      const mockReq = { user: { userId: 'user-uuid' } } as any;
      mockAuthService.sendVerificationCode.mockRejectedValueOnce(
        new BadRequestException('Email already verified'),
      );

      await expect(controller.sendVerification(mockReq)).rejects.toThrow(
        'Email already verified',
      );
    });
  });

  // ===========================================================================
  // POST /auth/verify-email (3 tests)
  // ===========================================================================
  describe('POST /auth/verify-email', () => {
    it('should call authService.verifyEmail with userId and code', async () => {
      const mockReq = { user: { userId: 'user-uuid' } } as any;

      await controller.verifyEmail(mockReq, { code: '123456' } as any);

      expect(mockAuthService.verifyEmail).toHaveBeenCalledWith(
        'user-uuid',
        '123456',
      );
    });

    it('should return 200 with emailVerified data on success', async () => {
      const mockReq = { user: { userId: 'user-uuid' } } as any;

      const result = await controller.verifyEmail(mockReq, {
        code: '123456',
      } as any);

      expect(result).toEqual({
        data: { emailVerified: true },
        message: 'Email verified successfully',
      });
    });

    it('should propagate errors from authService', async () => {
      const mockReq = { user: { userId: 'user-uuid' } } as any;
      mockAuthService.verifyEmail.mockRejectedValueOnce(
        new BadRequestException('Invalid verification code'),
      );

      await expect(
        controller.verifyEmail(mockReq, { code: '999999' } as any),
      ).rejects.toThrow('Invalid verification code');
    });
  });

  // ===========================================================================
  // POST /auth/verify-email DTO validation (3 tests)
  // ===========================================================================
  describe('POST /auth/verify-email — DTO validation', () => {
    it('should reject body without code', async () => {
      const dto = plainToInstance(VerifyEmailDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject code shorter or longer than 6 digits', async () => {
      for (const code of ['12345', '1234567']) {
        const dto = plainToInstance(VerifyEmailDto, { code });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      }
    });

    it('should reject code containing letters', async () => {
      for (const code of ['abcdef', '12ab56', 'ABCDEF']) {
        const dto = plainToInstance(VerifyEmailDto, { code });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // POST /auth/resend-verification (3 tests)
  // ===========================================================================
  describe('POST /auth/resend-verification', () => {
    it('should call authService.sendVerificationCode with userId and ip', async () => {
      const mockReq = { user: { userId: 'user-uuid' }, ip: '127.0.0.1' } as any;

      await controller.resendVerification(mockReq);

      expect(mockAuthService.sendVerificationCode).toHaveBeenCalledWith(
        'user-uuid',
        '127.0.0.1',
      );
    });

    it('should return 200 with resent message', async () => {
      const mockReq = { user: { userId: 'user-uuid' } } as any;

      const result = await controller.resendVerification(mockReq);

      expect(result).toEqual({
        data: null,
        message: 'Verification code resent to your email',
      });
    });

    it('should use same sendVerificationCode method as send-verification', async () => {
      const mockReq = { user: { userId: 'user-uuid' } } as any;

      await controller.sendVerification(mockReq);
      await controller.resendVerification(mockReq);

      // Both endpoints call the same service method
      expect(mockAuthService.sendVerificationCode).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // GET /auth/dev/latest-code/:email (4 tests)
  // ===========================================================================
  describe('GET /auth/dev/latest-code/:email', () => {
    it('should return the latest code in non-production', async () => {
      const result = await controller.getLatestCode('test@example.com');

      expect(mockAuthService.getLatestCodeByEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(result).toEqual({
        data: { code: '654321' },
        message: 'Success',
      });
    });

    it('should throw 403 in production', async () => {
      // Create a production controller
      mockConfigService.get.mockReturnValue('production');
      const module: TestingModule = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: mockAuthService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const prodController = module.get<AuthController>(AuthController);

      await expect(
        prodController.getLatestCode('test@example.com'),
      ).rejects.toThrow(ForbiddenException);

      // Reset for other tests
      mockConfigService.get.mockReturnValue('development');
    });

    it('should throw 404 if no code exists', async () => {
      mockAuthService.getLatestCodeByEmail.mockRejectedValueOnce(
        new BadRequestException('No verification code found'),
      );

      await expect(
        controller.getLatestCode('nocode@example.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 if user not found', async () => {
      mockAuthService.getLatestCodeByEmail.mockRejectedValueOnce(
        new BadRequestException('User not found'),
      );

      await expect(
        controller.getLatestCode('nobody@example.com'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
