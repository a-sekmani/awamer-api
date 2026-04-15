# Admin — Update Testimonial Status — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoint:** `PATCH /api/v1/admin/testimonials/:id/status`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Changes a testimonial's lifecycle status between `PENDING`,
`APPROVED`, and `HIDDEN`. This is the only way a testimonial
can become visible on the public path/course page — new
testimonials are created with `status: PENDING` and must be
explicitly approved here.

A separate endpoint (not the general `PATCH /testimonials/:id`)
because moderation is an audit-worthy action and the split
prevents a content edit from silently flipping status.

---

## 2. Request

```
PATCH /api/v1/admin/testimonials/:id/status
Content-Type: application/json
Cookie: access_token=<JWT>
```

### Body — `UpdateTestimonialStatusDto`
Source: `src/content/marketing/testimonials/dto/update-testimonial-status.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `status` | `TestimonialStatus` | yes | `@IsEnum(TestimonialStatus)` — `PENDING`, `APPROVED`, or `HIDDEN` |

### Example

```json
{ "status": "APPROVED" }
```

---

## 3. Behavior — `TestimonialsService.updateStatus(id, dto)`

Same shape as `update` but writes only the `status` column:

1. `prisma.testimonial.update({ where: { id }, data: { status: dto.status } })`.
   - `P2025` → `NotFoundException(\`Testimonial '${id}' not found\`)`.
2. `cache.invalidateOwner(scope, updated.ownerId)`.
3. Dormant `revalidationHelper.revalidatePath(...)`.
4. Return `TestimonialResponseDto.fromEntity(updated)`.

No transition validation is enforced at the service layer: the
current code accepts any `PENDING → APPROVED → HIDDEN →
APPROVED → PENDING` move. The frontend may present a restricted
UI, but the backend accepts all 3×3 pairs (including no-op
`A → A`).

---

## 4. Successful response

Same shape as [admin-list-testimonials.md §4](./admin-list-testimonials.md)
single row.

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | `status` missing or not in the enum. |
| `400`  | `:id` not a UUID. |
| `401`  | Missing/invalid access token. |
| `403`  | Not admin. |
| `404`  | `Testimonial '${id}' not found`. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |

---

## 6. Side effects

| Table / key | Mutation |
|-------------|----------|
| `testimonials` | UPDATE (status only) |
| Owner's marketing + detail/list cache keys | DEL / pattern DEL via `invalidateOwner` |

A `PENDING → APPROVED` transition causes the next read of the
public path/course page to surface the testimonial. A `APPROVED
→ HIDDEN` transition causes the reverse.

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/marketing/testimonials/admin-testimonials.controller.ts` | `updateStatus` handler |
| `src/content/marketing/testimonials/testimonials.service.ts` | `updateStatus` |
| `src/content/marketing/testimonials/dto/update-testimonial-status.dto.ts` | Enum-only DTO |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/testimonials/testimonials.service.spec.ts` | Transition from every start state to every end state (9 combinations), `P2025` → 404, cache invalidation fires, no-op `A → A` is a no-throw update. |

---

## 9. Things NOT to change without coordination

- The "separate endpoint from content edit" design. Merging
  would make moderation less auditable.
- The permissive "any transition" behavior. A state machine
  would need coordinated frontend work.
- The `APPROVED` filter on `PublicMarketingQueries.getApprovedTestimonialsByOwner`.
  Without it, pending / hidden rows would leak to the public.
