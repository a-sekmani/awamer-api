import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ErrorCode } from '../error-codes.enum';

@Injectable()
export class OnboardingCompletedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as {
      userId: string;
      onboardingCompleted: boolean;
    };

    if (!user?.onboardingCompleted) {
      throw new ForbiddenException({
        message:
          'Onboarding required. Please complete onboarding before accessing this resource',
        errorCode: ErrorCode.ONBOARDING_REQUIRED,
      });
    }

    return true;
  }
}
