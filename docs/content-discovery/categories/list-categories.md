# List Categories — Backend Spec (awamer-api)

> **Module:** `CategoriesModule` (under `ContentModule`)
> **Endpoint:** `GET /api/v1/categories`
> **Decorator:** `@Public()`
> **Status code:** `200 OK`

---

## 1. Summary

`listCategories` returns every active category together with its
count of published paths and courses. The response is served from a
no-expiry cache key (`categories:all`) and rebuilt from the database
only on a cache miss.

There is currently **no admin Categories CRUD**. Categories are
managed directly in the database (via seed scripts or SQL) until the
admin module lands — a TODO at the top of
`src/content/categories/categories.service.ts` flags this:

> When the admin Categories CRUD module is built, it MUST call
> `this.cache.del(CacheKeys.categories.all())` on every mutation to
> invalidate the `categories:all` cache. Until then, manual flush is
> required.

---

## 2. Request

```
GET /api/v1/categories
```

No query parameters. No auth. Decorated `@Public()`.

---

## 3. Behavior — `CategoriesService.listAllPublic()`

Source: `src/content/categories/categories.service.ts` `listAllPublic()`.

1. **Cache read.** `cache.get<CategoryResponseDto[]>('categories:all')`.
   On hit, return the deserialized array immediately.
2. **DB read (on miss).**
   ```ts
   prisma.category.findMany({
     where: { status: CategoryStatus.ACTIVE },
     orderBy: { order: 'asc' },
     include: {
       _count: {
         select: {
           paths:   { where: { status: PathStatus.PUBLISHED } },
           courses: { where: { status: CourseStatus.PUBLISHED } },
         },
       },
     },
   });
   ```
   - Only `ACTIVE` categories are returned; `HIDDEN` categories are
     invisible to the public list even if they have paths/courses.
   - `pathCount` counts only `PUBLISHED` paths. `DRAFT` and `ARCHIVED`
     paths are excluded from the count.
   - `courseCount` counts only `PUBLISHED` courses, including
     standalone courses attached to the category directly.
   - Ordering is by `category.order` ascending. Categories with the
     same `order` have an undefined relative order — pagination is
     not used here so it is not a correctness concern.
3. **Map to DTO.** See §4.
4. **Cache write.** `cache.set('categories:all', dto, CacheTTL.CATEGORIES)`
   where `CacheTTL.CATEGORIES` is `null` (no expiry).
5. **Return** the array.

---

## 4. `CategoryResponseDto`

```ts
export class CategoryResponseDto {
  id!: string;
  name!: string;
  slug!: string;
  description!: string | null;
  icon!: string | null;
  order!: number;
  pathCount!: number;
  courseCount!: number;
}
```

`description` and `icon` are `null` when the underlying column is
NULL. The DTO is serialized to JSON with `null` values — consumers
must handle them explicitly.

---

## 5. Successful response

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Cybersecurity",
      "slug": "cybersecurity",
      "description": "...",
      "icon": "shield",
      "order": 0,
      "pathCount": 3,
      "courseCount": 7
    },
    { "...": "..." }
  ],
  "message": "Success"
}
```

An empty database returns `"data": []` with `"message": "Success"`.

---

## 6. Error responses

| Status | When |
|--------|------|
| `429 RATE_LIMIT_EXCEEDED` | Global throttler tripped (very unlikely on this endpoint). |
| `500 INTERNAL_ERROR` | Prisma read failed. |

No 401, 403, or 404 — the endpoint is public and never returns
"category not found" (listing is always defined, even when empty).

---

## 7. Cache behavior

| Key | Format | TTL | Invalidated by |
|-----|--------|-----|----------------|
| `categories:all` | literal | `null` | No automatic invalidation yet (no admin CRUD). Manual flush via `redis-cli DEL categories:all`. |

See [../../cache/cache-keys.md §3](../../cache/cache-keys.md) for the
full table.

---

## 8. Side effects

- Cache write on miss.
- No database writes.

---

## 9. Files involved

| File | Role |
|------|------|
| `src/content/categories/categories.controller.ts` | `GET /categories` handler |
| `src/content/categories/categories.service.ts` | Cache-aside read + the `loadCounts` aggregation |
| `src/content/categories/dto/category-response.dto.ts` | Response shape |
| `src/content/categories/categories.module.ts` | Module wiring |
| `src/common/cache/cache.service.ts` | `get` / `set` |
| `src/common/cache/cache-keys.ts` | `CacheKeys.categories.all()` |

---

## 10. Tests

| File | Covers |
|------|--------|
| `src/content/categories/categories.service.spec.ts` | Cache-miss path returns DB rows mapped to DTOs; cache-hit path bypasses the DB; `HIDDEN` categories are excluded; `DRAFT`/`ARCHIVED` paths and courses are excluded from the counts; ordering by `order` ascending. |
| `test/content/categories/*.e2e-spec.ts` | End-to-end HTTP shape matches §5, including the response envelope and the empty-list case. |

---

## 11. Things NOT to change without coordination

- The `PUBLISHED`-only filter on the count subqueries. Public users
  must not see counts that include draft content.
- The `null` TTL on `categories:all`. Until the admin CRUD lands,
  the only way the cache can go stale is a direct DB edit — and a
  TTL-bounded cache would just hide the lack of invalidation.
- The `@Public()` decorator. Logged-out visitors must be able to
  see the category list.
- Adding a listing `limit` / pagination. The category list is small
  by design (fewer than 100 rows expected in the lifetime of the
  product). If that ever changes, add pagination — do not sneak in
  a hard cap on the Prisma query.
