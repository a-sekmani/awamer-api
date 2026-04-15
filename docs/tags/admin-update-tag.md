# Admin — Update Tag — Backend Spec (awamer-api)

> **Module:** `TagsModule`
> **Endpoint:** `PATCH /api/v1/admin/tags/:id`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Patches an existing `Tag` row. Every field is optional; at least one
must be present. A name/slug/status change ripples into the public
cache and the paths/courses list-pattern cache, so the invalidation
sequence is identical to [admin-create-tag.md §3](./admin-create-tag.md).

---

## 2. Request

```
PATCH /api/v1/admin/tags/:id
Content-Type: application/json
Cookie: access_token=<JWT>
```

### Body — `UpdateTagDto`
Source: `src/content/tags/dto/update-tag.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `name` | `string?` | no | `@IsOptional`, `@IsString`, `@Transform(trim)`, `@Length(1, 100)`, `@Matches(/\S/)` |
| `slug` | `string?` | no | `@IsOptional`, `@IsString`, `@Length(1, 60)`, `@Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)` |
| `status` | `TagStatus?` | no | `@IsOptional`, `@IsEnum(TagStatus)` |

All three are optional individually; the service throws
`BadRequestException('At least one field must be provided')` when the
body has no keys.

### Example

```json
{ "status": "HIDDEN" }
```

---

## 3. Behavior — `TagsService.update(id, dto)`

Source: `src/content/tags/tags.service.ts` `update()`.

1. **Empty-body guard.** `Object.keys(dto).length === 0` → throw
   `BadRequestException('At least one field must be provided')`.
2. **Invalidate caches** (same four calls as create — see
   [admin-create-tag.md §3](./admin-create-tag.md) for the rationale):
   ```
   del tags:all
   del tags:admin:all
   delByPattern paths:list:*
   delByPattern courses:list:*
   ```
3. **Update** the row with only the provided fields:
   ```ts
   prisma.tag.update({
     where: { id },
     data: {
       ...(dto.name   !== undefined ? { name:   dto.name   } : {}),
       ...(dto.slug   !== undefined ? { slug:   dto.slug   } : {}),
       ...(dto.status !== undefined ? { status: dto.status } : {}),
     },
   });
   ```
4. **On `P2025` (record not found)** → `NotFoundException(\`Tag '${id}' not found\`)`.
5. **On `P2002` (unique slug)** → `ConflictException(\`Tag with slug '${dto.slug ?? ''}' already exists\`)`.
6. **Load counts** and return `toAdminDto(...)`.

---

## 4. Successful response

```json
{
  "data": {
    "id": "uuid",
    "name": "AI",
    "slug": "ai",
    "pathCount": 3,
    "courseCount": 5,
    "status": "HIDDEN",
    "createdAt": "ISO"
  },
  "message": "Success"
}
```

Counts reflect the current DB state, not the effect of the update
(if you flip a tag to `HIDDEN`, counts remain the same — the
association rows are not touched).

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | DTO validation failure. |
| `400` (no `errorCode`) | Empty body — `"At least one field must be provided"`. |
| `401`  | Missing/invalid access token. |
| `403`  | Not admin (stub). |
| `404` (no `errorCode`) | `Tag '${id}' not found`. |
| `409` (no `errorCode`) | `slug` collision. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Other Prisma error. |

---

## 6. Side effects

| Table / key | Mutation |
|-------------|----------|
| `tags` | UPDATE (the matched row) |
| `tags:all`, `tags:admin:all` | DEL |
| `paths:list:*`, `courses:list:*` | pattern DEL |

No associations are touched. Flipping `status` to `HIDDEN` leaves
`PathTag` / `CourseTag` rows in place; the public paths/courses
lists will just stop filtering the tag in until the status flips
back.

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/tags/admin-tags.controller.ts` | Handler |
| `src/content/tags/tags.service.ts` | `update()` logic |
| `src/content/tags/dto/update-tag.dto.ts` | Request validation |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/tags/tags.service.spec.ts` | Partial update (name only), full update, empty-body rejection, `P2025` → 404, `P2002` → 409, invalidation sequence (mocked cache). |
| `test/content/tags/*.e2e-spec.ts` | Round-trip including the response envelope, empty-body rejection, collision path. |

---

## 9. Things NOT to change without coordination

- The empty-body rejection. Without it, an empty PATCH would do
  nothing but still flush the cache — pointless churn.
- The invalidation sequence. See [admin-create-tag.md §3](./admin-create-tag.md).
- The conditional-spread update pattern. Sending a literal
  `undefined` for a field would clear the column; the spread trick
  is load-bearing.
