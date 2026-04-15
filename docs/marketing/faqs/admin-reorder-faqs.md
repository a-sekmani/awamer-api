# Admin — Reorder FAQs — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `PATCH /api/v1/admin/paths/:ownerId/faqs/reorder`
> - `PATCH /api/v1/admin/courses/:ownerId/faqs/reorder`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Atomically reorders the `Faq` rows owned by the given path/course
to match a client-provided id list. Mirrors
[admin-reorder-features.md](../features/admin-reorder-features.md)
with `'feature'` replaced by `'faq'` in the
`ReorderHelper.reorder` call.

See [../reorder-helper.md](../reorder-helper.md).

---

## 2. Request

### Body — `ReorderItemsDto`
Source: `src/content/marketing/faqs/dto/reorder-items.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `itemIds` | `string[]` | yes | `@IsArray`, `@ArrayMinSize(1)`, `@IsUUID('4', { each: true })` |

---

## 3. Behavior — `FaqsService.reorder(ownerType, ownerId, itemIds)`

Same five-step flow as [admin-reorder-features.md §3](../features/admin-reorder-features.md):

1. `OwnerValidator.ensureOwnerExists` → 404.
2. `ReorderHelper.reorder('faq', ...)`.
3. `cache.invalidateOwner`.
4. Dormant revalidate.
5. Return `listByOwner(ownerType, ownerId)`.

---

## 4. Successful response

Array of `FaqResponseDto`, sorted by the newly-assigned `order`.

---

## 5. Error responses

Identical set to [admin-reorder-features.md §5](../features/admin-reorder-features.md).

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/faqs/admin-faqs.controller.ts` | Handlers |
| `src/content/marketing/faqs/faqs.service.ts` | `reorder` glue |
| `src/content/marketing/helpers/reorder.helper.ts` | Shared algorithm |

---

## 7. Tests

Covered by [../reorder-helper.md §5](../reorder-helper.md) and
`src/content/marketing/faqs/faqs.service.spec.ts`.

---

## 8. Things NOT to change without coordination

Same as [admin-reorder-features.md §9](../features/admin-reorder-features.md).
