# Phase 1 — Data Model

KAN-74 introduces **no database entities**. `git diff prisma/` must be empty (FR-034, ticket §14.9). This document describes the in-memory cache model: key registry, TTL matrix, service shapes, and lifecycle.

---

## 1. Cache Key Registry

Single source of truth: `src/common/cache/cache-keys.ts`.

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
    features: (ownerType: OwnerType, ownerId: string) =>
      `marketing:features:${ownerType}:${ownerId}`,
    faqs: (ownerType: OwnerType, ownerId: string) =>
      `marketing:faqs:${ownerType}:${ownerId}`,
    testimonials: (ownerType: OwnerType, ownerId: string) =>
      `marketing:testimonials:${ownerType}:${ownerId}`,
  },
} as const;

export type OwnerType = 'path' | 'course';
```

### Key grammar

```
key        = scope ":" subcategory (":" identifier)?
scope      = "tags" | "categories" | "paths" | "courses" | "marketing"
subcategory= "all" | "admin:all" | "list" | "detail" | "features" | "faqs" | "testimonials"
identifier = slug | uuid | queryHash | ownerType ":" uuid
slug       = [a-z0-9-]+
uuid       = [a-f0-9-]{36}
queryHash  = [a-f0-9]{16}    -- 16-char prefix of a SHA-256 digest of normalized query params
```

### Invariants (verified by `cache-keys.spec.ts`)

1. Every helper returns a lowercase string.
2. Every helper is deterministic — identical inputs produce identical output across invocations.
3. No helper uses characters outside `[a-z0-9:-]`.
4. `ownerType` is always lowercase literal `'path'` or `'course'` — never `'PATH'` / `'COURSE'`.
5. `CacheKeys` is `as const` — the entire object is deeply readonly at the type level.

---

## 2. TTL Matrix

```typescript
export const CacheTTL = {
  TAGS: null,         // no expiry; invalidated on mutation
  CATEGORIES: null,   // no expiry; invalidated on mutation
  LIST: 300,          // 5 minutes; list endpoints may be stale under normal load
  DETAIL: null,       // no expiry; invalidated precisely on mutation
  MARKETING: null,    // no expiry; invalidated on owner mutation
} as const;

export type CacheTTLValue = (typeof CacheTTL)[keyof typeof CacheTTL];
```

| Cache family | TTL constant | Seconds | Invalidation trigger |
|---|---|---|---|
| `tags:all`, `tags:admin:all` | `CacheTTL.TAGS` | `null` (no expiry) | Tag mutation, `ReplaceTagAssociationsHelper` |
| `categories:all` | `CacheTTL.CATEGORIES` | `null` | Category mutation (future ticket, pattern documented) |
| `paths:list:{hash}` | `CacheTTL.LIST` | 300 | Tag mutation (pattern delete), path mutation (future), marketing mutation (via `invalidateOwner`) |
| `courses:list:{hash}` | `CacheTTL.LIST` | 300 | Same as paths:list |
| `paths:detail:{slug}` | `CacheTTL.DETAIL` | `null` | Marketing mutation on the owning path, path mutation (future) |
| `courses:detail:{slug}` | `CacheTTL.DETAIL` | `null` | Marketing mutation on the owning course, course mutation (future) |
| `marketing:features\|faqs\|testimonials:{type}:{id}` | `CacheTTL.MARKETING` | `null` | Corresponding marketing mutation via `invalidateOwner` |

### TTL usage rule (FR-014)

`ioredis.set(key, value, 'EX', ttl)` is called only when `CacheTTL.*` is a number; when `null`, the plain `set(key, value)` form is used (no expiry). Raw numeric literals at call sites are forbidden.

---

## 3. Invalidation Matrix

| Mutation | Triggers | Keys invalidated |
|---|---|---|
| `TagsService.create / update / remove` | FR-017 | `tags:all`, `tags:admin:all`, `paths:list:*`, `courses:list:*` |
| `ReplaceTagAssociationsHelper.replace` | FR-017a (un-marked, per Q2) | `paths:list:*`, `courses:list:*` |
| `FeaturesService.create / update / remove / reorder` | FR-018 | `invalidateOwner(ownerType, ownerId)` + `revalidatePath(/{ownerType}s/{slug})` |
| `FaqsService.create / update / remove / reorder` | FR-018 | Same as Features |
| `TestimonialsService.create / update / remove / reorder / updateStatus` | FR-018 | Same as Features |

### `invalidateOwner(type, id)` expansion

```
invalidateOwner('path', pathId) =
  del(marketing:features:path:{pathId})
  del(marketing:faqs:path:{pathId})
  del(marketing:testimonials:path:{pathId})
  delByPattern(paths:detail:*)     // blunt, per §4.3 tradeoff
  delByPattern(paths:list:*)

