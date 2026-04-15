# Contract — Extended `GET /api/v1/health`

**File**: `src/health/health.controller.ts`
**Current state** (audit finding #6): 11 lines; returns only `{ status: 'ok' }`.
**After this ticket**: returns `{ status, database, cache, uptime }`, implements live checks, remains `@Public()`.

## Response shape

```json
{
  "status": "ok" | "degraded",
  "database": "connected" | "disconnected",
  "cache": "connected" | "disconnected",
  "uptime": 12345
}
```

- `status` is `"ok"` when the database is connected; `"degraded"` when the database is disconnected. Cache disconnection does NOT change `status` (FR-024).
- `database` reflects a live `SELECT 1` via Prisma.
- `cache` reflects `CacheService.isHealthy()` — Redis PING success.
- `uptime` is `process.uptime()` rounded to an integer, seconds since the Node process started.

## Rules

1. The endpoint remains decorated with `@Public()` — no auth required; this is the liveness probe used by App Runner and load balancers.
2. The endpoint MUST return HTTP 200 in all cases, even when `status === "degraded"`. The probe consumer decides how to interpret the body. (Returning 503 would take the instance out of rotation on a DB blip; not desired for a non-critical probe.)
3. Both the database and cache checks MUST complete within 500 ms; any single check that exceeds this budget is treated as `"disconnected"` via `Promise.race` with a timeout.

## Implementation sketch

```typescript
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @Public()
  async check() {
    const [database, cache] = await Promise.all([
      this.checkDatabase(),
      this.cache.isHealthy().then(ok => (ok ? 'connected' : 'disconnected')),
    ]);
    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      cache,
      uptime: Math.floor(process.uptime()),
    };
  }

  private async checkDatabase(): Promise<'connected' | 'disconnected'> {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('db-check-timeout')), 500),
        ),
      ]);
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }
}
```

## Module wiring

`src/health/health.module.ts` must import `PrismaModule` (for `PrismaService`). `CacheService` is already globally available via `@Global()` `CacheModule` so no import is needed there.

## Test assertions (FR-022 – FR-024, FR-033e)

- With Redis and Postgres both up: response is `{ status: 'ok', database: 'connected', cache: 'connected', uptime: <number> }`, HTTP 200.
- With Redis stopped (simulated via bad URL in test setup): `cache: 'disconnected'`, `status` remains `'ok'`, HTTP 200.
- With Postgres unreachable (simulated): `database: 'disconnected'`, `status: 'degraded'`, HTTP 200.
- `uptime` is an integer and strictly greater than zero after the first request.
- Response returns within 1 second even when both checks hit their 500 ms timeout.
