# Health Check — Backend Spec (awamer-api)

> **Module:** `HealthModule`
> **Endpoint:** `GET /api/v1/health`
> **Decorator:** `@Public()`
> **Status code:** `200 OK`

---

## 1. Summary

`GET /health` returns a short JSON object describing the process's
connectivity to its two runtime dependencies (Postgres and Redis)
and its uptime in seconds. It is the single canary endpoint for
load balancers, readiness probes, and on-call dashboards.

The endpoint **always** returns HTTP 200 — the `status` field in the
response body is how a degraded state is communicated, not the HTTP
code. This is deliberate: an unhealthy API still wants its health
endpoint reachable so that monitoring can distinguish "process is
alive but degraded" from "process is dead".

---

## 2. Request

```
GET /api/v1/health
```

No body, no headers required, no auth. `@Public()` exempts it from
the global `JwtAuthGuard`. Not rate-limited above the global default.

---

## 3. Behavior — `HealthController.check()`

Source: `src/health/health.controller.ts` `check()`.

```ts
const [database, cacheState] = await Promise.all([
  this.checkDatabase(),
  this.cache.isHealthy().then((ok): ConnectivityState =>
    ok ? 'connected' : 'disconnected',
  ),
]);

return {
  status: database === 'connected' ? 'ok' : 'degraded',
  database,
  cache: cacheState,
  uptime: Math.floor(process.uptime()),
};
```

The two probes run in parallel via `Promise.all`, then the handler
constructs the response body.

### 3.1 Database probe — `checkDatabase()`

```ts
const DB_TIMEOUT_MS = 500;

try {
  await Promise.race([
    this.prisma.$queryRaw`SELECT 1`,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('db-check-timeout')),
        DB_TIMEOUT_MS,
      ),
    ),
  ]);
  return 'connected';
} catch {
  return 'disconnected';
}
```

- Runs `SELECT 1` against the Prisma connection.
- Races the query against a **500ms timeout**. Any slower response
  is treated as `disconnected`. This is intentionally tight — a
  sluggish Postgres is a problem worth reporting.
- Any exception (connection refused, auth failure, timeout) →
  `disconnected`.
- No retry, no logging. The goal is a fast, truthful status.

### 3.2 Cache probe — `CacheService.isHealthy()`

```ts
async isHealthy(): Promise<boolean> {
  try {
    const pong = await this.redis.ping();
    return pong === 'PONG';
  } catch (err) {
    this.logger.warn(`cache.isHealthy() failed: ${(err as Error).message}`);
    return false;
  }
}
```

- `PING` → expects `PONG`.
- Anything else, or an exception, → `false`.
- The helper does not have its own timeout; it relies on ioredis's
  `maxRetriesPerRequest: 3` (see
  [../cache/redis-provider.md](../cache/redis-provider.md)). In
  practice the ping completes in single-digit ms or fails fast.

See [../cache/cache-service.md §8](../cache/cache-service.md) for
the "only method that is not never-throw" note.

---

## 4. `status` field — the degradation rule

```
status = (database === 'connected') ? 'ok' : 'degraded'
```

Only the **database** probe affects the top-level `status`. A Redis
outage alone is reported as `cache: 'disconnected'` but leaves
`status: 'ok'`. Reasoning:

- The database is the authoritative source of truth. If it is down,
  nothing works.
- The cache layer is explicitly non-critical
  ([../cache/cache-service.md](../cache/cache-service.md)): cache
  failures degrade to cache misses, which serve correct data from
  the DB.
- Flipping `status` to `degraded` on a Redis blip would page the
  on-call engineer for a non-issue.

If you need to alert on Redis health, branch on the `cache` field
directly from your monitoring tool.

---

## 5. Successful response

```
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "data": {
    "status": "ok",
    "database": "connected",
    "cache": "connected",
    "uptime": 12345
  },
  "message": "Success"
}
```

All four fields are always present. `uptime` is `process.uptime()`
floored to seconds.

### Degraded example

Database slow or unreachable, Redis fine:

```json
{
  "data": {
    "status": "degraded",
    "database": "disconnected",
    "cache": "connected",
    "uptime": 87
  },
  "message": "Success"
}
```

The HTTP status is still `200`.

---

## 6. Error responses

`GET /health` has no business-logic error path. The only failure the
endpoint surfaces is:

| Status | When |
|--------|------|
| 429 `RATE_LIMIT_EXCEEDED` | The global throttler tripped. Extremely unlikely unless a monitoring loop is misconfigured. |

---

## 7. Side effects

None. Both probes are read-only. No rows are written, no cache keys
are set.

---

## 8. Files involved

| File | Role |
|------|------|
| `src/health/health.controller.ts` | The `check()` handler and the DB probe with its timeout race |
| `src/health/health.module.ts` | Module wiring — imports `PrismaModule` and relies on the global `CacheModule` for `CacheService` |
| `src/common/cache/cache.service.ts` | `isHealthy()` used by the cache probe |
| `src/common/decorators/public.decorator.ts` | Marks the route as JWT-exempt |

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/health/health.controller.spec.ts` | All four combinations of `database`/`cache` connected/disconnected, the 500ms timeout branch, the `uptime` shape (integer seconds), the "only DB affects `status`" rule. |

---

## 10. Things NOT to change without coordination

- The 500ms database timeout. Monitoring thresholds are tuned
  against this value.
- The "only DB affects `status`" rule. Flipping on Redis too would
  cause on-call pages during transient Redis blips that do not
  affect user-visible behavior.
- The `@Public()` decorator. Load balancers cannot authenticate.
- The response shape. Cloud probes and Grafana panels parse these
  fields directly.
- Returning HTTP 200 even when degraded. Returning 503 would break
  load-balancer detection of "process is alive but cache is slow".