invalidateOwner('course', courseId) =
  del(marketing:features:course:{courseId})
  del(marketing:faqs:course:{courseId})
  del(marketing:testimonials:course:{courseId})
  delByPattern(courses:detail:*)
  delByPattern(courses:list:*)
```

---

## 4. Non-DB Entities (service shapes)

### 4.1 `CacheService` (injectable, global)

| Method | Input | Output | Never throws? | Notes |
|---|---|---|---|---|
| `get<T>(key)` | `string` | `Promise<T \| null>` | yes | Returns `null` on miss, error, or corrupt JSON |
| `set<T>(key, value, ttl)` | `string, T, number \| null` | `Promise<void>` | yes | `null` TTL = no expiry |
| `del(key)` | `string` | `Promise<boolean>` | yes | `true` if key existed |
| `delByPattern(pattern)` | `string` (glob) | `Promise<number>` | yes | Returns count deleted; uses SCAN + UNLINK batching |
| `invalidateOwner(type, id)` | `'path' \| 'course', string` | `Promise<void>` | yes | Composite of `del` + `delByPattern` per §3 |
| `isHealthy()` | — | `Promise<boolean>` | **no** (may return `false` on error, but is the only method that surfaces connection state) | Used by `/health` |

### 4.2 `CacheKeys` (constant registry)

Pure functions, no state, no dependencies, no lifecycle. Imported directly wherever keys are needed.

### 4.3 `CacheTTL` (constant registry)

Same shape as `CacheKeys` — `as const` readonly object.

### 4.4 `RevalidationHelper` (injectable)

| Method | Input | Output | Never throws? | Notes |
|---|---|---|---|---|
| `revalidatePath(path)` | `string` | `Promise<void>` | yes | Dormant if `FRONTEND_REVALIDATE_SECRET` unset; POSTs `{ secret, path }` to `${FRONTEND_URL}/api/revalidate` otherwise |

### 4.5 `CacheModule` (global NestJS module)

- Declares `@Global()`.
- Provides `REDIS_CLIENT` (factory), `CacheService`, `RevalidationHelper`.
- Exports `CacheService`, `RevalidationHelper`, `REDIS_CLIENT`.
- Implements `onModuleDestroy` to call `redis.quit()` cleanly.

### 4.6 Lifecycle

```
Application boot
  → ConfigModule validates REDIS_URL via Joi
  → CacheModule factory constructs ioredis client with TLS-from-scheme logic
  → CacheService, RevalidationHelper, and throttler storage all receive the same REDIS_CLIENT
  → AppModule registers CacheModule (once, globally)

Request lifecycle
  → Controllers/services inject CacheService via @Global scope
  → Cache operations never throw; cache is advisory

Shutdown
  → NestJS fires onModuleDestroy on CacheModule
  → redis.quit() drains pending commands and closes the connection
```

---

## 5. Not modeled

- **User-specific caches** — out of scope (ticket §3). No per-user cache keys defined.
- **Refresh tokens in Redis** — out of scope. No keys reserved for auth.
- **Session storage** — out of scope.
- **Quiz attempts / certificates / progress** — user-specific, never cached globally.

Any future ticket that introduces one of these MUST extend `CacheKeys` and `CacheTTL` in the same file — no key construction via string concatenation anywhere else in the codebase (FR-010).
