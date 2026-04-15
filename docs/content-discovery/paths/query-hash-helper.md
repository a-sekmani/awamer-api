# query-hash.helper.ts — Backend Reference (awamer-api)

> **Source:** `src/content/paths/query-hash.helper.ts`
> **Exports:** `computeQueryHash`
> **Consumers:** `PathsService.listPublic`, `CoursesService.listPublic`

Builds the canonical, default-omitting representation of a list
query and hashes it to a 16-character cache-key suffix. Shared
between paths and courses because both listing services use the
same normalization rules.

---

## 1. `computeQueryHash(query)`

```ts
export function computeQueryHash(
  query: ListPathsQueryDto | ListCoursesQueryDto,
): string
```

Builds an intermediate `Record<string, unknown>` and forwards
it to `buildQueryHash` from
[../../cache/cache-keys.md §4](../../cache/cache-keys.md), which
sorts the keys and takes the SHA-256 prefix.

---

## 2. The default-omitting rule

Fields are added to the intermediate object **only when they
deviate from the service-layer default**. The point is to make
`?page=1` and `?` hash to the same value — otherwise every
frontend request with explicit defaults would populate a separate
cache key.

Current omissions:

| Field | Omitted when | Reason |
|-------|--------------|--------|
| `sort` | value is `'order'` | `order` is the default primary sort. |
| `order` | value is `'asc'` | `asc` is the default direction. |
| `page` | value is `1` | page 1 is the default. |
| `limit` | value is `20` | 20 is the default page size. |

Fields are added when present:

| Field | Notes |
|-------|-------|
| `categoryId` | verbatim |
| `tagId` | verbatim |
| `level` | verbatim (lowercase enum string) |
| `search` | `search.toLowerCase().trim()` — normalized so `"Python"` and `" python "` hash to the same key |
| `pathId` | courses-only (`ListCoursesQueryDto`) |
| `standalone` | courses-only — added as literal `true` when truthy |

---

## 3. Why a separate helper

`buildQueryHash` (from `cache-keys.ts`) is the low-level "sort
keys and SHA-256 them" primitive. `computeQueryHash` is the
application-level "what does a list query look like when
normalized" helper. Splitting them means:

- The primitive is reusable for any future cache key that needs
  a stable hash of a record.
- The normalization rules (§2) live next to the DTO types they
  reference, in the paths module.
- Changing the defaults (say, `limit` defaults to 25) is a
  single-file edit and does not touch the cache-keys module.

The helper accepts `ListPathsQueryDto | ListCoursesQueryDto`
because the overlap between the two DTOs is 90%+, and
maintaining two near-identical helpers would be redundant.

---

## 4. Hash length and collisions

The underlying `buildQueryHash` returns a 16-character hex
prefix of the SHA-256 digest — 64 bits. Collisions on the query
space we use are astronomically unlikely. See
[../../cache/cache-keys.md §4](../../cache/cache-keys.md).

---

## 5. Tests

| File | Covers |
|------|--------|
| `src/content/paths/query-hash.helper.spec.ts` | `?page=1` ≡ `?`, `?sort=order&order=asc&page=1&limit=20` ≡ `?`, `?search=Python` ≡ `?search= python ` (lowercase-trim), order-invariance (sorted keys), presence of new fields flips the hash, `pathId` and `standalone` are path-only/courses-only fields that appear only for courses. |

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/paths/query-hash.helper.ts` | The helper |
| `src/common/cache/cache-keys.ts` | `buildQueryHash` primitive |
| `src/content/paths/paths.service.ts` | Consumer |
| `src/content/courses/courses.service.ts` | Consumer (imports from `../paths/query-hash.helper`) |

---

## 7. Things NOT to change without coordination

- The default-omission rules. A new deploy that changes them
  is a cache-wide invalidation event — every hash on every
  existing key turns into a miss, and the next 5 minutes of
  traffic all hit the DB uncached.
- The `search.toLowerCase().trim()` normalization. Splitting
  "Python" from "python" would double the key space.
- The cross-module reuse: `CoursesService` imports from
  `paths/query-hash.helper.ts`. Moving this file to a shared
  location requires updating both imports.
