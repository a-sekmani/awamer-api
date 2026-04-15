# Admin — Create Tag — Backend Spec (awamer-api)

> **Module:** `TagsModule`
> **Endpoint:** `POST /api/v1/admin/tags`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `201 Created`

---

## 1. Summary

Creates a new `Tag` row. Slug must match the DTO pattern and must
be unique across the `tags` table. Before writing, the service
flushes the tag caches and the paths/courses list-pattern caches —
**see [../cache/invalidation-flow.md](../cache/invalidation-flow.md) §2**.

---

## 2. Request

```
POST /api/v1/admin/tags
Content-Type: application/json
Cookie: access_token=<JWT>
```

### Body — `CreateTagDto`
Source: `src/content/tags/dto/create-tag.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `name` | `string` | yes | `@IsString`, `@Transform(trim)`, `@Length(1, 100)`, `@Matches(/\S/)` ("must not be blank") |
| `slug` | `string` | yes | `@IsString`, `@Length(1, 60)`, `@Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)` ("lowercase letters, digits, single hyphens") |
| `status` | `TagStatus?` | no | `@IsOptional`, `@IsEnum(TagStatus)` — defaults to `ACTIVE` |

### Example

```json
{ "name": "AI", "slug": "ai", "status": "ACTIVE" }
```

The global `ValidationPipe` strips unknown fields and rejects the
request with `VALIDATION_FAILED` if any are present.

---

## 3. Behavior — `TagsService.create(dto)`

Source: `src/content/tags/tags.service.ts` `create()`.

1. **Invalidate caches first** (before the write):
   ```
   del   tags:all
   del   tags:admin:all
   delByPattern paths:list:*
   delByPattern courses:list:*
   ```
2. **Insert** the tag:
   ```ts
   prisma.tag.create({
     data: { name, slug, status: dto.status ?? TagStatus.ACTIVE },
   });
   ```
3. **On `P2002` (unique constraint)** → `ConflictException(\`Tag with slug '${dto.slug}' already exists\`)`.
4. **On other Prisma errors** → rethrow (becomes `INTERNAL_ERROR`).
5. **Load counts** via `loadCounts()` and return `toAdminDto(tag, pathCounts, courseCounts)`. A newly created tag has
   `pathCount: 0` and `courseCount: 0`.

### Why invalidate before the write?

If invalidation happens *after* the write, a concurrent reader can
race the writer's commit:

1. Reader A queries `tags:all` → miss.
2. Writer B commits the new tag.
3. Writer B calls `del tags:all` (no-op, nothing cached yet).
4. Reader A reads DB — sees the new tag, writes it to `tags:all`.

With invalidate-before-write:

1. Writer B calls `del tags:all` — guaranteed empty.
2. Reader A queries `tags:all` → miss.
3. Writer B commits.
4. Reader A reads DB — either sees the new tag (ok) or doesn't
   (reloads stale on the next miss, but will be correct once Writer
   B completes because subsequent reads will refill).

The invalidate-first ordering closes a small race where the cache
could carry pre-write data for the lifetime of the key.

---

## 4. Successful response

```
HTTP/1.1 201 Created
```

```json
{
  "data": {
    "id": "uuid",
    "name": "AI",
    "slug": "ai",
    "pathCount": 0,
    "courseCount": 0,
    "status": "ACTIVE",
    "createdAt": "ISO"
  },
  "message": "Success"
}
```

---

## 5. Error responses

| Status | `errorCode` | When |
|--------|-------------|------|
| `400 VALIDATION_FAILED` | `VALIDATION_FAILED` | DTO validation failed (bad slug pattern, blank name, unknown field). |
| `401`  | — | Missing/invalid access token. |
| `403`  | — | Not admin (once `RolesGuard` is real). |
| `409`  | — (plain `ConflictException`) | A tag with this `slug` already exists. |
| `429 RATE_LIMIT_EXCEEDED` | `RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | `INTERNAL_ERROR` | Unexpected Prisma error. |

Note: the 409 path does **not** carry an `errorCode`. The frontend
branches on HTTP status alone. See [../error-codes.md §5](../error-codes.md).

---

## 6. Side effects

| Table / key | Mutation |
|-------------|----------|
| `tags` | INSERT (new row) |
| `tags:all` (redis) | DEL |
| `tags:admin:all` (redis) | DEL |
| `paths:list:*` (redis) | pattern DEL |
| `courses:list:*` (redis) | pattern DEL |

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/tags/admin-tags.controller.ts` | Handler |
| `src/content/tags/tags.service.ts` | `create()` logic + invalidation |
| `src/content/tags/dto/create-tag.dto.ts` | Request validation |
| `src/content/tags/dto/admin-tag-response.dto.ts` | Response shape |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/tags/tags.service.spec.ts` | Successful create round-trip; `P2002` → `ConflictException`; invalidation calls fire in the right order (mocked `CacheService`); `status` defaults to `ACTIVE` when omitted. |
| `test/content/tags/*.e2e-spec.ts` | DTO validation errors (blank name, bad slug pattern, unknown field → 400), success path returns 201 with the populated DTO, second create with the same slug returns 409. |

---

## 9. Things NOT to change without coordination

- The "invalidate before write" ordering. See §3.
- The `(name, slug)` validation patterns. The frontend form
  pre-validates against the same regex.
- The flushing of `paths:list:*` / `courses:list:*`. A new tag
  changes which paths/courses the `?tag=...` filter returns.
- The `P2002` → `ConflictException` mapping. The service depends
  on the DB unique constraint as the single point of slug
  enforcement; adding a read-then-write pre-check would re-open a
  TOCTOU race.
