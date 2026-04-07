import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../common/guards/email-verified.guard';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SubmitOnboardingDto } from './dto/onboarding.dto';

const COOKIE_MAX_AGE_DEFAULT = 7 * 24 * 60 * 60 * 1000;

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  private readonly isProduction: boolean;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
  }

  @Get('me/onboarding')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getOnboardingStatus(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    const result = await this.usersService.getOnboardingStatus(userId);
    return { data: result, message: 'Success' };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getMe(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    const result = await this.usersService.getMe(userId);
    return { data: result, message: 'Success' };
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async updateUser(@Req() req: Request, @Body() dto: UpdateUserDto) {
    const { userId } = req.user as { userId: string };
    const user = await this.usersService.updateUser(userId, dto);
    return { data: { user }, message: 'Success' };
  }

  @Patch('me/profile')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const { userId } = req.user as { userId: string };
    const profile = await this.usersService.updateProfile(userId, dto);
    return { data: { profile }, message: 'Success' };
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async changePassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    const { userId } = req.user as { userId: string };
    await this.usersService.changePassword(userId, dto);
    return { data: null, message: 'Password updated' };
  }

  @Post('me/onboarding')
  @UseGuards(EmailVerifiedGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async submitOnboarding(
    @Req() req: Request,
    @Body() dto: SubmitOnboardingDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId } = req.user as { userId: string };
    const { profile, accessToken, refreshToken } =
      await this.usersService.submitOnboarding(userId, dto);

    this.setCookies(res, accessToken, refreshToken);

    return { data: { profile }, message: 'Success' };
  }

  private setCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_DEFAULT,
      path: '/api/v1/auth',
    });
  }
}
