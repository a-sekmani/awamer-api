import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const mockAuthService = {
  register: jest.fn().mockResolvedValue({
    user: { id: 'uuid', name: 'Test', email: 'test@example.com' },
    accessToken: 'at',
    refreshToken: 'rt',
  }),
  login: jest.fn().mockResolvedValue({
    user: { id: 'uuid', name: 'Test', email: 'test@example.com' },
    accessToken: 'at',
    refreshToken: 'rt',
  }),
  logout: jest.fn().mockResolvedValue(undefined),
  refresh: jest.fn().mockResolvedValue({
    user: { id: 'uuid', name: 'Test', email: 'test@example.com' },
    accessToken: 'at',
    refreshToken: 'rt',
  }),
  forgotPassword: jest.fn().mockResolvedValue(undefined),
  resetPassword: jest.fn().mockResolvedValue(undefined),
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
});
