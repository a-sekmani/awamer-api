# List Public Tags — Backend Spec (awamer-api)

> **Module:** `TagsModule`
> **Endpoint:** `GET /api/v1/tags`
> **Decorator:** `@Public()`
> **Status code:** `200 OK`
> **HTTP cache:** `Cache-Control: public, max-age=60`

---

## 1. Summary

`listPublicTags` returns every `ACTIVE` tag with its count of
published paths and published courses. The response is served from a
no-expiry Redis cache (`tags:all`), and the controller also sets an
HTTP `Cache-Control` header so CDN / browser layers can cache the
response for up to 60 seconds.

`HIDDEN` tags are omitted.

---

## 2. Request

```
GET /api/v1/tags
```

No query parameters. No auth.

---

## 3. Behavior — `TagsService.listPublic()`

Source: `src/content/tags/tags.service.ts` `listPublic()`.

1. **Cache read.** `cache.get<TagResponseDto[]>('tags:all')`. Hit → return.
2. **DB read.** `prisma.tag.findMany({ where: { status: TagStatus.ACTIVE }, orderBy: { name: 'asc' } })`.
3. **Load counts.** `loadCounts()` (private helper) runs two
   `groupBy` queries in parallel:
   ```ts
   prisma.pathTag.groupBy({
     by: ['tagId'],
     where: { path: { status: PathStatus.PUBLISHED } },
     _count: { _all: true },
   });
   prisma.courseTag.groupBy({
     by: ['tagId'],
     where: { course: { status: CourseStatus.PUBLISHED } },
     _count: { _all: true },
   });
   ```
   These are aggregated into two `Map<tagId, count>` structures.
4. **Map to DTO.** `toPublicDto(tag, pathCounts, courseCounts)`:
   ```ts
   {
     id, name, slug,
     pathCount:   pathCounts.get(tag.id)   ?? 0,
     courseCount: courseCounts.get(tag.id) ?? 0,
   }
   ```
5. **Cache write.** `cache.set('tags:all', dto, CacheTTL.TAGS)` with
   `CacheTTL.TAGS = null` (no expiry).
6. **Return** the array.

The `status` field is **not** included in the public DTO —
`TagResponseDto` omits it because public consumers always receive
only `ACTIVE` tags and the distinction is irrelevant to them.

---

## 4. `TagResponseDto`

```ts
{
  id: string,
  name: string,
  slug: string,
  pathCount: number,
  courseCount: number,
}
```

---

## 5. HTTP cache

```ts
@Header('Cache-Control', 'public, max-age=60')
```

Sets the response header on every call (hit or miss). CDN layers
and user-agent caches may hold the response for up to 60 seconds.
This is a second layer on top of Redis — the Redis cache is
no-expiry and invalidated on every tag mutation; the HTTP cache is
time-bounded and intentionally opaque to backend invalidation.

The 60-second window is short enough that an admin-editing workflow
stays pleasant but long enough that a cold CDN POP does not hammer
the API.

---

## 6. Successful response

```json
{
  "data": [
    { "id": "uuid", "name": "AI",           "slug": "ai",           "pathCount": 3, "courseCount": 5 },
    { "id": "uuid", "name": "Cybersecurity","slug": "cybersecurity","pathCount": 2, "courseCount": 1 }
  ],
  "message": "Success"
}
```

Empty DB → `"data": []`.

---

## 7. Error responses

| Status | When |
|--------|------|
| `429 RATE_LIMIT_EXCEEDED` | Global throttler tripped. |
| `500 INTERNAL_ERROR` | Prisma error. |

No 401/403/404.

---

## 8. Cache behavior

| Key | Format | TTL | Invalidated by |
|-----|--------|-----|----------------|
| `tags:all` | literal | `null` | Every `TagsService.create` / `update` / `remove` (see [admin-create-tag.md](./admin-create-tag.md), [admin-update-tag.md](./admin-update-tag.md), [admin-delete-tag.md](./admin-delete-tag.md)) |

The tag invalidation sites **also** flush `paths:list:*` and
`courses:list:*` — see [../cache/invalidation-flow.md](../cache/invalidation-flow.md).

---

## 9. Side effects

- Cache write on miss.
- No database writes.

---

## 10. Files involved

| File | Role |
|------|------|
| `src/content/tags/tags.controller.ts` | Handler + `Cache-Control` header |
| `src/content/tags/tags.service.ts` | `listPublic()`, `loadCounts()`, `toPublicDto()` |
| `src/content/tags/dto/tag-response.dto.ts` | Public shape |
| `src/common/cache/cache.service.ts` | `get` / `set` |
| `src/common/cache/cache-keys.ts` | `CacheKeys.tags.all()`, `CacheTTL.TAGS` |

---

## 11. Tests

| File | Covers |
|------|--------|
| `src/content/tags/tags.service.spec.ts` | Cache hit path, cache miss path, `HIDDEN` exclusion, `_count._all` aggregation correctness, `PUBLISHED`-only filter on both sides of `loadCounts`. |
| `test/content/tags/*.e2e-spec.ts` | Response envelope, `Cache-Control` header, empty-list case, HIDDEN tag absence. |

---

## 12. Things NOT to change without coordination

- The `Cache-Control: public, max-age=60` header. The frontend
  build assumes it for ISR revalidation timing on the
  `/paths?tag=...` and `/courses?tag=...` filtered views.
- The `PUBLISHED`-only count filter on both path and course counts.
  Including draft rows would leak unpublished content through the
  count.
- The exclusion of `status` from `TagResponseDto`. Adding it would
  confuse public consumers that expect every returned tag to be
  active.
- The `null` TTL on `tags:all`. Every tag mutation already
  invalidates it; a TTL would just hide invalidation bugs.
