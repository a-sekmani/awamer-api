import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ErrorCode } from '../error-codes.enum';

const DEFAULT_ADMIN_REQUIRED: readonly string[] = [Role.ADMIN];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context
      .switchToHttp()
      .getRequest<{ user?: { roles?: string[] } }>();
    const user = req.user;

    if (!user) {
      throw new UnauthorizedException({
        errorCode: ErrorCode.UNAUTHORIZED,
        message: 'Authentication required.',
      });
    }

    const requiredRoles =
      required && required.length > 0 ? required : DEFAULT_ADMIN_REQUIRED;

    const userRoles = user.roles ?? [];
    const allowed = requiredRoles.some((r) => userRoles.includes(r));

    if (!allowed) {
      throw new ForbiddenException({
        errorCode: ErrorCode.INSUFFICIENT_ROLE,
        message: 'Insufficient role.',
      });
    }

    return true;
  }
}
