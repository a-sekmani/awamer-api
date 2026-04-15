# Contract — `CacheKeys` and `CacheTTL`

**File**: `src/common/cache/cache-keys.ts`

Single source of truth for cache-key construction and TTL policy. No other file in the codebase may build cache keys via string concatenation (FR-010, DoD §14.16).

## Exports

```typescript
export type OwnerType = 'path' | 'course';

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

export const CacheTTL = {
  TAGS: null,
  CATEGORIES: null,
  LIST: 300,
  DETAIL: null,
  MARKETING: null,
} as const;

/**
 * Deterministic 16-char prefix of a SHA-256 digest of the normalized query params.
 * Sort keys alphabetically, JSON.stringify, then hash. Order-independent.
 */
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

## Key format grammar

```
key        = scope ":" subcategory (":" identifier)?
scope      = "tags" | "categories" | "paths" | "courses" | "marketing"
subcategory= "all" | "admin:all" | "list" | "detail" | "features" | "faqs" | "testimonials"
identifier = slug | uuid | queryHash | (ownerType ":" uuid)
ownerType  = "path" | "course"
```

**Charset**: `[a-z0-9:-]` exclusively.
**Case**: lowercase.

## Lint guardrail (FR-010)

Post-implementation verification, to be added to the PR checklist:

```bash
# Every one of these must return zero matches outside src/common/cache/cache-keys.ts
grep -rn "\`tags:" src/ | grep -v src/common/cache/
grep -rn "\`paths:" src/ | grep -v src/common/cache/
grep -rn "\`courses:" src/ | grep -v src/common/cache/
grep -rn "\`marketing:" src/ | grep -v src/common/cache/
grep -rn "\`categories:" src/ | grep -v src/common/cache/
```

(Matches inside test spec files are acceptable only when they reference return values of `CacheKeys.*` helpers, not string literals.)

## Test assertions (FR-031)

- Each helper returns a string matching the grammar above.
- Each helper is deterministic — same input, same output, cross-invocation.
- `buildQueryHash({a:1, b:2}) === buildQueryHash({b:2, a:1})` (order-independent).
- `buildQueryHash` output length is exactly 16 and matches `/^[a-f0-9]{16}$/`.
- `CacheTTL` values match the ticket §4.2 policy literally.
- `CacheKeys` is deeply readonly at the type level (enforced via `as const` + compile-time check).
