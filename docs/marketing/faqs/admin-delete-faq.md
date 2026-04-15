# Admin — Delete FAQ — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoint:** `DELETE /api/v1/admin/faqs/:id`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `204 No Content`

---

## 1. Summary

Deletes a `Faq` row by id. Mirrors
[admin-delete-feature.md](../features/admin-delete-feature.md).

---

## 2. Request

```
DELETE /api/v1/admin/faqs/:id
Cookie: access_token=<JWT>
```

No body. `:id` is a UUID.

---

## 3. Behavior — `FaqsService.remove(id)`

Identical to [admin-delete-feature.md §3](../features/admin-delete-feature.md)
with `feature` replaced by `faq`. Reads the deleted row's
`ownerType`/`ownerId` for cache invalidation; `P2025` → 404.

---

## 4. Successful response

`204 No Content`, no body.

---

## 5. Error responses

Identical set to [admin-delete-feature.md §5](../features/admin-delete-feature.md).

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/faqs/admin-faqs.controller.ts` | Handler |
| `src/content/marketing/faqs/faqs.service.ts` | `remove` |

---

## 7. Tests

Same coverage as [admin-delete-feature.md §8](../features/admin-delete-feature.md)
on the `faqs.service.spec.ts` file.

---

## 8. Things NOT to change without coordination

Same as [admin-delete-feature.md §9](../features/admin-delete-feature.md).
