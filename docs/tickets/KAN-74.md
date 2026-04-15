# KAN-74 — Redis + CacheModule + cache invalidation sweep

> **Jira:** [KAN-74](https://awamer.atlassian.net/browse/KAN-74)
> **Parent epic:** KAN-4 (E3: Public Discovery — infrastructure)
> **Depends on:** KAN-71 (Tags), KAN-72 (Marketing) — because this ticket replaces their cache markers
> **Blocks:** KAN-26 (Public discovery endpoints)
>
> **References:**
> - [Tech Stack v4 §4, §6.6, §7.3 Caching Strategy](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/29458433/Tech+Stack)
> - [API Design v2 §33 Caching Strategy](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/27754532/API+Design)

---

## 1. Goal

Introduce Redis as a first-class infrastructure dependency and deliver a production-ready `CacheModule` with a consistent `CacheService` API that all other modules can consume. Then, sweep through `src/content/tags/` and `src/content/marketing/` to replace every `TODO(KAN-74)` marker with real cache invalidation calls.

The ticket also delivers two cross-cutting integrations that depend on Redis:

- **`@nestjs/throttler` switched from in-memory to Redis store** — so rate limits work correctly across multiple App Runner instances
- **Health check extension** — `/api/v1/health` reports Redis connectivity alongside Postgres

The on-demand ISR revalidation webhook to Next.js is scoped in as a helper but left in a dormant state (not called anywhere yet) because the Next.js frontend does not yet have a `/api/revalidate` endpoint. When the frontend ticket lands, flipping the helper from dormant to active is a one-line change.

This ticket explicitly does **not** include AWS ElastiCache provisioning — that is a manual DevOps task on AWS Console or Terraform, out of scope for Claude Code. Local development uses Docker Compose Redis, and production will reference `REDIS_URL` env variable pointing to the eventually-provisioned ElastiCache endpoint.

---

## 2. Audit requirement (MANDATORY first step)

Before writing any code, Claude Code MUST perform an audit of the existing state and report findings. The following areas may or may not exist in the current repository — this spec makes no assumption about their current state:

1. **`docker-compose.yml`** — Does it exist? If yes, what services are defined? (Expected: `postgres` service at minimum.) Is there already a `redis` service? If yes, report its configuration.

2. **`.env.example`** — Does it exist? If yes, does it already have a `REDIS_URL` entry? What is the existing format for database connection strings?

3. **`ioredis` / `cache-manager` / `@nestjs/cache-manager` / `cache-manager-redis-store`** — Check `package.json` dependencies and devDependencies. Report which of these are installed and their versions.

4. **`@nestjs/throttler`** — Is it installed? Is it configured in `AppModule`? If yes, with what configuration (in-memory vs Redis, default limit, default TTL)? Report the current setup verbatim.

5. **`src/common/cache/`** — Does a CacheModule already exist (even as a stub)? If yes, report its exports and current implementation.

6. **`src/health/` or `src/common/health/`** — Is there a health check controller? What does `GET /api/v1/health` currently return? Report the current response shape.

7. **`TODO(KAN-74)` grep sweep** — Run `grep -rn "TODO(KAN-74)" src/content/` and report **every single match** with file path, line number, and the surrounding 2 lines of context. This is the authoritative list of cache invalidation sites this ticket must address. The expected count is approximately 17 markers (4 in tags + 4 in features + 4 in faqs + 5 in testimonials), but the audit must produce the actual number, not the expected one.

8. **`AnalyticsService` pattern** — Briefly confirm that `src/analytics/analytics.module.ts` is still structured the way KAN-73 observed it (injectable service, global module, `capture(userId, event, properties?)` signature). This ticket adds a similar global module, so the pattern should be replicated.

9. **Next.js frontend revalidation endpoint** — Check if the frontend repo (not this repo) has been updated with an `/api/revalidate` endpoint. This cannot be verified from inside `awamer-api`, so the audit should simply report "unknown — assume dormant" unless there is evidence in shared documentation or environment variables.

**After completing the audit, stop and report the findings. Do not start implementation until the human operator has reviewed the audit and confirmed.** Based on the findings, the operator may adjust scope — for example, if `ioredis` is already installed, the dependency installation step is skipped.

---

## 3. Scope

### In scope

- **Local Redis service** in `docker-compose.yml` (port 6379, no password, persistent volume)
- **`REDIS_URL` environment variable** with local default in `.env.example`
- **`ioredis` or `cache-manager` with Redis store** — choice made during plan phase based on audit findings (see §13.1)
- **`CacheModule`** as a global NestJS module under `src/common/cache/` exposing `CacheService`
- **`CacheService`** with methods: `get<T>`, `set`, `del`, `delByPattern`, `invalidateOwner`
- **Cache key constants file** at `src/common/cache/cache-keys.ts` documenting all key patterns
- **TTL policy** encoded as exported constants
- **`@nestjs/throttler` switched to Redis store** — reuses the same Redis connection
- **Health check extension** — `GET /api/v1/health` adds a `cache` field
- **ISR revalidation helper** (`src/common/cache/revalidation.helper.ts`) — dormant state, ready to activate
- **Replace every `TODO(KAN-74)` marker** in `src/content/tags/` and `src/content/marketing/` with real cache invalidation calls
- **Unit tests** for `CacheService` (using `ioredis-mock` or equivalent in-memory fake)
- **Integration (e2e) tests** for cache hit / miss / invalidation against a real Redis (from Docker Compose)
- **README update** documenting the cache key conventions, TTL policy, and invalidation rules

### Out of scope

- **AWS ElastiCache provisioning** — manual DevOps task, tracked separately in the Jira ticket's infrastructure checklist. This file produces the code that will consume ElastiCache, not the infrastructure itself.
- **Actual `/api/revalidate` endpoint on the Next.js frontend** — belongs to a frontend ticket. This file delivers a helper that will call it when it exists.
- **Refresh token storage in Redis** — mentioned in the Jira ticket's "Redis will also serve" section but is a separate concern that belongs to an auth-refactor ticket. This ticket delivers the cache infrastructure but does not touch `refresh_tokens`.
- **Session-related helpers** — same reasoning as refresh tokens.
- **Caching of KAN-73 endpoints** (enrollment, certificates, progress, learning) — KAN-73 did not add `TODO(KAN-74)` markers because those endpoints are user-specific and should not be cached by a global Redis cache without per-user key scoping. Adding per-user caching is a future optimization, not this ticket.
- **Any modification to** `prisma/schema.prisma`, `prisma/migrations/`, `src/auth`, `src/users`, `src/onboarding`, or any KAN-73 module (`src/enrollment`, `src/progress`, `src/certificates`, `src/learning`).
- **Any modification to `src/content/tags/` or `src/content/marketing/` BEYOND replacing the `TODO(KAN-74)` markers** — no logic changes, no refactoring, no renaming. Mechanical sweep only.
- **New npm dependencies beyond Redis client and its Jest mock** — justify any additional dep in the PR.

---

## 4. Domain rules

### 4.1 Cache key naming conventions

All cache keys follow this format:

```
{scope}:{subcategory}:{identifier-or-hash}
```

Examples:
- `tags:all` — list of all published tags (public)
- `tags:admin:all` — list of all tags including drafts (admin)
- `paths:list:{queryHash}` — paginated public path list keyed by query hash
- `paths:detail:{slug}` — full public path detail by slug
- `courses:list:{queryHash}` — paginated public course list
- `courses:detail:{slug}` — full public course detail by slug
- `categories:all` — list of all categories
- `marketing:features:{ownerType}:{ownerId}` — features for a specific owner
- `marketing:faqs:{ownerType}:{ownerId}` — faqs for a specific owner
- `marketing:testimonials:{ownerType}:{ownerId}` — approved testimonials for a specific owner (public shape only)

**Rules:**

- **Always lowercase**, colon-separated
- **No spaces, no special characters** except `:` and `-` (for UUIDs and slugs)
- **`{queryHash}`** is a SHA-256 hash of the normalized query parameters, truncated to 16 hex chars — this is stable regardless of query param order
- **`{ownerType}`** is lowercase: `path` or `course` (not `PATH` / `COURSE` — keep keys clean)
- **`{ownerId}`** is the UUID as-is
- **`{slug}`** is the slug as stored in the database
- **The constants file at `src/common/cache/cache-keys.ts`** is the ONLY place where key formats are defined — no module should construct cache keys with string concatenation. Every key is built via a helper function:

```typescript
export const CacheKeys = {
  tags: {
    all: () => 'tags:all',
    adminAll: () => 'tags:admin:all',
  },
  categories: {
    all: () => 'categories:all',
  },
  paths: {
    list: (queryHash: string) => `paths:list:${queryHash}`,
    detail: (slug: string) => `paths:detail:${slug}`,
  },
  courses: {
    list: (queryHash: string) => `courses:list:${queryHash}`,
    detail: (slug: string) => `courses:detail:${slug}`,
  },
  marketing: {
    features: (ownerType: 'path' | 'course', ownerId: string) =>
      `marketing:features:${ownerType}:${ownerId}`,
    faqs: (ownerType: 'path' | 'course', ownerId: string) =>
      `marketing:faqs:${ownerType}:${ownerId}`,
    testimonials: (ownerType: 'path' | 'course', ownerId: string) =>
      `marketing:testimonials:${ownerType}:${ownerId}`,
  },
} as const;
```

This shape ensures every call site uses exactly the same key format, and a typo is a TypeScript error.

### 4.2 TTL policy

TTLs are declared as exported constants in `cache-keys.ts` next to the key helpers:

```typescript
export const CacheTTL = {
  // Categories and tags change rarely; no automatic expiry — invalidated only on mutation
  TAGS: null,
  CATEGORIES: null,
  // List endpoints may be stale for up to 5 minutes under normal load
  LIST: 300, // 5 minutes in seconds
  // Detail endpoints are invalidated precisely on mutation, so no TTL
  DETAIL: null,
  // Marketing content is invalidated on mutation of features/faqs/testimonials for the owner
  MARKETING: null,
} as const;
```

**Rules:**

- `null` TTL means "no expiry, live forever until explicit invalidation"
- Positive numbers are seconds
- Every cache `set()` call MUST pass a TTL from this constants object — never a raw number inline
- The only exception is ad-hoc debugging or internal helpers, which must document the deviation inline

### 4.3 Cache invalidation rules

When a mutation happens, the cache for the affected entity and its related public views MUST be invalidated. The rules are:

**Tags mutations** (`TagsService.create`, `update`, `delete`, `replaceTagAssociationsHelper`):
- Invalidate `tags:all` and `tags:admin:all`
- Also invalidate `paths:list:*` and `courses:list:*` (because tag changes affect public list filtering) via `delByPattern`

**Categories mutations** (future ticket, not this one, but the pattern is documented):
- Invalidate `categories:all`
- Also invalidate `paths:list:*` and `courses:list:*`

**Feature/FAQ/Testimonial mutations** (in `src/content/marketing/*`):
- Invalidate the specific owner's marketing key: `marketing:features:{ownerType}:{ownerId}` (or `faqs` / `testimonials`)
- Invalidate the detail cache for that owner: `paths:detail:{slug}` OR `courses:detail:{slug}` — this requires looking up the slug from the owner ID
- **Optimization:** instead of looking up the slug on every mutation, use `delByPattern('paths:detail:*')` or `delByPattern('courses:detail:*')` as a bluntly-effective fallback. The tradeoff is slightly more cache churn, but it eliminates a database round-trip on every mutation. This is the preferred approach for this ticket.

**Path/Course mutations** (future tickets, not this one, but documented for consistency):
- Invalidate `paths:detail:{slug}` (or `courses:detail:{slug}`)
- Invalidate `paths:list:*` (or `courses:list:*`) via `delByPattern`

### 4.4 `invalidateOwner` convenience helper

`CacheService.invalidateOwner(type: 'path' | 'course', id: string)` is a high-level helper that performs all the invalidations related to a specific path or course in one call:

```typescript
async invalidateOwner(type: 'path' | 'course', id: string): Promise<void> {
  // Delete marketing caches for this owner
  await this.del(CacheKeys.marketing.features(type, id));
  await this.del(CacheKeys.marketing.faqs(type, id));
  await this.del(CacheKeys.marketing.testimonials(type, id));
  // Delete all detail caches for this scope (blunt but correct)
  await this.delByPattern(`${type}s:detail:*`);
  // Delete all list caches for this scope
  await this.delByPattern(`${type}s:list:*`);
}
```

This is the method that marketing mutations will call (instead of constructing keys manually). It is ALSO the method that future Path/Course delete endpoints will call.

---

## 5. `CacheService` API

Located at `src/common/cache/cache.service.ts`.

```typescript
@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Retrieves a value from the cache. Returns null if the key does not exist
   * or if deserialization fails. Never throws — a cache miss is a normal path.
   */
  async get<T>(key: string): Promise<T | null>;

  /**
   * Stores a value in the cache with an optional TTL in seconds.
   * If ttlSeconds is null, the key lives forever until explicit invalidation.
   * Never throws on Redis connection errors — logs the error and silently
   * proceeds, because caching failures must never break the main flow.
   */
  async set<T>(key: string, value: T, ttlSeconds: number | null): Promise<void>;

  /**
   * Deletes a single key. Returns true if the key existed, false otherwise.
   * Never throws on Redis errors.
   */
  async del(key: string): Promise<boolean>;

  /**
   * Deletes all keys matching a glob pattern (e.g. 'paths:detail:*').
   * Uses SCAN + DEL in batches to avoid blocking Redis on large key sets.
   * Never throws on Redis errors.
   */
  async delByPattern(pattern: string): Promise<number>;

  /**
   * Invalidates all cache entries related to a specific path or course.
   * See §4.4 for the exact scope.
   */
  async invalidateOwner(type: 'path' | 'course', id: string): Promise<void>;

  /**
   * Health check helper. Returns true if Redis is reachable, false otherwise.
   * Used by the /health endpoint.
   */
  async isHealthy(): Promise<boolean>;
}
```

### 5.1 Serialization

- Values are JSON-encoded on `set` and JSON-decoded on `get`
- `undefined` is stored as the string `"null"` (JSON convention) and returned as `null` on read
- `Date` objects are stored as ISO strings; callers are responsible for reviving them if needed
- Binary data is NOT supported by this service — keep it to plain JSON-serializable objects

### 5.2 Error handling

**Critical rule:** `CacheService` is a NON-CRITICAL dependency. Redis connection errors, serialization errors, or any other cache-layer failure MUST NEVER cause the calling service to throw. The pattern is:

```typescript
async get<T>(key: string): Promise<T | null> {
  try {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    this.logger.warn(`Cache get failed for key '${key}': ${error.message}`);
    return null; // degrade gracefully — treat as cache miss
  }
}
```

Same pattern for `set`, `del`, `delByPattern`. The ONLY method that surfaces Redis errors is `isHealthy()` — the health check needs to know.

**This is a core architectural decision, not optional.** If Redis is down, the application continues to function (slower, hitting the database on every request). It MUST NOT return 500 errors just because the cache is unavailable.

### 5.3 Connection lifecycle

- Redis client is created in `CacheModule` via a factory provider
- Token: `REDIS_CLIENT` exported from `src/common/cache/redis.provider.ts`
- Configured from `REDIS_URL` environment variable
- TLS is enabled when `REDIS_URL` starts with `rediss://` (double-s), disabled for `redis://`
- Reconnection strategy: ioredis default (exponential backoff)
- On `OnModuleDestroy`, the client calls `redis.quit()` to close cleanly

---

## 6. `CacheModule`

Located at `src/common/cache/cache.module.ts`.

```typescript
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        return new Redis(url, { /* options */ });
      },
      inject: [ConfigService],
    },
    CacheService,
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class CacheModule {
  async onModuleDestroy() {
    const client = this.moduleRef.get<Redis>(REDIS_CLIENT);
    await client?.quit();
  }
}
```

**Why `@Global()`:** CacheService is needed by many modules (content/tags, content/marketing, and every future feature module). Making it global means modules can inject it without importing CacheModule explicitly. This matches the pattern used by `PrismaModule` and `AnalyticsModule`.

**Registration:** Add `CacheModule` to `AppModule` imports once. Remove it from any individual feature module imports if it was previously listed (unlikely since this is the first time we introduce it).

---

## 7. Throttler integration

Currently, `@nestjs/throttler` (if installed — see audit §2) uses the default in-memory store. This works for a single-process dev environment but fails in production when App Runner scales to multiple instances — each instance has its own counter, so a user could hit the endpoint N times per instance.

This ticket switches the throttler storage to Redis:

```typescript
// In AppModule:
ThrottlerModule.forRootAsync({
  imports: [ConfigModule, CacheModule],
  inject: [REDIS_CLIENT],
  useFactory: (redis: Redis) => ({
    throttlers: [{ limit: 100, ttl: 60000 }],
    storage: new ThrottlerStorageRedisService(redis),
  }),
}),
```

**Package decision:** `nestjs-throttler-storage-redis` is the community package for this. If it is not already installed, add it. If the audit finds a different Redis-backed throttler package, use that instead.

**Test verification:** add an e2e test that hits a rate-limited endpoint (KAN-73's `/certificates/verify/:code` with `@Throttle(30/60)` is a perfect target) from two separate test clients in rapid succession. Under the new Redis store, hitting 30 requests across both clients should still trigger 429 on the 31st request regardless of which client sends it. Under the old in-memory store, this test would fail (each client would have its own counter).

This test is the proof that the Redis integration works.

---

## 8. Health check extension

Located at `src/health/health.controller.ts` (or wherever the audit finds it).

Current shape (expected, verify in audit):
```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 12345
}
```

New shape after this ticket:
```json
{
  "status": "ok",
  "database": "connected",
  "cache": "connected",
  "uptime": 12345
}
```

**Logic:**
- `cache` field comes from `CacheService.isHealthy()`
- `"connected"` if `isHealthy()` returns true
- `"disconnected"` otherwise
- The overall `status` field remains `"ok"` even if cache is disconnected — cache is non-critical, the application is still functional without it
- If database is disconnected, overall `status` becomes `"degraded"` or `"error"` (depending on existing behavior — preserve whatever is there)

---

## 9. ISR revalidation helper

Located at `src/common/cache/revalidation.helper.ts`.

**Purpose:** After invalidating a Redis cache entry, the Next.js frontend's ISR (Incremental Static Regeneration) cache also needs to be invalidated so the public page re-renders with fresh data on the next request.

**Current status:** The Next.js `/api/revalidate` endpoint does not exist yet (see audit §9). This helper is delivered in a **dormant state** — the code is written, but the call site is gated by an environment variable check:

```typescript
@Injectable()
export class RevalidationHelper {
  async revalidatePath(path: string): Promise<void> {
    const secret = this.config.get<string>('FRONTEND_REVALIDATE_SECRET');
    const frontendUrl = this.config.get<string>('FRONTEND_URL');

    // Dormant until frontend ships the endpoint
    if (!secret || !frontendUrl) {
      this.logger.debug(`Revalidation skipped (not configured): ${path}`);
      return;
    }

    try {
      await fetch(`${frontendUrl}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, path }),
      });
    } catch (error) {
      this.logger.warn(`Revalidation failed for ${path}: ${error.message}`);
      // Best-effort: failure does not break the mutation
    }
  }
}
```

**Environment variables added to `.env.example`:**
```
# Next.js frontend revalidation (leave empty in dev)
FRONTEND_URL=
FRONTEND_REVALIDATE_SECRET=
```

**Call sites:** `RevalidationHelper.revalidatePath()` is called from the same places where `CacheService.invalidateOwner()` is called (tags mutations, marketing mutations). Since the helper is dormant by default, the calls are no-ops in the current state. When the frontend ships the endpoint, filling in `FRONTEND_URL` and `FRONTEND_REVALIDATE_SECRET` in the production environment activates the behavior with zero code changes.

**Paths to revalidate:**
- Tags mutation → `/paths` and `/courses` (list pages)
- Marketing mutation on a path → `/paths/{slug}`
- Marketing mutation on a course → `/courses/{slug}`

The slug lookup from `ownerId` happens inside the marketing service method. If the slug lookup fails (e.g., the path was just deleted), skip the revalidation call — it's best-effort.

---

## 10. Docker Compose and env updates

### 10.1 `docker-compose.yml`

Add a Redis service to the existing compose file. Expected final state for the redis service:

```yaml
services:
  # ... existing postgres service
  redis:
    image: redis:7-alpine
    container_name: awamer-redis
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  postgres_data: # existing
  redis_data: # new
