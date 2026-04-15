# Admin — Delete Tag — Backend Spec (awamer-api)

> **Module:** `TagsModule`
> **Endpoint:** `DELETE /api/v1/admin/tags/:id`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `204 No Content`

---

## 1. Summary

Deletes a `Tag` row by id. The `PathTag` and `CourseTag` rows that
reference the tag are removed automatically by the `ON DELETE
CASCADE` declared on both join tables — see [../schema/tag.md](../schema/tag.md).

The cache invalidation sequence is identical to create/update (tag
mutations always affect the paths/courses list filters).

---

## 2. Request

```
DELETE /api/v1/admin/tags/:id
Cookie: access_token=<JWT>
```

No body.

---

## 3. Behavior — `TagsService.remove(id)`

Source: `src/content/tags/tags.service.ts` `remove()`.

1. **Invalidate caches** (same four calls as create/update):
   ```
   del tags:all
   del tags:admin:all
   delByPattern paths:list:*
   delByPattern courses:list:*
   ```
2. **Delete** `prisma.tag.delete({ where: { id } })`.
3. **On `P2025`** → `NotFoundException(\`Tag '${id}' not found\`)`.
4. **On other Prisma errors** → rethrow.
5. Return `void` → controller emits `204 No Content`.

The cascade on the join tables is DB-side; no transaction is needed
in the service code.

---

## 4. Successful response

```
HTTP/1.1 204 No Content
```

No body.

---

## 5. Error responses

| Status | When |
|--------|------|
| `401` | Missing/invalid access token. |
| `403` | Not admin (stub). |
| `404` (no `errorCode`) | `Tag '${id}' not found`. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Other Prisma error. |

---

## 6. Side effects

| Table / key | Mutation |
|-------------|----------|
| `tags` | DELETE (the row) |
| `path_tags` | DELETE (cascade, all rows referencing this tag) |
| `course_tags` | DELETE (cascade, all rows referencing this tag) |
| `tags:all`, `tags:admin:all` | DEL |
| `paths:list:*`, `courses:list:*` | pattern DEL |

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/tags/admin-tags.controller.ts` | Handler, `@HttpCode(204)` |
| `src/content/tags/tags.service.ts` | `remove()` logic |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/tags/tags.service.spec.ts` | Successful delete, `P2025` → 404, invalidation sequence fires, cascade removal of join rows (exercised in the schema spec — see [../schema/tag.md §7](../schema/tag.md)). |
| `test/content/tags/*.e2e-spec.ts` | 204 on success, 404 on unknown id, subsequent `GET /tags` no longer includes the deleted tag. |

---

## 9. Things NOT to change without coordination

- The cascade on `PathTag` / `CourseTag`. Removing it would require
  the service to explicitly delete join rows; the DB-side cascade
  is both faster and more correct.
- The `@HttpCode(204)` on the handler. The frontend and every e2e
  spec assert on the status.
- The invalidation sequence — same reasoning as create/update.
- The "no confirmation step" behavior. If a delete is too easy to
  trigger, that is a frontend concern; do not add a backend-side
  two-step delete.
