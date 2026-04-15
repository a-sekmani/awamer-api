# List Paths — Backend Spec (awamer-api)

> **Module:** `PathsModule`
> **Endpoint:** `GET /api/v1/paths`
> **Decorator:** `@Public()`
> **Status code:** `200 OK`

---

## 1. Summary

Paginated public list of `PUBLISHED` paths, filterable by
category, tag, level, and free-text search. Each row carries the
path's category, tags, free/new flags, and computed statistics
(course count, lesson count, total duration). Cache-aside on
`paths:list:<queryHash>` with a 5-minute TTL.

---

## 2. Request

```
GET /api/v1/paths
```

### Query — `ListPathsQueryDto`
Source: `src/content/paths/dto/list-paths.query.dto.ts`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `categoryId` | `string?` | — | filter by category |
| `tagId` | `string?` | — | filter by tag (joins on `PathTag`) |
| `level` | `'beginner' \| 'intermediate' \| 'advanced'?` | — | case-insensitive match on `Path.level` (stored as `String?`) |
| `search` | `string?` | — | `contains`, case-insensitive, matches `title` OR `subtitle` |
| `sort` | `'order' \| 'created_at' \| 'title'` | `'order'` | primary sort key |
| `order` | `'asc' \| 'desc'` | `'asc'` | sort direction |
| `page` | `number` | `1` | `@Min(1)` |
| `limit` | `number` | `20` | `@Min(1)`, `@Max(100)` |

Unknown query fields are rejected by the global `ValidationPipe`.

---

## 3. Behavior — `PathsService.listPublic(query)`

Source: `src/content/paths/paths.service.ts` `listPublic()`.

1. **Defaults** — `page ??= 1`, `limit ??= 20`.
2. **Cache key** — `computeQueryHash(query)` from
   [query-hash-helper.md](./query-hash-helper.md), then
   `CacheKeys.paths.list(hash)` — e.g. `paths:list:7a8b9c...`.
3. **Cache read** — hit → return.
4. **Build where** via `buildPathListWhere`:
   ```ts
   { status: PathStatus.PUBLISHED }
   + categoryId / tags.some / level (insensitive) / OR (title, subtitle)
   ```
5. **Build orderBy** via `buildOrderBy(query)`
   ([path-stats-helper.md](./path-stats-helper.md)), which always
   ends with `{ id: 'asc' }` as the pagination tiebreaker — per
   FR-030a.
6. **Read rows + count** in a `$transaction`:
   ```ts
   $transaction([
     path.findMany({ where, include: { category, tags: { include: { tag } }, courses: { where: PUBLISHED, include: { sections: { include: { lessons } }, _count: { projects } } } }, orderBy, skip, take: limit }),
     path.count({ where }),
   ])
   ```
7. **Compute stats** for each row via `computePathStats` (course /
   lesson / duration / project counts — see
   [path-stats-helper.md](./path-stats-helper.md)) and **map** via
   `toPathSummaryDto`.
8. **Assemble** the paginated envelope
   `{ data, meta: { total, page, limit, totalPages } }`.
9. **Cache write** — `cache.set(key, result, CacheTTL.LIST)` with
   `CacheTTL.LIST = 300` (5 minutes).
10. **Return** the envelope.

---

## 4. Response shape

```json
{
  "data": {
    "data": [
      {
        "id": "uuid",
        "slug": "cybersecurity-foundations",
        "title": "Cybersecurity Foundations",
        "subtitle": "...",
        "level": "beginner",
        "thumbnail": "https://...",
        "category": { "id": "...", "name": "Cybersecurity", "slug": "cybersecurity" },
        "tags": [{ "id": "...", "name": "security", "slug": "security" }],
        "isFree": false,
        "isNew": true,
        "stats": { "courseCount": 4, "lessonCount": 45, "totalDurationMinutes": 900 }
      }
    ],
    "meta": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
  },
  "message": "Success"
}
```

**Double-wrap note:** the service returns
`{ data: [...], meta: {...} }`, and the global
`ResponseTransformInterceptor` wraps that in another
`{ data, message }`. Frontend consumers must read
`response.data.data` for the array and `response.data.meta` for
pagination. See [../../api-conventions.md §2](../../api-conventions.md).

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | Query DTO rejected (bad `level`, out-of-range `limit`, unknown field). |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Prisma error. |

No 401/403/404 on the list itself.

---

## 6. Cache behavior

| Key | Format | TTL | Invalidated by |
|-----|--------|-----|----------------|
| `paths:list:<queryHash>` | 16-hex suffix | **300s** (`CacheTTL.LIST`) | Tag mutations (TagsService.{create,update,remove}, ReplaceTagAssociationsHelper.{replaceForPath,replaceForCourse}); marketing mutations via `invalidateOwner('path', id)` (pattern delete) |

The 5-minute TTL is the safety net for cases where a list query
shape is not covered by a targeted invalidation. See
[../../cache/invalidation-flow.md §7](../../cache/invalidation-flow.md).

---

## 7. Side effects

None beyond the cache write on miss.

---

## 8. Files involved

| File | Role |
|------|------|
| `src/content/paths/paths.controller.ts` | `list()` handler |
| `src/content/paths/paths.service.ts` | `listPublic()` |
| `src/content/paths/path-stats.helper.ts` | `computePathStats`, `buildOrderBy`, `normalizeLevel` |
| `src/content/paths/path-mapper.ts` | `toPathSummaryDto` |
| `src/content/paths/query-hash.helper.ts` | `computeQueryHash` |
| `src/content/paths/dto/list-paths.query.dto.ts` | Query validation |
| `src/content/paths/dto/path-summary.dto.ts` | Response shape |
| `src/common/cache/cache.service.ts` | `get` / `set` |
| `src/common/cache/cache-keys.ts` | `CacheKeys.paths.list`, `CacheTTL.LIST`, `buildQueryHash` |

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/content/paths/paths.service.spec.ts` | Cache hit vs miss, filter composition (categoryId, tagId, level, search), `buildOrderBy` tiebreaker always `{ id: 'asc' }`, pagination envelope shape, stats correctness across different topologies. |
| `src/content/paths/path-stats.helper.spec.ts` | `computePathStats` for empty/full nesting, `normalizeLevel` for valid/invalid strings, `buildOrderBy` for every `sort`/`order` combination. |
| `src/content/paths/query-hash.helper.spec.ts` | Default omission (page=1, limit=20, sort=order, order=asc all dropped), lowercase-trim on `search`, order-invariance. |
| `test/content/paths/*.e2e-spec.ts` | End-to-end envelope, filter composition, cache headers. |

---

## 10. Things NOT to change without coordination

- The `{ id: 'asc' }` pagination tiebreaker in `buildOrderBy`.
  Without it, a page-boundary with tied primary sort keys is
  non-deterministic.
- The `PUBLISHED`-only `where`. Draft paths must never leak to
  the public list.
- The `CacheTTL.LIST = 300` value — the frontend ISR cadence
  assumes this.
- The double-wrap response shape. See §4.
- The case-insensitive `level` filter. `Path.level` is stored as
  `String?` (Decision D — schema frozen), so a case-sensitive
  match would surprise admins who typed "Beginner".
- The ordering of the `PUBLISHED` filter on nested `courses`.
  Including `DRAFT` courses in the count would show inflated
  stats.