```

Preserve all existing services and volumes. Only add the `redis` service and the `redis_data` volume entry.

### 10.2 `.env.example`

Add:
```
# Redis
REDIS_URL=redis://localhost:6379

# Next.js frontend revalidation (leave empty in dev)
FRONTEND_URL=
FRONTEND_REVALIDATE_SECRET=
```

Preserve all existing entries.

---

## 11. TODO(KAN-74) sweep

This is the most delicate part of the ticket because it touches files in `src/content/tags/` and `src/content/marketing/` that were frozen after KAN-71 and KAN-72 respectively.

**Allowed modifications:**
- Replace every `// TODO(KAN-74): ...` comment with a real `CacheService` call (and add the `CacheService` / `RevalidationHelper` injection to the service constructor)
- Add the relevant imports at the top of each service file

**Forbidden modifications in those files:**
- Any logic change
- Any refactoring
- Any renaming
- Any signature change to existing methods
- Any addition of new methods

**The sweep is mechanical.** The audit in §2 task 7 produces the authoritative list of sites. For each site, apply the appropriate invalidation based on the entity type:

| Marker location | Replacement |
|---|---|
| `TagsService.create` | `await this.cache.del(CacheKeys.tags.all());`<br>`await this.cache.del(CacheKeys.tags.adminAll());`<br>`await this.cache.delByPattern('paths:list:*');`<br>`await this.cache.delByPattern('courses:list:*');` |
| `TagsService.update` | Same as create |
| `TagsService.delete` | Same as create |
| `ReplaceTagAssociationsHelper` | `await this.cache.invalidateOwner('path', pathId);` when the scope is path-attached tags; same for course. The helper knows the scope from its parameters. |
| `FeaturesService.create/update/delete/reorder` | `await this.cache.invalidateOwner(ownerType, ownerId);`<br>`await this.revalidation.revalidatePath(\`/\${ownerType}s/\${slug}\`);` (slug lookup required — see §9) |
| `FaqsService.create/update/delete/reorder` | Same as Features |
| `TestimonialsService.create/update/delete/reorder/updateStatus` | Same as Features |

