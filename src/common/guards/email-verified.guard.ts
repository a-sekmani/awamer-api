import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_EMAIL_VERIFICATION_KEY } from '../decorators/skip-email-verification.decorator';

@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipVerification = this.reflector.getAllAndOverride<boolean>(
      SKIP_EMAIL_VERIFICATION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipVerification) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const { userId } = request.user as { userId: string };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });

    if (!user || !user.emailVerified) {
      throw new ForbiddenException(
        'Email verification required. Please verify your email before accessing this resource',
      );
    }

    return true;
  }
}
