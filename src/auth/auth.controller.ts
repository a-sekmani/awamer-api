import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto';
import { Public } from '../common/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';

const COOKIE_MAX_AGE_DEFAULT = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  private readonly isProduction: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const result = await this.authService.register(dto, ip);
    this.setCookies(res, result.accessToken, result.refreshToken, result.cookieMaxAge);
    return { data: { user: result.user }, message: 'Registration successful' };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    this.setCookies(res, result.accessToken, result.refreshToken, result.cookieMaxAge);
    return {
      data: { user: result.user },
      message: 'Login successful',
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as { userId: string };
    await this.authService.logout(user.userId);
    this.clearCookies(res);
    return { data: null, message: 'Logout successful' };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    const result = await this.authService.refresh(refreshToken);
    this.setCookies(res, result.accessToken, result.refreshToken, result.cookieMaxAge);
    return { data: { user: result.user }, message: 'Token refreshed' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    await this.authService.forgotPassword(dto, ip);
    return {
      data: null,
      message:
        'If an account with that email exists, a password reset link has been sent',
    };
  }

  @Public()
  @Get('verify-reset-token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyResetToken(@Query('token') token: string) {
    const result = await this.authService.verifyResetToken(token);
    return { data: result, message: 'Token is valid' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { data: null, message: 'Password reset successful' };
  }

  @Post('send-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async sendVerification(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    await this.authService.sendVerificationCode(userId, ip);
    return { data: null, message: 'Verification code sent to your email' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyEmail(
    @Req() req: Request,
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId } = req.user as { userId: string };
    const result = await this.authService.verifyEmail(userId, dto.code);
    this.setCookies(res, result.accessToken, result.refreshToken, COOKIE_MAX_AGE_DEFAULT);
    return { data: { emailVerified: result.emailVerified }, message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resendVerification(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    await this.authService.sendVerificationCode(userId, ip);
    return { data: null, message: 'Verification code resent to your email' };
  }

  private setCookies(res: Response, accessToken: string, refreshToken: string, refreshMaxAge: number) {
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: refreshMaxAge,
      path: '/api/v1/auth',
    });
  }

  private clearCookies(res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
  }
}