**Injection additions:**

Each affected service adds two new dependencies to its constructor:
```typescript
constructor(
  private readonly prisma: PrismaService,
  // ... existing deps
  private readonly cache: CacheService,        // NEW
  private readonly revalidation: RevalidationHelper, // NEW — only for marketing services, tags doesn't need frontend revalidation
) {}
```

`CacheService` is globally injectable (thanks to `@Global()` in CacheModule), so no import changes in `ContentModule` or `MarketingModule` are needed.

**Verification:** after the sweep, run `grep -rn "TODO(KAN-74)" src/` — it MUST return zero matches. This is part of the Definition of Done.

---

## 12. Tests

### 12.1 Unit tests — `cache.service.spec.ts`

Against `ioredis-mock` (or an equivalent in-memory Redis fake):

- `get` returns null on cache miss
- `get` returns the stored value on cache hit
- `get` returns null on deserialization error (corrupted data) without throwing
- `get` returns null on Redis connection error without throwing
- `set` with TTL expires the key after the TTL (verify via fast-forward of the mock clock)
- `set` without TTL (null) stores the key permanently
- `set` swallows Redis connection errors without throwing
- `del` removes a single key, returns true if existed
- `del` returns false if key did not exist
- `delByPattern` removes all matching keys using SCAN
- `delByPattern` returns the count of deleted keys
- `delByPattern` does not block Redis on large key sets (uses batching — verify via SCAN cursor mock)
- `invalidateOwner('path', id)` deletes marketing:features, marketing:faqs, marketing:testimonials for that owner, plus paths:detail:* and paths:list:*
- `invalidateOwner('course', id)` does the same for course
- `isHealthy` returns true when Redis responds to PING
- `isHealthy` returns false when Redis is unreachable

