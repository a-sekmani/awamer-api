# Throttler Storage — Backend Reference (awamer-api)

> **Package:** `@nest-lab/throttler-storage-redis`
> **Wiring:** `src/app.module.ts` — `ThrottlerModule.forRootAsync`
> **Storage backend:** the shared `REDIS_CLIENT` (same connection as `CacheService`)

Before epic E3 the global throttler used Nest's default in-memory
storage. KAN-74 switched to Redis so that counters survive process
restarts and are shared across horizontally-scaled instances. This
document covers the wiring, the default limits, and the test-time
footguns that the switch introduced.

---

## 1. The config

`src/app.module.ts`:

```ts
ThrottlerModule.forRootAsync({
  imports: [CacheModule],
  inject: [ConfigService, REDIS_CLIENT],
  useFactory: (config: ConfigService, redis: Redis) => ({
    throttlers: [
      {
        ttl:   config.get<number>('THROTTLE_TTL',   60000),
        limit: config.get<number>('THROTTLE_LIMIT', 100),
      },
    ],
    storage: new ThrottlerStorageRedisService(redis),
  }),
})
```

Points to note:

- **`imports: [CacheModule]`** — makes the shared `REDIS_CLIENT`
  token available to the factory. `CacheModule` is the only module
  that provides it.
- **Single throttler named `'default'`.** Per-route overrides use the
  `default` key: `@Throttle({ default: { limit: 5, ttl: 60000 } })`.
- **`ttl` is milliseconds**, `limit` is an integer count.

### Defaults

| Env var | Default |
|---------|---------|
| `THROTTLE_TTL` | `60000` (60 seconds) |
| `THROTTLE_LIMIT` | `100` (requests) |

So by default: **100 requests per 60 seconds per IP per route**,
applied globally unless a route overrides it.

---

## 2. `ThrottlerGuard` wiring

```ts
{ provide: APP_GUARD, useClass: ThrottlerGuard }
```

Registered in `app.module.ts` alongside `JwtAuthGuard`. It runs on
every request and raises `ThrottlerException` (→ HTTP 429) when the
limit is exceeded. `HttpExceptionFilter` normalizes this to the
standard error envelope with
`errorCode: ErrorCode.RATE_LIMIT_EXCEEDED` when the exception
provides it.

---

## 3. Why Redis storage

Before KAN-74 the throttler used the Nest in-memory store. That
worked for a single-instance dev deployment but was wrong for two
reasons:

1. **Counters did not survive process restarts.** A rolling deploy
   reset every counter; an attacker could rate-limit-evade by
   timing a burst to the deploy window.
2. **Counters were per-instance.** A horizontally-scaled deployment
   would allow `instances × limit` per window instead of `limit` per
   window.

Redis-backed storage fixes both: counters are durable across
restarts and shared across instances.

---

## 4. Test implications (the footgun)

Because counters are now in Redis, **they persist across test
runs**. A spec that exercises a throttled endpoint can leak state
into the next run.

### Required pattern

Every e2e spec that touches a throttled endpoint — which is
effectively every e2e spec, because the global `ThrottlerGuard`
covers everything — must flush Redis in `beforeEach`:

```ts
import Redis from 'ioredis';

let redis: Redis;

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL!);
});

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});
```

Or — more commonly — call `flushdb()` via the app's own Redis client
pulled from DI:

```ts
const redis = app.get<Redis>(REDIS_CLIENT);
await redis.flushdb();
```

`flushdb()` also clears `CacheService` state. That is almost always
what you want in a test.

### Symptoms of forgetting

- First few tests pass, later tests return `429 Too Many Requests`
  for no apparent reason.
- Flaky runs where tests pass individually but fail when the suite
  is run as a whole.
- CI passes but local runs fail (CI starts with an empty Redis; a
  long-lived local Redis accumulates state).

See also [../development/testing.md §4](../development/testing.md).

---

## 5. Per-route overrides

The existing auth routes use `@Throttle({ default: { limit, ttl } })`:

```ts
@Throttle({ default: { limit: 5,  ttl: 60000 } })  // login
@Throttle({ default: { limit: 10, ttl: 60000 } })  // register, verify-email
```

New content routes generally rely on the global default. The public
certificate verify endpoint overrides with `{ limit: 30, ttl: 60000 }`
since it is called by a public QR-code scanner.

When adding a new route, default to the global limit. Add an
override only if the route needs stricter limits (auth surfaces) or
looser limits (very-high-traffic public endpoints).

---

## 6. Tests

The throttler storage itself has no unit spec — the package is
upstream. Coverage comes from e2e specs that intentionally exceed
the per-route limit and assert a `429`. See
`test/auth.e2e-spec.ts` for the canonical example.

---

## 7. Things NOT to change without coordination

- The shared `REDIS_CLIENT`. If you create a second Redis client for
  the throttler, every test flush has to cover both, and the
  connection pool doubles for no benefit.
- The `THROTTLE_TTL` / `THROTTLE_LIMIT` defaults without a capacity
  review. The current defaults are tuned for the staging mix of
  traffic.
- The single-throttler-named-default wiring. Some Nest guides
  recommend multiple named throttlers; the project does not use them
  and adding one would require every `@Throttle(...)` decorator to
  be updated.
- The `flushdb()`-in-beforeEach convention for tests. Forgetting it
  is the number-one source of flaky CI in this repo.
