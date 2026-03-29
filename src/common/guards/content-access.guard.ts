import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class ContentAccessGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    // Stub: always allow — full implementation deferred to SubscriptionsModule feature
    return true;
  }
}
