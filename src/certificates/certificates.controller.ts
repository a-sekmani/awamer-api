import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CertificatesService } from './certificates.service';
import { CertificateResponseDto } from './dto/certificate-response.dto';
import { CertificateVerificationDto } from './dto/certificate-verification.dto';

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async listForUser(
    @Req() req: Request,
  ): Promise<{ certificates: CertificateResponseDto[] }> {
    const { userId } = req.user as { userId: string };
    return { certificates: await this.certificates.listForUser(userId) };
  }

  // Public verification endpoint. C2 resolution: tighter throttle than the
  // global default (30/60s vs. 100/60s) to slow hostile scanning bots while
  // leaving legitimate employer verification traffic unaffected.
  @Get('verify/:code')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async verify(
    @Param('code') code: string,
  ): Promise<CertificateVerificationDto> {
    return this.certificates.verifyByCode(code);
  }
}
