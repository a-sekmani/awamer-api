# Admin — Reorder Testimonials — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `PATCH /api/v1/admin/paths/:ownerId/testimonials/reorder`
> - `PATCH /api/v1/admin/courses/:ownerId/testimonials/reorder`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Atomically reorders the `Testimonial` rows owned by the given
path/course. Mirrors
[../features/admin-reorder-features.md](../features/admin-reorder-features.md)
with `'testimonial'` passed to `ReorderHelper.reorder`.

The reorder includes testimonials of **every status** — PENDING
and HIDDEN rows participate in the ordering alongside APPROVED
ones. This is intentional: the admin UI shows all statuses, and
reordering should match what the admin sees.

---

## 2. Request

### Body — `ReorderItemsDto`
Source: `src/content/marketing/testimonials/dto/reorder-items.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `itemIds` | `string[]` | yes | `@IsArray`, `@ArrayMinSize(1)`, `@IsUUID('4', { each: true })` |

---

## 3. Behavior — `TestimonialsService.reorder(ownerType, ownerId, itemIds)`

Same five-step flow as the features/faqs reorder endpoints:

1. `OwnerValidator.ensureOwnerExists`.
2. `ReorderHelper.reorder('testimonial', ...)`.
3. `cache.invalidateOwner`.
4. Dormant revalidate.
5. Return `listByOwner(ownerType, ownerId)`.

The returned array is ordered by the new `order`, with the
admin-side tiebreaker `[order ASC, createdAt ASC]`.

---

## 4. Successful response

Array of `TestimonialResponseDto`, sorted by the new `order`,
including all statuses.

---

## 5. Error responses

Same set as [../features/admin-reorder-features.md §5](../features/admin-reorder-features.md).

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/testimonials/admin-testimonials.controller.ts` | Handlers |
| `src/content/marketing/testimonials/testimonials.service.ts` | `reorder` glue |
| `src/content/marketing/helpers/reorder.helper.ts` | Shared algorithm |

---

## 7. Tests

Covered by [../reorder-helper.md §5](../reorder-helper.md) and
`testimonials.service.spec.ts`.

---

## 8. Things NOT to change without coordination

- Including PENDING/HIDDEN testimonials in the reorder set.
  Filtering them out would let the admin reorder "only the
  approved ones" and leave gaps the set-equality check would
  reject.
- Same list as [../features/admin-reorder-features.md §9](../features/admin-reorder-features.md).
