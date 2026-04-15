# Cache Keys and TTLs — Backend Reference (awamer-api)

> **Source:** `src/common/cache/cache-keys.ts`
> **Consumers:** every content-domain service, `CacheService.invalidateOwner`

This document is the full reference for every cache key in the
project — its format, its TTL policy, and what invalidates it. If a
key exists in code but not in this table, update the table first and
the code second.

---

## 1. `CacheKeys` — the namespace tree

```ts
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
    listPattern: () => 'paths:list:*',
    detailPattern: () => 'paths:detail:*',
  },
  courses: {
    list: (queryHash: string) => `courses:list:${queryHash}`,
    detail: (slug: string) => `courses:detail:${slug}`,
    listPattern: () => 'courses:list:*',
    detailPattern: () => 'courses:detail:*',
  },
  marketing: {
    features: (ownerType, ownerId) => `marketing:features:${ownerType}:${ownerId}`,
    faqs: (ownerType, ownerId) => `marketing:faqs:${ownerType}:${ownerId}`,
    testimonials: (ownerType, ownerId) => `marketing:testimonials:${ownerType}:${ownerId}`,
  },
} as const;
```

**No module should build a cache key via string concatenation.**
Always call a function on `CacheKeys`. This is the invariant that
lets `invalidateOwner` and `delByPattern` be trusted.

---

## 2. `CacheTTL` — TTL policy

```ts
export const CacheTTL = {
  TAGS: null,
  CATEGORIES: null,
  LIST: 300,          // seconds
  DETAIL: null,
  MARKETING: null,
} as const;
```

`null` means **no expiry** — the key persists until explicitly
invalidated. Only paginated list queries get a bounded TTL (5
minutes), because the full key space of `queryHash` variants cannot
be tracked precisely and a safety-net expiry limits the damage of a
missed invalidation.

---

## 3. Key reference table

| Key | Format | TTL | Written by | Invalidated by |
|-----|--------|-----|------------|----------------|
| `tags:all` | literal | `null` | `TagsService.listPublic` cache-aside | `TagsService.create` / `update` / `remove`; `CategoriesService` (no — only tag mutations invalidate tags) |
| `tags:admin:all` | literal | `null` | (reserved — declared in `CacheKeys` but the admin list endpoint does not currently cache) | `TagsService.create` / `update` / `remove` (preemptive del) |
| `categories:all` | literal | `null` | `CategoriesService.listAllPublic` cache-aside | (no admin Categories CRUD yet — see the TODO at the top of `categories.service.ts`; manual flush required) |
| `paths:list:<queryHash>` | 16-hex suffix | **300s** | `PathsService.list` cache-aside | `TagsService.{create,update,remove}`; `ReplaceTagAssociationsHelper.{replaceForPath,replaceForCourse}`; `CacheService.invalidateOwner('path',...)` via marketing mutations |
| `paths:detail:<slug>` | slug suffix | `null` | `PathsService.getBySlug` cache-aside | `CacheService.invalidateOwner('path',...)` (blunt pattern delete of `paths:detail:*`) |
| `courses:list:<queryHash>` | 16-hex suffix | **300s** | `CoursesService.list` cache-aside | `TagsService.{create,update,remove}`; `ReplaceTagAssociationsHelper.{replaceForPath,replaceForCourse}`; `CacheService.invalidateOwner('course',...)` |
| `courses:detail:<slug>` | slug suffix | `null` | `CoursesService.getBySlug` cache-aside | `CacheService.invalidateOwner('course',...)` (blunt pattern delete of `courses:detail:*`) |
| `marketing:features:<type>:<id>` | `<path\|course>:<uuid>` | `null` | `FeaturesService.list` cache-aside | `FeaturesService.{create,update,reorder,remove}`; `CacheService.invalidateOwner(type, id)` |
| `marketing:faqs:<type>:<id>` | `<path\|course>:<uuid>` | `null` | `FaqsService.list` cache-aside | `FaqsService.{create,update,reorder,remove}`; `CacheService.invalidateOwner(type, id)` |
| `marketing:testimonials:<type>:<id>` | `<path\|course>:<uuid>` | `null` | `TestimonialsService.list` cache-aside | `TestimonialsService.{create,update,updateStatus,reorder,remove}`; `CacheService.invalidateOwner(type, id)` |

For the exhaustive list of invalidation call sites (who calls what
where, and in what order relative to the DB write) see
[invalidation-flow.md](./invalidation-flow.md).

---

## 4. `buildQueryHash(params)`

```ts
export function buildQueryHash(params: Record<string, unknown>): string {
  const sortedKeys = Object.keys(params).sort();
  const normalized = sortedKeys.reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = params[k];
    return acc;
  }, {});
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16);
}
```

Used by `PathsService.list` and `CoursesService.list` to turn a query
DTO into a cache key. Two facts to remember:

- **Order-independent.** Keys are sorted alphabetically before
  serialization, so `?page=1&limit=20` and `?limit=20&page=1` hash to
  the same value.
- **16 hex chars** (8 bytes). Collisions are astronomically
  unlikely for the query-param space we use. If that ever stops
  being true, widen the slice — **do not** hash a different
  serialization scheme, because you would invalidate every cached
  key on deploy.

Corner cases the helper does **not** normalize:

- It does not coerce types. A query param that arrives as a string
  `'1'` hashes differently from a number `1`. Callers should pass
  the same shape the service uses internally (typically already
  coerced by `class-transformer` via `@Type(() => Number)`).
- It does not drop `undefined` values. If a DTO field is absent,
  pass the literal `undefined` consistently or omit the key entirely.

See `src/content/paths/query-hash.helper.ts` for the path-specific
wrapper that normalizes the list query DTO before calling
`buildQueryHash`.

---

## 5. Why no-expiry is the default

Four of five TTL classes are `null`. The reasoning:

1. **Invalidation on mutation is already strict.** Every admin
   mutation in tags, marketing, paths, and courses already calls
   the right `del` / `invalidateOwner`. A safety-net TTL would just
   hide bugs in that invalidation logic.
2. **The working set is small.** Tags, categories, and marketing
   keys are bounded by the number of admin-managed rows. There is
   no "infinite growth" risk.
3. **Detail and marketing views are the hottest endpoints.** A
   TTL-bounded detail view would churn cache every N minutes for no
   user-visible benefit.

Paginated list keys (`paths:list:*`, `courses:list:*`) are the
exception. The cache key space is unbounded (every distinct query
hash is a new key), so a 5-minute TTL acts as a garbage collector
and a safety net against a missed pattern delete.

---

## 6. Things NOT to change without coordination

- The key format strings. Changing `paths:list:<hash>` to
  `paths:list:v2:<hash>` orphans every existing key until you do a
  manual FLUSHDB.
- The `CacheTTL.LIST = 300` value. 300 seconds is chosen to pair
  with the frontend ISR cadence.
- The decision to hash sorted keys in `buildQueryHash`. Anything
  else is a cache-wide invalidation event on deploy.
- The `null`-TTL default for detail, marketing, tags, and
  categories. If you add a TTL, also add a telemetry signal so the
  frontend team can track invalidation vs. TTL churn.