### 12.2 Unit tests — `cache-keys.spec.ts`

- Each key builder produces the expected string format
- Keys are lowercase
- Keys contain no spaces or special characters except `:` and `-`
- Identical inputs produce identical keys (deterministic)

### 12.3 Unit tests — `revalidation.helper.spec.ts`

- `revalidatePath` is a no-op when `FRONTEND_URL` is empty
- `revalidatePath` is a no-op when `FRONTEND_REVALIDATE_SECRET` is empty
- `revalidatePath` makes a POST to `${FRONTEND_URL}/api/revalidate` with the correct body when both env vars are set
- `revalidatePath` swallows fetch errors without throwing
- `revalidatePath` logs a warning on failure

### 12.4 Unit tests — updates to existing specs

- **`tags.service.spec.ts`** — add assertions that `cache.del` / `delByPattern` is called on every mutation (create, update, delete)
- **`features.service.spec.ts`, `faqs.service.spec.ts`, `testimonials.service.spec.ts`** — add assertions that `cache.invalidateOwner` and `revalidation.revalidatePath` are called on every mutation

These additions must NOT modify any existing assertions in those files. Only add new `it()` blocks for the new cache-related assertions.

### 12.5 Integration (e2e) tests

Against a real Redis from Docker Compose, reusing `test/content/test-app.ts` as the bootstrap.

