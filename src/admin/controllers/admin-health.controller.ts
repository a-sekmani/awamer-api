import { Controller, Get, Post } from '@nestjs/common';
import { AdminEndpoint } from '../common/decorators/admin-endpoint.decorator';

/**
 * AdminHealthController — wiring smoke test for the admin foundation stack.
 *
 * Exists to exercise:
 *   - `JwtAuthGuard` (authentication)
 *   - `RolesGuard` (admin-only authorization)
 *   - `AuditLogInterceptor` (logs POST/PATCH/PUT/DELETE; GETs are skipped internally)
 *
 * The POST handler returns the same payload as GET — its only purpose is to
 * give the e2e suite a mutation method against which to verify audit log
 * emission (per FR-019/FR-020). It carries no product surface.
 *
 * Uses `@AdminEndpoint()` (with audit) at the class level: GET requests still
 * pass through the interceptor, but the interceptor's method gate filters them
 * out (FR-023), so reads do not pollute the audit trail.
 */
@Controller('admin/__ping')
@AdminEndpoint()
export class AdminHealthController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }

  @Post()
  postPing(): { ok: true } {
    return { ok: true };
  }
}
