# Admin — Delete Testimonial — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoint:** `DELETE /api/v1/admin/testimonials/:id`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `204 No Content`

---

## 1. Summary

Deletes a `Testimonial` row by id. Mirrors
[../features/admin-delete-feature.md](../features/admin-delete-feature.md).

---

## 2. Request

```
DELETE /api/v1/admin/testimonials/:id
Cookie: access_token=<JWT>
```

No body. `:id` is a UUID.

---

## 3. Behavior — `TestimonialsService.remove(id)`

Same flow as [../features/admin-delete-feature.md §3](../features/admin-delete-feature.md):

1. `prisma.testimonial.delete({ where: { id } })` — returns the
   deleted row.
2. Read `ownerType`/`ownerId` off the deleted row.
3. `cache.invalidateOwner(scope, ownerId)`.
4. Dormant revalidate.
5. On `P2025` → `NotFoundException(\`Testimonial '${id}' not found\`)`.

---

## 4. Successful response

`204 No Content`, no body.

---

## 5. Error responses

Same set as [../features/admin-delete-feature.md §5](../features/admin-delete-feature.md).

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/testimonials/admin-testimonials.controller.ts` | Handler |
| `src/content/marketing/testimonials/testimonials.service.ts` | `remove` |

---

## 7. Tests

Same shape as [../features/admin-delete-feature.md §8](../features/admin-delete-feature.md)
on `testimonials.service.spec.ts`.

---

## 8. Things NOT to change without coordination

- Delete is **hard** — there is no soft delete, no trash bin.
  If you need undo, implement it in the UI before here.
- Same as [../features/admin-delete-feature.md §9](../features/admin-delete-feature.md).
