import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class EnrollmentGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    // Stub: always allow — full implementation deferred to ProgressModule feature
    return true;
  }
}
