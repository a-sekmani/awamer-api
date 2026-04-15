# CacheService — Backend Reference (awamer-api)

> **Class:** `CacheService`
> **Source:** `src/common/cache/cache.service.ts`
> **Module:** `CacheModule` (global — see [../api-conventions.md §11](../api-conventions.md))
> **Depends on:** `REDIS_CLIENT` (ioredis), `PrismaService`

`CacheService` is the single wrapper around the shared ioredis client.
Every content-domain service imports it for cache-aside reads and
invalidation on write. It has one non-negotiable contract: **nothing
on this class throws, except `isHealthy()`**. Cache failures degrade
to cache misses; they never cause a request to fail.

---

## 1. Summary

| Method | Returns | Throws? |
|--------|---------|---------|
| `get<T>(key)` | deserialized value or `null` on miss/error | no |
| `set<T>(key, value, ttlSeconds)` | `void` | no |
| `del(key)` | `true` if removed, `false` on miss/error | no |
| `delByPattern(pattern)` | number of keys removed | no |
| `invalidateOwner(type, id)` | `void` | no |
| `slugFor(type, id)` | slug string or `null` | no |
| `isHealthy()` | `boolean` | no (**but** is the only method whose return signals failure upstream) |

All failures are logged at `warn` with the method name and the
attempted key/pattern. See the implementation's header comment
(`src/common/cache/cache.service.ts` line 7–11) for the formal
"never-throw" contract tag (spec FR-002).

---

## 2. `get<T>(key)`

```ts
async get<T>(key: string): Promise<T | null>
```

- `redis.get(key)` → raw string.
- `null` → cache miss, return `null`.
- Otherwise → `JSON.parse(raw) as T`.
- Exception → log warning, return `null` (degraded as cache miss).

Consumers use this in the standard cache-aside shape:

```ts
const cached = await this.cache.get<PathSummaryDto[]>(key);
if (cached !== null) return cached;
// ... DB read + cache.set + return
```

The `T` generic is trust-based; there is no runtime shape check. If
a serialized shape changes, **invalidate the old key** rather than
relying on JSON.parse to reject it.

---

## 3. `set<T>(key, value, ttlSeconds)`

```ts
async set<T>(key: string, value: T, ttlSeconds: number | null): Promise<void>
```

- `JSON.stringify(value)`.
- `ttlSeconds === null` → `redis.set(key, raw)` (no expiry — the key
  lives until explicitly invalidated).
- `ttlSeconds` is a number → `redis.set(key, raw, 'EX', ttlSeconds)`.
- Exception → log warning, swallow.

The `null` TTL path is the default for "stable" keys
(`tags:all`, `categories:all`, `marketing:*`, `paths:detail:*`,
`courses:detail:*`). Time-bounded caches use `CacheTTL.LIST` (300s)
for paginated list responses only. See
[cache-keys.md](./cache-keys.md) for the full TTL table.

---

## 4. `del(key)`

```ts
async del(key: string): Promise<boolean>
```

- `redis.del(key)` → `1` or `0`.
- Returns `true` when one key was removed, `false` otherwise (miss or
  exception).
- The return value is almost always ignored — invalidation is
  best-effort.

---

## 5. `delByPattern(pattern)` — SCAN + UNLINK

```ts
async delByPattern(pattern: string): Promise<number>
```

The one method that needs to be pulled apart:

1. **Enumerate with cursor-based `SCAN`**, not `KEYS`:
   ```ts
   do {
     const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
     cursor = next;
     if (found.length) keys.push(...found);
   } while (cursor !== '0');
   ```
   `KEYS` is blocking and O(N); `SCAN` is non-blocking and safe to run
   against a live Redis instance.
2. **Delete in batches of 500 with `UNLINK`**, not `DEL`:
   ```ts
   for (let i = 0; i < keys.length; i += 500) {
     const batch = keys.slice(i, i + 500);
     await redis.unlink(...batch);
   }
   ```
   `UNLINK` is asynchronous non-blocking deletion on the Redis server
   side.

Total removed is tallied and returned. Failures are logged and the
returned count reflects only the batches that succeeded before the
error.

This is the only method in the cache layer that may run for a
non-trivial duration. In practice the patterns used
(`paths:list:*`, `courses:list:*`, `paths:detail:*`,
`courses:detail:*`) rarely exceed a few hundred keys. Keep the
pattern specific; never call this with `*` or a very broad prefix.

---

## 6. `invalidateOwner(type, id)`

```ts
async invalidateOwner(type: OwnerType, id: string): Promise<void>
```

Blunt-but-correct mass invalidation for a single path or course
owner. Used after any admin mutation on the owner or its marketing
children. Sequence:

