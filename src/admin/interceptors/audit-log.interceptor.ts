import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

interface AdminAuditMetadata {
  userId: string;
  userEmail: string;
  roles: string[];
  action: string;
  route: string;
  method: string;
  timestamp: string;
  ip: string;
  userAgent?: string;
}

interface AdminAuditEntry extends AdminAuditMetadata {
  outcome: 'success' | 'error';
  statusCode?: number;
}

interface RequestUser {
  userId?: string;
  email?: string;
  roles?: string[];
}

interface AdminRequest {
  method: string;
  route?: { path: string };
  user?: RequestUser;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * AuditLogInterceptor — emits one structured audit entry per admin mutation
 * (POST/PATCH/PUT/DELETE); reads (GET/HEAD/OPTIONS) skip emission via the
 * method gate. Reads the matched route pattern from `req.route.path`, so
 * raw IDs/UUIDs never leak into the `route` field. `Logger.log` is wrapped
 * in try/catch (a failing transport never breaks the request) and errors
 * are re-thrown for the global `HttpExceptionFilter`.
 *
 * Activation is per-controller via the `@AdminEndpoint()` composite
 * (`src/admin/common/decorators/admin-endpoint.decorator.ts`); never
 * registered as `APP_INTERCEPTOR`. `@AdminEndpointNoAudit()` deliberately
 * omits it. `AdminModule` provides + exports this class for its own
 * controllers; per-entity sub-modules under `AdminModule.imports` should
 * register it locally as a defensive convention so each sub-module is
 * self-contained and does not implicitly rely on NestJS's permissive
 * injector resolution. `CategoriesAdminModule` (KAN-82) established this
 * pattern; see `specs/015-categories-admin-crud/research.md` Decision 6.
 *
 * Logger context: `'AdminAudit'`. The Nest application logger is the only
 * sink — DB persistence is explicitly out of scope. Full contract in
 * `specs/014-admin-foundation/contracts/audit-log.contract.md`.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AdminAudit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AdminRequest>();

    if (!MUTATING_METHODS.has(req.method) || !req.route?.path) {
      return next.handle();
    }

    const meta = this.buildMetadata(req);

    return next.handle().pipe(
      tap({
        next: () => this.safelyLog({ ...meta, outcome: 'success' }),
      }),
      catchError((err: unknown) => {
        const statusCode =
          err instanceof HttpException ? err.getStatus() : undefined;
        this.safelyLog({ ...meta, outcome: 'error', statusCode });
        return throwError(() => err);
      }),
    );
  }

  private buildMetadata(req: AdminRequest): AdminAuditMetadata {
    const route = req.route!.path;
    const userAgentRaw = req.headers?.['user-agent'];
    const userAgent = Array.isArray(userAgentRaw) ? userAgentRaw[0] : userAgentRaw;

    return {
      userId: req.user?.userId ?? '',
      userEmail: req.user?.email ?? '',
      roles: req.user?.roles ?? [],
      action: `${req.method} ${route}`,
      route,
      method: req.method,
      timestamp: new Date().toISOString(),
      ip: req.ip ?? '',
      userAgent,
    };
  }

  private safelyLog(entry: AdminAuditEntry): void {
    try {
      this.logger.log(entry);
    } catch {
      // Best-effort: never propagate logger failures into the request pipeline.
    }
  }
}
