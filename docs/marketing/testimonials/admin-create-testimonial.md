# Admin — Create Testimonial — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `POST /api/v1/admin/paths/:ownerId/testimonials`
> - `POST /api/v1/admin/courses/:ownerId/testimonials`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `201 Created`

---

## 1. Summary

Creates a new `Testimonial` row. Default `status` is `PENDING` at
the schema level — see
[../../schema/marketing-content.md §4](../../schema/marketing-content.md).
Admins use the `updateStatus` endpoint to approve or hide the row
once created. See
[../polymorphic-ownership.md](../polymorphic-ownership.md).

---

## 2. Request

### Body — `CreateTestimonialDto`
Source: `src/content/marketing/testimonials/dto/create-testimonial.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `authorName` | `string` | yes | `@IsString`, non-empty |
| `authorTitle` | `string?` | no | `@IsOptional`, `@IsString` |
| `avatarUrl` | `string?` | no | `@IsOptional`, `@IsString` (URL format not enforced at DTO level) |
| `content` | `string` | yes | `@IsString`, non-empty |
| `rating` | `number?` | no | `@IsOptional`, `@IsInt`, `@Min(1)`, `@Max(5)` |
| `order` | `number?` | no | `@IsOptional`, `@IsInt`, `@Min(0)` — defaults to next |

Note: `status` is **not** on the create DTO. New testimonials
always land in `PENDING` and must be explicitly approved via
`updateStatus`.

---

## 3. Behavior — `TestimonialsService.create(ownerType, ownerId, dto)`

Same shape as [../features/admin-create-feature.md §3](../features/admin-create-feature.md):

1. `OwnerValidator.ensureOwnerExists` → 404.
2. `nextOrder(ownerType, ownerId)` for the `order` default.
3. `prisma.testimonial.create({ data: { ... status: PENDING } })`.
4. `cache.invalidateOwner(scope, ownerId)`.
5. Dormant `revalidationHelper.revalidatePath(...)`.
6. Return `TestimonialResponseDto.fromEntity(created)`.

---

## 4. Successful response

```
HTTP/1.1 201 Created
```

```json
{
  "data": {
    "id": "uuid",
    "ownerType": "PATH",
    "ownerId": "uuid",
    "authorName": "Ahmad Sekmani",
    "authorTitle": "Engineer",
    "avatarUrl": null,
    "content": "...",
    "rating": 5,
    "status": "PENDING",
    "order": 0,
    "createdAt": "ISO"
  },
  "message": "Success"
}
```

`status` is always `PENDING` on the create response.

---

## 5. Error responses

Same set as [../features/admin-create-feature.md §5](../features/admin-create-feature.md).
Adds: `400 VALIDATION_FAILED` for `rating` outside `[1, 5]`.

---

## 6. Side effects

Same invalidation set as features. DB insert on `testimonials`.

---

## 7. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/testimonials/testimonials.service.spec.ts` | Default `PENDING`, `rating` range enforcement, `nextOrder`, invalidation. |

---

## 8. Things NOT to change without coordination

- The `PENDING` default. Flipping new testimonials to
  `APPROVED` automatically bypasses the moderation step.
- Omitting `status` from the create DTO. Allowing the client to
  pass `status: APPROVED` at creation time would bypass
  moderation.
- The `[1, 5]` `rating` range. The frontend renders stars based
  on this bound.