1. `del('marketing:features:<type>:<id>')`
2. `del('marketing:faqs:<type>:<id>')`
3. `del('marketing:testimonials:<type>:<id>')`
4. If `type === 'path'`:
   - `delByPattern('paths:detail:*')`
   - `delByPattern('paths:list:*')`
5. Else (`type === 'course'`):
   - `delByPattern('courses:detail:*')`
   - `delByPattern('courses:list:*')`

The pattern deletes are intentionally broad: a change to any
path/course invalidates every cached detail view and every cached
paginated list. This is correct but coarse — a finer-grained
invalidation (only the slug that changed, only the query shapes that
include the changed row) would save cycles but is a significant
complexity jump. The spec deliberately chose the blunt path
(spec §4.4).

---

## 7. `slugFor(type, id)`

```ts
async slugFor(type: OwnerType, id: string): Promise<string | null>
```

Looks up `path.slug` or `course.slug` given an owner id. Returns
`null` on lookup failure (row missing, DB error).

Exists on `CacheService` for a counter-intuitive reason: the
marketing services (Features/Faqs/Testimonials) build ISR
revalidation URLs of the form `/paths/:slug` or `/courses/:slug`
from mutations. Placing the slug lookup on `CacheService` means each
marketing service gets DI on a single class (`CacheService`) and a
single method to call, preserving FR-019 ("marketing services get DI
+ marker replacement only, no new private methods").

Do not move this to `PathsService` / `CoursesService` without
coordinating the FR-019 rewrite.

---

## 8. `isHealthy()` — the one exception to never-throw

```ts
async isHealthy(): Promise<boolean>
```

- `redis.ping()` → `'PONG'` on success.
- Returns `true` iff `pong === 'PONG'`.
- Exception → log warning and return `false`.

This method is the only public way to tell whether the cache is up.
Consumed by the `GET /health` endpoint
([../health/get-health.md](../health/get-health.md)) to flip the
overall status from `ok` to `degraded` when Redis is unreachable.

It technically "never throws" either — but unlike the other methods,
its return value is not just a degraded default; it is the signal
the health endpoint reports to the client.

---

## 9. The never-throw contract

Every method except `isHealthy` follows the same pattern:

```ts
try {
  // redis operation
} catch (err) {
  this.logger.warn(`cache.<method>('${key}') failed: ${(err as Error).message}`);
  return <degraded default>;
}
```

The degraded default is always chosen so that the caller, oblivious
to the failure, still produces a correct response:

- `get` → `null` (cache miss) → caller reads DB.
- `set` → `void` → caller already has the value in hand.
- `del` → `false` → caller does not rely on the return.
- `delByPattern` → partial count → caller does not rely on the total.
- `invalidateOwner` → `void` → same.
- `slugFor` → `null` → caller skips the revalidation hop.

Never change one of these to throw. A throwing cache method means a
Redis outage causes 500s on requests that should have succeeded from
the DB.

---

## 10. Lifecycle — `onModuleDestroy`

`CacheModule` (`src/common/cache/cache.module.ts`) implements
`OnModuleDestroy` and calls `redisClient.quit()` on shutdown, so
graceful shutdowns flush pending commands. Test bootstraps rely on
this to avoid leaking connections across spec files.

---

## 11. Tests

| File | Covers |
|------|--------|
| `src/common/cache/cache.service.spec.ts` | get/set round-trip, never-throw behavior on every method (ioredis mock raises; method returns degraded default and logs), `delByPattern` SCAN + UNLINK sequencing, `invalidateOwner` blunt-sequence behavior for both `path` and `course`, `slugFor` returns null when the row is missing, `isHealthy` returns true on PONG and false on error. |

---

## 12. Files involved

| File | Role |
|------|------|
| `src/common/cache/cache.service.ts` | The class |
| `src/common/cache/cache-keys.ts` | `CacheKeys` + `CacheTTL` constants consumed by `invalidateOwner` and by every caller |
| `src/common/cache/redis.provider.ts` | `REDIS_CLIENT` provider |
| `src/common/cache/cache.module.ts` | `@Global()` module that wires the three providers |

---

## 13. Things NOT to change without coordination

- The never-throw contract on `get`, `set`, `del`, `delByPattern`,
  `invalidateOwner`, `slugFor`. Adding a `throw` is a multi-module
  break.
- The `SCAN + UNLINK` pattern in `delByPattern`. Do not "simplify" to
  `KEYS + DEL`.
- The batch size of 500 in `delByPattern` without a load test.
- The blunt mass-invalidation logic in `invalidateOwner`. Narrowing
  it requires coordinated refactors in the discovery services.
- The location of `slugFor` on `CacheService`. See §7.
