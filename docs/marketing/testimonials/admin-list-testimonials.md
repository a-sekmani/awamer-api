# Admin — List Testimonials — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `GET /api/v1/admin/paths/:ownerId/testimonials`
> - `GET /api/v1/admin/courses/:ownerId/testimonials`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Returns **every** `Testimonial` row owned by the given path or
course — including `PENDING` and `HIDDEN`, unlike the public-side
helper (`PublicMarketingQueries.getApprovedTestimonialsByOwner`
which filters to `APPROVED`). The admin view needs to see
testimonials awaiting moderation.

Ordering: `[order ASC, createdAt ASC]`. See
[../public-marketing-queries.md §2](../public-marketing-queries.md)
for why the tiebreaker differs from features/FAQs.

---

## 2. Request

```
GET /api/v1/admin/paths/:ownerId/testimonials
GET /api/v1/admin/courses/:ownerId/testimonials
Cookie: access_token=<JWT>
```

`:ownerId` must be a UUID.

---

## 3. Behavior — `TestimonialsService.listByOwner(ownerType, ownerId)`

Source: `src/content/marketing/testimonials/testimonials.service.ts`
`listByOwner()`.

1. `OwnerValidator.ensureOwnerExists(ownerType, ownerId)` → 404.
2. `prisma.testimonial.findMany({ where: { ownerType, ownerId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] })`.
3. Map via `TestimonialResponseDto.fromEntity`.

---

## 4. Successful response

```json
{
  "data": [
    {
      "id": "uuid",
      "ownerType": "PATH",
      "ownerId": "uuid",
      "authorName": "A",
      "authorTitle": "Student",
      "avatarUrl": null,
      "content": "...",
      "rating": 5,
      "status": "APPROVED",
      "order": 0,
      "createdAt": "ISO"
    },
    {
      "id": "uuid",
      "status": "PENDING",
      "...": "..."
    }
  ],
  "message": "Success"
}
```

---

## 5. Error responses

Same shape as [../features/admin-list-features.md §5](../features/admin-list-features.md).

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/testimonials/admin-testimonials.controller.ts` | Handlers |
| `src/content/marketing/testimonials/testimonials.service.ts` | `listByOwner` |
| `src/content/marketing/testimonials/dto/testimonial-response.dto.ts` | `fromEntity` |

---

## 7. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/testimonials/testimonials.service.spec.ts` | Ordering by `[order, createdAt]`, includes `PENDING` / `HIDDEN` in the admin result (unlike the public helper), 404 on missing owner. |

---

## 8. Things NOT to change without coordination

- The "include all statuses" behavior. Admins must see
  `PENDING` testimonials to moderate them.
- The `createdAt ASC` tiebreaker. See [../public-marketing-queries.md §2](../public-marketing-queries.md).
