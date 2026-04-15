# Admin — Delete Feature — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoint:** `DELETE /api/v1/admin/features/:id`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `204 No Content`

---

## 1. Summary

Deletes a `Feature` row by id. The service reads the row (via
`prisma.feature.delete` which returns the deleted row) so it
can invalidate the right owner's cache after the write.

See [../polymorphic-ownership.md](../polymorphic-ownership.md).

---

## 2. Request

```
DELETE /api/v1/admin/features/:id
Cookie: access_token=<JWT>
```

No body. `:id` must be a UUID (`ParseUUIDPipe`).

---

## 3. Behavior — `FeaturesService.remove(id)`

Source: `src/content/marketing/features/features.service.ts` `remove()`.

```ts
try {
  const deleted = await this.prisma.feature.delete({ where: { id } });
  const scope = deleted.ownerType === 'PATH' ? 'path' : 'course';
  await this.cache.invalidateOwner(scope, deleted.ownerId);
  const slug = await this.cache.slugFor(scope, deleted.ownerId);
  if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
} catch (err) {
  if (P2025) throw new NotFoundException(`Feature '${id}' not found`);
  throw err;
}
```

- `prisma.delete` returns the deleted row, which carries
  `ownerType` and `ownerId` — they are used to compute the cache
  scope after the write.
- `P2025` → 404.

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
| `400 VALIDATION_FAILED` | `:id` not a UUID. |
| `401`  | Missing/invalid access token. |
| `403`  | Not admin. |
| `404`  | `Feature '${id}' not found`. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |

---

## 6. Side effects

| Table / key | Mutation |
|-------------|----------|
| `features` | DELETE |
| Owner's marketing + detail/list cache keys | DEL / pattern DEL via `invalidateOwner` |

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/marketing/features/admin-features.controller.ts` | `remove()` handler + `@HttpCode(204)` |
| `src/content/marketing/features/features.service.ts` | `remove()` logic |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/features/features.service.spec.ts` | Happy-path delete, `P2025` → 404, cache invalidation fires with the deleted row's scope (not a pre-read). |
| `test/content/marketing/*.e2e-spec.ts` | 204 on success, 404 on unknown id. |

---

## 9. Things NOT to change without coordination

- Reading `ownerType`/`ownerId` from the **delete result**
  (which Prisma returns). An alternative would be a pre-read
  `findUnique` followed by `delete`, but that is two queries
  and racier.
- The `@HttpCode(204)` on the handler. Tests assert on the
  status.
- Gap in the reorder after delete: deleting an item leaves the
  remaining items with their original `order` values, which is
  fine because `[order, id]` is the sort key. The admin UI can
  call `reorder` if it wants a dense sequence.
