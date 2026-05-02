import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { CacheModule } from '../../common/cache/cache.module';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogInterceptor } from '../interceptors/audit-log.interceptor';
import { CategoriesAdminController } from './categories-admin.controller';
import { CategoriesAdminService } from './categories-admin.service';

/**
 * CategoriesAdminModule — first per-entity admin module on the KAN-78 foundation.
 *
 * `RolesGuard` and `AuditLogInterceptor` MUST be registered locally as providers
 * here (FR-005a) — NestJS DI imports are unidirectional, so even though
 * AdminModule exports both providers, sub-modules registered under
 * AdminModule.imports do NOT receive them automatically. Both providers are
 * stateless (Reflector / Logger only), so per-module instances are free.
 *
 * See research.md Decision 6 for the diagnosis.
 */
@Module({
  imports: [PrismaModule, CacheModule, AuthModule],
  controllers: [CategoriesAdminController],
  providers: [CategoriesAdminService, RolesGuard, AuditLogInterceptor],
})
export class CategoriesAdminModule {}
