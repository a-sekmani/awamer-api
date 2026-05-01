import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminHealthController } from './controllers/admin-health.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';

/**
 * AdminModule — central container for every per-entity admin sub-module.
 *
 * `RolesGuard` and `AuditLogInterceptor` are exported as regular providers so
 * sub-module controllers can consume them via the composite `@AdminEndpoint()`
 * decorator (see `src/admin/common/decorators/admin-endpoint.decorator.ts`).
 *
 * Per-entity sub-modules (Categories, Paths, Courses, Sections, Lessons,
 * Content Blocks, Users, etc.) MUST be registered via `AdminModule.imports`
 * (NOT in `AppModule.imports`) so they live inside `AdminModule`'s provider
 * scope and can resolve the exported providers + apply the composite decorator.
 *
 * See `docs/admin-foundation.md` and `specs/014-admin-foundation/quickstart.md`.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminHealthController],
  providers: [RolesGuard, AuditLogInterceptor],
  exports: [RolesGuard, AuditLogInterceptor],
})
export class AdminModule {}
