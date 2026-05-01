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
 * AuditLogInterceptor — emits a structured audit entry for every mutation
 * (POST/PATCH/PUT/DELETE) on a route mounted under `AdminModule`.
 *
 * Registered as `APP_INTERCEPTOR` provider INSIDE `AdminModule`, NOT globally,
 * so it only fires inside admin scope. Sub-modules imported via
 * `AdminModule.imports` inherit this automatically.
 *
 * - Reads the matched route pattern from `req.route.path` (e.g. `/admin/users/:id`).
 *   Raw IDs/UUIDs in the URL never leak into the `route` field.
 * - Reads `req.user` populated by the global `JwtAuthGuard`.
 * - Skips emission for GET/HEAD/OPTIONS and when `req.route` is undefined.
 * - Wraps `Logger.log` in try/catch so a failing logger never fails the request.
 * - Re-throws original errors so the global `HttpExceptionFilter` formats them normally.
 *
 * See `specs/014-admin-foundation/contracts/audit-log.contract.md` for the
 * complete contract.
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
