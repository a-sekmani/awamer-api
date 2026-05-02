import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { CategoriesAdminModule } from './categories/categories-admin.module';
import { AdminHealthController } from './controllers/admin-health.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';

/**
 * AdminModule — central container for every per-entity admin sub-module.
 *
 * `RolesGuard` and `AuditLogInterceptor` are provided + exported as regular
 * providers, but those exports only serve `AdminModule`'s own controllers
 * (e.g. `AdminHealthController`). Per-entity sub-modules registered under
 * `AdminModule.imports` should register both providers locally in their own
 * `providers` array as a defensive convention — keeps each sub-module
 * self-contained and removes implicit reliance on NestJS's permissive
 * injector resolution. `CategoriesAdminModule` (KAN-82) established this
 * pattern; see `specs/015-categories-admin-crud/research.md` Decision 6.
 *
 * Per-entity sub-modules MUST still be registered via `AdminModule.imports`
 * (NOT `AppModule.imports`) so the `/admin/<entities>` route prefix is
 * unambiguously admin-scoped and `AdminModule` remains the single
 * discoverable choke point listing every admin sub-module.
 *
 * See `docs/admin/conventions.md` §2.3–2.4 for the full sub-module recipe.
 */
@Module({
  imports: [AuthModule, CategoriesAdminModule],
  controllers: [AdminHealthController],
  providers: [RolesGuard, AuditLogInterceptor],
  exports: [RolesGuard, AuditLogInterceptor],
})
export class AdminModule {}
