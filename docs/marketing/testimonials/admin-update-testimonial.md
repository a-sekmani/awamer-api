# Admin — Update Testimonial — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoint:** `PATCH /api/v1/admin/testimonials/:id`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Patches an existing `Testimonial` row's **content fields** —
`authorName`, `authorTitle`, `avatarUrl`, `content`, `rating`,
`order`. Status transitions are **separate** — see
[admin-update-testimonial-status.md](./admin-update-testimonial-status.md).

Mirrors [../features/admin-update-feature.md](../features/admin-update-feature.md).

---

## 2. Request

### Body — `UpdateTestimonialDto`
Source: `src/content/marketing/testimonials/dto/update-testimonial.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `authorName` | `string?` | no | `@IsOptional`, `@IsString`, non-empty |
| `authorTitle` | `string?` | no | `@IsOptional`, `@IsString` |
| `avatarUrl` | `string?` | no | `@IsOptional`, `@IsString` |
| `content` | `string?` | no | `@IsOptional`, `@IsString`, non-empty |
| `rating` | `number?` | no | `@IsOptional`, `@IsInt`, `@Min(1)`, `@Max(5)` |
| `order` | `number?` | no | `@IsOptional`, `@IsInt`, `@Min(0)` |

`status` is **not** on this DTO. Empty body →
`BadRequestException('At least one field must be provided')`.

---

## 3. Behavior — `TestimonialsService.update(id, dto)`

Same flow as [../features/admin-update-feature.md §3](../features/admin-update-feature.md):

1. Empty-body guard.
2. Conditional-spread `prisma.testimonial.update(...)`. `P2025` → 404.
3. `cache.invalidateOwner(scope, updated.ownerId)`.
4. Dormant revalidate.
5. Return `TestimonialResponseDto.fromEntity(updated)`.

The update does **not** reset `status` — a row that was
`APPROVED` stays `APPROVED` after a content edit.

---

## 4. Successful response

Same envelope as [admin-list-testimonials.md §4](./admin-list-testimonials.md)
single row shape.

---

## 5. Error responses

Identical to [../features/admin-update-feature.md §5](../features/admin-update-feature.md),
plus `400 VALIDATION_FAILED` for `rating` outside `[1, 5]`.

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/testimonials/admin-testimonials.controller.ts` | `update` handler |
| `src/content/marketing/testimonials/testimonials.service.ts` | `update` |
| `src/content/marketing/testimonials/dto/update-testimonial.dto.ts` | Validation |

---

## 7. Tests

Same shape as [../features/admin-update-feature.md §8](../features/admin-update-feature.md)
on `testimonials.service.spec.ts`.

---

## 8. Things NOT to change without coordination

- The split between content edits (this endpoint) and status
  transitions
  ([admin-update-testimonial-status.md](./admin-update-testimonial-status.md)).
  Merging them would let an edit-by-mistake approve a
  testimonial silently.
- The "status preserved across content edits" behavior. See §3.
