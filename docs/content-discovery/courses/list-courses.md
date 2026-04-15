# List Courses — Backend Spec (awamer-api)

> **Module:** `CoursesModule`
> **Endpoint:** `GET /api/v1/courses`
> **Decorator:** `@Public()`
> **Status code:** `200 OK`

---

## 1. Summary

Paginated public list of `PUBLISHED` courses, filterable by
category, tag, level, search, parent path, or the
"standalone-only" flag. Mirrors
[../paths/list-paths.md](../paths/list-paths.md) with
course-specific filters and shapes. Cache-aside on
`courses:list:<queryHash>` with a 5-minute TTL.

---

## 2. Request

```
GET /api/v1/courses
```

### Query — `ListCoursesQueryDto`
Source: `src/content/courses/dto/list-courses.query.dto.ts`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `categoryId` | `string?` | — | filter by category |
| `tagId` | `string?` | — | filter by tag |
| `level` | `'beginner' \| 'intermediate' \| 'advanced'?` | — | **case-normalized to UPPERCASE** before matching against the `CourseLevel` enum (`Course.level` is a real Prisma enum, unlike `Path.level`) |
| `search` | `string?` | — | `contains`, case-insensitive, matches `title` or `subtitle` |
| `pathId` | `string?` | — | filter to courses belonging to a specific parent path |
| `standalone` | `boolean?` | — | when `true`, filter to `pathId IS NULL` |
| `sort` | `'order' \| 'created_at' \| 'title'` | `'order'` | primary sort |
| `order` | `'asc' \| 'desc'` | `'asc'` | sort direction |
| `page` | `number` | `1` | `@Min(1)` |
| `limit` | `number` | `20` | `@Min(1)`, `@Max(100)` |

### The `pathId` vs `standalone` rule

```ts
if (query.pathId && query.standalone === true) {
  throw new BadRequestException('Cannot supply both pathId and standalone');
}
```

Early rejection in `listPublic` — the two filters are mutually
exclusive.

---

## 3. Behavior — `CoursesService.listPublic(query)`

Source: `src/content/courses/courses.service.ts` `listPublic()`.

Same shape as
[../paths/list-paths.md §3](../paths/list-paths.md):

1. **Early `pathId`/`standalone` conflict check** — see §2.
2. **Defaults** — `page ??= 1`, `limit ??= 20`.
3. **Cache key** — `computeQueryHash(query)` from
   [../paths/query-hash-helper.md](../paths/query-hash-helper.md)
   (shared helper). Then `CacheKeys.courses.list(hash)`.
4. **Cache read** — hit → return.
5. **Build where** via `buildCourseListWhere`:
   - `status: PUBLISHED` always.
   - `categoryId`, `tagId`, `level.toUpperCase()`, `search OR
     (title, subtitle)` same as paths.
   - `pathId` → exact match.
   - `standalone === true` → `pathId: null`.
6. **Build orderBy** via `buildCourseOrderBy`
   ([course-stats-helper.md](./course-stats-helper.md)). Same
   three sort keys as paths, same `{ id: 'asc' }` tiebreaker.
7. **Read rows + count** in a `$transaction`, includes
   `category`, `path`, `tags`, `sections → lessons`, and the
   project count.
8. **Map** via `toCourseSummaryDto(course, computeCourseStats(course))`.
9. **Cache write** with `CacheTTL.LIST` (300s).
10. **Return** the paginated envelope.

---

## 4. Response shape

```json
{
  "data": {
    "data": [
      {
        "id": "uuid",
        "slug": "intro-sql",
        "title": "Intro to SQL",
        "subtitle": "...",
        "level": "beginner",
        "thumbnail": "https://...",
        "category": { "id": "...", "name": "Databases", "slug": "databases" },
        "path": { "id": "...", "slug": "data-engineering", "title": "Data Engineering" },
        "tags": [ { "id": "...", "name": "sql", "slug": "sql" } ],
        "isFree": true,
        "isNew": false,
        "stats": { "sectionCount": 4, "lessonCount": 12, "totalDurationMinutes": 180 }
      }
    ],
    "meta": { "total": 37, "page": 1, "limit": 20, "totalPages": 2 }
  },
  "message": "Success"
}
```

`path` is `null` for standalone courses. The double-wrap envelope
and the frontend `response.data.data` rule apply — see
[../../api-conventions.md §2](../../api-conventions.md).

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | Query DTO rejected. |
| `400`  | `"Cannot supply both pathId and standalone"`. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Prisma error. |

---

## 6. Cache behavior

| Key | Format | TTL | Invalidated by |
|-----|--------|-----|----------------|
| `courses:list:<queryHash>` | 16-hex suffix | **300s** | Tag mutations, `ReplaceTagAssociationsHelper`, marketing mutations via `invalidateOwner('course', id)`. See [../../cache/invalidation-flow.md](../../cache/invalidation-flow.md). |

---

## 7. Side effects

Cache write on miss. No DB writes.

---

## 8. Files involved

| File | Role |
|------|------|
| `src/content/courses/courses.controller.ts` | `list()` handler |
| `src/content/courses/courses.service.ts` | `listPublic()` |
| `src/content/courses/course-stats.helper.ts` | `computeCourseStats`, `buildCourseOrderBy` |
| `src/content/courses/course-mapper.ts` | `toCourseSummaryDto` |
| `src/content/paths/query-hash.helper.ts` | `computeQueryHash` (shared) |
| `src/content/courses/dto/list-courses.query.dto.ts` | Query validation |

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/content/courses/courses.service.spec.ts` | Cache hit/miss, filter composition including `pathId` and `standalone`, mutual-exclusion rejection, level UPPERCASE normalization, pagination envelope shape. |
| `src/content/courses/course-stats.helper.spec.ts` | `computeCourseStats` for various topologies, `buildCourseOrderBy` for every combination. |
| `test/content/courses/*.e2e-spec.ts` | End-to-end envelope, filters, 400 on mutual exclusion. |

---

## 10. Things NOT to change without coordination

- The `level.toUpperCase()` conversion. `Course.level` is a real
  Prisma enum and the query param is lowercase; the mismatch
  must be handled here.
- The mutual exclusion of `pathId` and `standalone`. Silently
  dropping one or the other would let the client request a
  paradoxical filter.
- The `{ id: 'asc' }` pagination tiebreaker in `buildCourseOrderBy`.
- The double-wrap response shape. See §4.
- The `PUBLISHED`-only filter.
- Sharing `computeQueryHash` with paths. Forking it would let
  the two services drift on default-omission rules.