#### `cache.service.e2e-spec.ts`

- Set a key, get it back — round trip works
- Set with TTL, wait for expiry, verify the key is gone
- Delete by pattern against many keys (seed 100 keys under a pattern, delete them all in one call, verify none remain)
- Set and get Arabic text — UTF-8 round-trips correctly
- `invalidateOwner` removes all related keys in a realistic scenario

#### `tags-cache-invalidation.e2e-spec.ts`

- Seed a tag, hit `GET /api/v1/admin/tags` — verify the response is cached
- Create a new tag via `POST /api/v1/admin/tags` — verify the list cache is invalidated
- Hit `GET` again — verify the new tag is in the response (cache miss, fresh DB query)
- Same for update and delete

#### `marketing-cache-invalidation.e2e-spec.ts`

- Seed a path with features, hit the (currently-nonexistent) public path endpoint — skip this scenario OR mock the cache `set` call in a test-only controller. Since KAN-26 hasn't shipped, there is no public endpoint that reads from the cache yet. Mark this test as pending with a `// TODO(KAN-26): enable once public endpoints exist` marker.
- Create a feature via `POST /api/v1/admin/paths/:id/features` — verify `cache.invalidateOwner('path', id)` was called (via spy)
- Same for FAQ and testimonial mutations

**Key decision:** marketing cache-invalidation e2e tests are primarily SPY-based because the cache consumers (KAN-26 public endpoints) don't exist yet. The tests verify that invalidation calls are MADE, not that they have an observable effect on a consumer. This is acceptable coverage for this ticket — the real end-to-end verification happens when KAN-26 ships.

