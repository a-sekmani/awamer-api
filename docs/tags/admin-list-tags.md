# Admin — List Tags — Backend Spec (awamer-api)

> **Module:** `TagsModule`
> **Endpoint:** `GET /api/v1/admin/tags`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

`listAdminTags` returns **every** tag — including `HIDDEN` ones —
with path/course counts, the `status` field, and the `createdAt`
timestamp. This is the admin view; the public variant is at
[list-public-tags.md](./list-public-tags.md).

Unlike the public endpoint, **this endpoint does not cache**. The
admin list is expected to be viewed briefly during CRUD operations
and the staleness/invalidation complexity is not worth the savings.

---

## 2. Request

```
GET /api/v1/admin/tags
Cookie: access_token=<JWT>   (required — admin role)
```

No query parameters.

---

## 3. Auth

- `JwtAuthGuard` — valid access token required (401 otherwise).
- `RolesGuard` + `@Roles('admin')` — user must have role `ADMIN`.
  **Note:** the source file flags this with a TODO —
  `RolesGuard` is currently a stub that always returns true. The
  endpoint is intended to be admin-only; the stub exists because
  the admin-role mechanism is not fully wired yet. Do not treat
  this as "admin-gated" in production until `RolesGuard` is real.

---

## 4. Behavior — `TagsService.listAdmin()`

Source: `src/content/tags/tags.service.ts` `listAdmin()`.

```ts
const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });
const { pathCounts, courseCounts } = await this.loadCounts();
return tags.map((tag) => this.toAdminDto(tag, pathCounts, courseCounts));
```

- Returns **all tags** (no `status` filter).
- Ordered by `name` ascending.
- `loadCounts()` is the same helper used by the public list; it
  counts only `PUBLISHED` paths and courses. Admin views therefore
  see the **public-facing** count, not a "total associations
  regardless of publish state" count. This is deliberate: the admin
  UI presents the number as "how many users will see when the tag
  is shown".

---

## 5. `AdminTagResponseDto`

```ts
{
  id: string,
  name: string,
  slug: string,
  pathCount: number,     // published only
  courseCount: number,   // published only
  status: TagStatus,     // 'ACTIVE' | 'HIDDEN'
  createdAt: string,     // ISO-8601
}
```

Built by `toAdminDto` which spreads `toPublicDto` and adds
`status` + `createdAt`.

---

## 6. Successful response

```json
{
  "data": [
    { "id": "...", "name": "AI",     "slug": "ai",     "pathCount": 3, "courseCount": 5, "status": "ACTIVE", "createdAt": "2026-04-01T12:00:00.000Z" },
    { "id": "...", "name": "Legacy", "slug": "legacy", "pathCount": 0, "courseCount": 0, "status": "HIDDEN", "createdAt": "2025-12-15T09:30:00.000Z" }
  ],
  "message": "Success"
}
```

Empty DB → `"data": []`.

---

## 7. Error responses

| Status | When |
|--------|------|
| `401`  | Missing/invalid access token. |
| `403`  | Authenticated but not admin (once `RolesGuard` is real). |
| `429 RATE_LIMIT_EXCEEDED` | Global throttler tripped. |

---

## 8. Cache behavior

- **Read path:** no cache. Every request hits the DB.
- **Invalidation:** `CacheKeys.tags.adminAll()` (`tags:admin:all`) is
  declared in `CacheKeys` and is pre-emptively `del`'d by
  `TagsService.create`/`update`/`remove` for forward compatibility,
  but the current admin list does not read it. If you enable
  caching on this endpoint, the invalidation is already in place.

See [../cache/cache-keys.md](../cache/cache-keys.md) row
`tags:admin:all`.

---

## 9. Side effects

None. Read-only.

---

## 10. Files involved

| File | Role |
|------|------|
| `src/content/tags/admin-tags.controller.ts` | Handler + guard decorators |
| `src/content/tags/tags.service.ts` | `listAdmin()`, `loadCounts()`, `toAdminDto()` |
| `src/content/tags/dto/admin-tag-response.dto.ts` | Admin shape |
| `src/auth/guards/jwt-auth.guard.ts` | Auth gate |
| `src/common/guards/roles.guard.ts` | Role gate (currently a stub) |

---

## 11. Tests

| File | Covers |
|------|--------|
| `src/content/tags/tags.service.spec.ts` | `listAdmin` returns `HIDDEN` tags, counts are `PUBLISHED`-filtered (not raw), sort order by name. |
| `test/content/tags/*.e2e-spec.ts` | Auth guard enforcement (401 without cookie), response shape, HIDDEN tags present. |

---

## 12. Things NOT to change without coordination

- The "no-cache" read path. A TTL here would create a visible lag
  between admin edits and the admin list, which is the worst place
  to add caching.
- The `loadCounts` sharing with the public endpoint. Diverging the
  two count functions is a recipe for "public and admin show
  different numbers".
- The `PUBLISHED`-only filter on the counts. See §4.
- The `@Roles('admin')` decorator. Even though `RolesGuard` is
  currently a stub, leaving the decorator in place means the route
  becomes admin-only automatically the moment the guard is made
  real — no code change required at the controller.
