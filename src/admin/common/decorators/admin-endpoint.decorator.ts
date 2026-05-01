import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AuditLogInterceptor } from '../../interceptors/audit-log.interceptor';

/**
 * Standard admin endpoint — requires authentication, ADMIN role, and emits
 * audit logs on mutations. Apply at the controller class level.
 *
 * This is the canonical decorator for all admin endpoints. It bundles:
 *   - JwtAuthGuard         (authentication; idempotent with the global JwtAuthGuard)
 *   - RolesGuard           (authorization, requires ADMIN role)
 *   - AuditLogInterceptor  (logs POST/PATCH/PUT/DELETE; GET/HEAD/OPTIONS are skipped internally)
 *   - @Roles(Role.ADMIN)   (metadata read by RolesGuard)
 *
 * @example
 *   @Controller('admin/categories')
 *   @AdminEndpoint()
 *   export class CategoriesAdminController { ... }
 *
 * NOTE on activation scope:
 *   We discovered during implementation that NestJS APP_GUARD / APP_INTERCEPTOR
 *   providers declared inside a non-root module are still registered app-globally
 *   (the module placement only affects DI resolution, not activation scope).
 *   So instead of relying on `AdminModule.imports` cascade, every admin controller
 *   opts in explicitly via this composite decorator.
 */
export const AdminEndpoint = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard, RolesGuard),
    UseInterceptors(AuditLogInterceptor),
    Roles(Role.ADMIN),
  );

/**
 * Admin endpoint that skips audit logging.
 *
 * Use ONLY for telemetry / health-check endpoints (e.g. `__ping`) where audit
 * trail entries would be noise rather than signal. Behavior is otherwise
 * identical to {@link AdminEndpoint}.
 *
 * @example
 *   @Controller('admin/__ping')
 *   @AdminEndpointNoAudit()
 *   export class AdminHealthController { ... }
 */
export const AdminEndpointNoAudit = () =>
  applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), Roles(Role.ADMIN));