#### `throttler-redis.e2e-spec.ts`

- Hit `/api/v1/certificates/verify/any-code` 30 times in rapid succession from one client → all return 404
- Hit it 30 more times from a second client (spawned as a separate supertest agent) → last 30 should start returning 429 at some point (because the Redis counter is shared)
- Wait for the window to reset, hit once → 404 again

#### `health.controller.e2e-spec.ts`

- `GET /api/v1/health` returns `{ status: 'ok', database: 'connected', cache: 'connected', ... }` when Redis is up
- With Redis stopped (simulated by pointing `CacheService` to a bad URL in test setup) — `cache` is `'disconnected'` but overall `status` remains `'ok'`

### 12.6 Test infrastructure

- **`ioredis-mock`** for unit tests (or whatever the audit finds available; `cache-manager`'s in-memory store is an alternative)
- **Real Redis from Docker Compose** for e2e tests — `awamer-redis` container must be running during `test:content:e2e` and any new test script
- **Truncation:** e2e tests call `redis.flushdb()` in `beforeEach` to isolate state between tests
- **Jest environment variable:** set `REDIS_URL=redis://localhost:6379` in the test setup before each e2e run

---

## 13. Known ambiguities and how to resolve them

### 13.1 `ioredis` vs `cache-manager` with Redis store

Two approaches exist:

**Approach A — Direct `ioredis`:** lightweight, gives direct access to all Redis commands, manual JSON serialization.

**Approach B — `@nestjs/cache-manager` with `cache-manager-redis-store`:** abstracted interface, supports multiple backends, auto-serialization.

**Decision rule:**
- If the audit finds `@nestjs/cache-manager` already installed → use Approach B
- If nothing is installed → use Approach A (ioredis) because it's simpler and we only have one backend (Redis). `nestjs-throttler-storage-redis` requires a raw `ioredis` client anyway, so ioredis is installed regardless.

Default assumption: **Approach A (direct ioredis).**

### 13.2 Throttler storage package name

The Redis store for `@nestjs/throttler` has gone through several community packages. Check in this order:
1. `@nest-lab/throttler-storage-redis` (newer, maintained)
2. `nestjs-throttler-storage-redis` (older, deprecated but still works)
3. Custom implementation inline if neither is installable

If the audit shows `@nestjs/throttler` is not installed at all, install it first (it is a legitimate dependency for this ticket even though it's an add — rate limiting is explicitly in scope per §1).

### 13.3 Marketing service slug lookup for revalidation

When a marketing mutation happens, the revalidation helper needs the path/course slug to build the URL. Two options:

**Option A — Lookup the slug inline** in the mutation method before calling `revalidatePath`. Adds one DB query per mutation.

**Option B — Build the URL from the owner type and ID** (e.g., `/paths/uuid`). The frontend resolves UUIDs to slugs on its side. Avoids the extra query but assumes the frontend supports UUID-based routing.

**Decision:** Option A. Cleaner contract, one extra DB query is acceptable on a mutation path, and we don't want to leak UUIDs into public URLs.

### 13.4 Mocking Redis in unit tests

`ioredis-mock` is the standard. If the audit shows it's not already installed as a devDependency, add it. This is the only test-only dependency this ticket adds. The justification is that without it, every CacheService unit test would need a real Redis, which is unacceptable for unit test hygiene.

### 13.5 If `HealthController` does not exist

If the audit shows there is no health endpoint at all:
- Create a minimal one at `src/health/health.controller.ts` + `src/health/health.module.ts`
- Response shape: `{ status, database, cache, uptime }`
- Database check: run `prisma.$queryRaw\`SELECT 1\`` and return `'connected'` / `'disconnected'`
- Register in `AppModule`

This is a small scope extension but necessary for the Definition of Done. Document it in the PR.

### 13.6 Any other ambiguity

If the file leaves something genuinely underspecified, prefer:
1. The pattern established by `AnalyticsModule` (global, injectable service, stub implementation)
2. The pattern established by `PrismaModule` (global, factory provider, connection lifecycle)
3. NestJS official documentation

If ambiguity remains after consulting those, STOP and ask the human operator. Do not guess.

---

## 14. Definition of Done

The ticket is not closed until all of the following are true:

1. `npm run build` succeeds with zero TypeScript errors
2. `npx prisma validate` still passes (schema unchanged)
3. `npm run test:schema` is still green (KAN-70 tests untouched)
4. `npm run test:content:e2e` is still green (KAN-71, KAN-72, KAN-73 e2e tests untouched in behavior)
5. `npm test` runs every test in the project — all green
6. **`grep -rn "TODO(KAN-74)" src/` returns ZERO matches** — the sweep is complete
7. All unit tests in §12.1 – §12.4 pass
8. All e2e tests in §12.5 pass
9. `git diff prisma/` is empty
10. `git diff src/auth src/users src/onboarding src/enrollment src/progress src/certificates src/learning src/common/guards` is empty — KAN-73 is not touched
11. `docker-compose up` starts both Postgres and Redis and the app connects to Redis successfully
12. `GET /api/v1/health` returns `cache: "connected"` in the default local setup
13. `@nestjs/throttler` uses Redis storage — verifiable by the two-client e2e test in §12.5 (`throttler-redis.e2e-spec.ts`)
14. `CacheModule` is registered in `AppModule`
15. `CacheModule` is `@Global()` so services can inject `CacheService` without importing the module
16. `cache-keys.ts` is the single source of truth for cache key formats — no module constructs keys via string concatenation (verifiable via grep for the pattern `\`tags:\`` or similar)
17. README has a short note added describing the cache layer, key conventions, and TTL policy
18. No new dependencies except: `ioredis`, `ioredis-mock` (dev), `@nest-lab/throttler-storage-redis` (or equivalent), `@nestjs/throttler` if not already installed
19. All new dependencies are justified in the PR description

---

## 15. Out of scope — not to be touched

- `prisma/schema.prisma` — frozen since KAN-70
- `prisma/migrations/`
- `src/auth`, `src/users`, `src/onboarding`
- `src/enrollment`, `src/progress`, `src/certificates`, `src/learning` — all frozen since KAN-73
- `src/common/guards/` — all guards from KAN-71 and KAN-73 stay untouched
- `src/common/filters/` — the HttpExceptionFilter from KAN-73 stays untouched
- `src/analytics/` — AnalyticsModule stays untouched
- The logic of `src/content/tags/` and `src/content/marketing/` — ONLY TODO markers are replaced, nothing else changes
- `prisma/seed.ts`
- CI/CD configuration files (except if the e2e tests need a Redis service in CI — if so, that's a minimal addition and must be explicitly justified)

---

## 16. Rules for resolving ambiguity

See §13 for specific ambiguities. The general rule:

1. If the spec addresses the question, follow the spec literally
2. If the spec is silent, prefer patterns already established in `src/common/*` (specifically `AnalyticsModule` as the global-service template and `PrismaModule` as the connection-lifecycle template)
3. For NestJS conventions not covered above, fall back to official NestJS docs
4. For Redis conventions, fall back to ioredis documentation
5. If ambiguity remains after all the above, STOP and ask — do not guess

The audit in §2 is the primary mechanism for surfacing ambiguity before any code is written. Use it.
