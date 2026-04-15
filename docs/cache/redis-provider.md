# Redis Provider — Backend Reference (awamer-api)

> **Source:** `src/common/cache/redis.provider.ts`
> **Injection token:** `REDIS_CLIENT` (symbol)
> **Client library:** `ioredis`

The single source of Redis connectivity. Every caller (`CacheService`,
`ThrottlerModule` storage, future consumers) receives the same ioredis
client instance via DI.

---

## 1. The provider

```ts
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      throw new Error('REDIS_URL is required but was not provided');
    }
    const useTls = url.startsWith('rediss://');
    const logger = new Logger('RedisClient');
    const client = new Redis(url, {
      tls: useTls ? {} : undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    client.on('connect', () => {
      logger.log(`Connected to ${url.replace(/\/\/.*@/, '//***@')}`);
    });
    client.on('error', (err) => {
      logger.warn(`Redis error: ${err.message}`);
    });
    return client;
  },
};
```

---

## 2. `REDIS_URL`

Declared in `app.module.ts` Joi validation schema:

```ts
REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] })
  .default('redis://localhost:6379'),
```

- **Required** in production (Joi default applies only when unset).
- Scheme must be `redis://` or `rediss://`.
- `rediss://` enables TLS by setting `tls: {}` in the ioredis config.

Local development uses `redis://localhost:6379` against the
`redis` service defined in
[../infrastructure/docker-compose.md](../infrastructure/docker-compose.md).

---

## 3. Connection behavior

| Option | Value | Rationale |
|--------|-------|-----------|
| `lazyConnect` | `false` | Eager connect at startup so `isHealthy()` reflects real state the first time `GET /health` is called. |
| `maxRetriesPerRequest` | `3` | Finite retry budget per command. Fourth failure surfaces as an error on the caller — which `CacheService` catches and degrades to a cache miss. |
| `tls` | `{}` on `rediss://`, otherwise undefined | Minimal TLS config, trust the default CA bundle. |

### Event handlers

- `'connect'` → logs `Connected to <url>` at `log` level. The URL's
  password is scrubbed via `url.replace(/\/\/.*@/, '//***@')` before
  logging.
- `'error'` → logs at `warn` level. ioredis emits this for transient
  issues too; it is not necessarily a hard failure.

---

## 4. Shared between `CacheService` and the throttler

Two consumers inject the same `REDIS_CLIENT` symbol:

1. **`CacheService`** — `@Inject(REDIS_CLIENT) private readonly redis: Redis`.
2. **`ThrottlerModule`** (in `app.module.ts`) — passes the same client
   to `ThrottlerStorageRedisService(redis)` to back the global
   throttler.

This is intentional: one connection, two uses. Throttler counters
and cache state live in the same Redis instance.

The sharing has a test-relevant consequence: `await redis.flushdb()`
in a test `beforeEach` resets **both** the throttler counters and
the cache. For almost every content/auth test, that is exactly what
you want — a clean slate on both axes.

---

## 5. Graceful shutdown

`CacheModule` (the `@Global()` module that registers this provider)
implements `OnModuleDestroy`:

```ts
async onModuleDestroy(): Promise<void> {
  const client = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false });
  if (client) await client.quit();
}
```

`.quit()` drains pending commands and sends a `QUIT` to the server
before closing the socket. Test harnesses rely on this to avoid
"open handle" warnings from Jest.

---

## 6. Tests

The provider itself has no dedicated unit spec — its behavior is
exercised transitively via `cache.service.spec.ts` and by every e2e
spec that calls `redis.flushdb()` in `beforeEach`.

---

## 7. Things NOT to change without coordination

- Sharing the client between `CacheService` and the throttler. If
  you split them, remember that every test that flushed "Redis"
  once now has to flush two instances.
- The `rediss://` → TLS mapping. Staging uses a managed Redis
  instance with TLS required; flipping the scheme is a deployment
  break.
- The `maxRetriesPerRequest: 3` budget. Raising it widens the
  window during which a Redis hiccup pauses request threads.
- The password-scrubbing regex in the connect log. Changing it
  risks leaking credentials into CloudWatch.
