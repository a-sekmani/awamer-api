# Contract — Admin Testimonials endpoints

**Base**: `/api/v1/admin`
**Auth**: `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
**Envelope**: Standard `{ data, message }` on success; standard error shape on failure.

Path segment `{owner}` is literally `paths` or `courses`. Only admins hit these endpoints; no public submission flow exists in this feature.

---

## GET /admin/{owner}/:ownerId/testimonials

List ALL testimonials for an owner, regardless of status (admins moderate Pending and Hidden items here). Sorted by `order` ASC then `createdAt` ASC.

**Responses**
- `200` — `{ data: TestimonialResponse[], message }`
- `404` — owner does not exist
- `401` — unauthenticated

---

## POST /admin/{owner}/:ownerId/testimonials

Create a testimonial. `status` is **always** set to `PENDING` server-side; any client-supplied status is ignored (the DTO does not include it).

**Body** — `CreateTestimonialDto`
```json
{
  "authorName": "string (1–100, trimmed)",
  "authorTitle": "string (1–100, trimmed) | null",
  "avatarUrl": "https://... (valid URL) | null",
  "content": "string (1–1000, trimmed)",
  "rating": 5,
  "order": 0
}
```
`authorTitle`, `avatarUrl`, `rating`, `order` are optional. `rating` is an integer 1–5 when provided. `order` → append on omission.

**Responses**
- `201` — `{ data: TestimonialResponse, message }` with `status: "PENDING"`
- `400` — validation (rating out of range, invalid URL, empty required field)
- `404` — owner does not exist
- `401` — unauthenticated

---

## PATCH /admin/testimonials/:id

Update any subset of editable fields (everything except `status`). At least one field required.

**Body** — `UpdateTestimonialDto` (partial of create, all optional, at least one required, **no `status`**)

**Responses**
- `200` — `{ data: TestimonialResponse, message }`
- `400` — validation / empty body
- `404` — testimonial not found
- `401` — unauthenticated

---

## PATCH /admin/testimonials/:id/status

Moderation-only endpoint. Transitions between any pair of `PENDING`, `APPROVED`, `HIDDEN`.

**Body** — `UpdateTestimonialStatusDto`
```json
{ "status": "APPROVED" }
```

**Responses**
- `200` — `{ data: TestimonialResponse, message }`
- `400` — invalid enum value
- `404` — testimonial not found
- `401` — unauthenticated

---

## PATCH /admin/{owner}/:ownerId/testimonials/reorder

**Body** — `ReorderItemsDto` `{ itemIds: string[] }` — set equality with current owner testimonials (any status).

**Responses**
- `200` — `{ data: TestimonialResponse[], message }`
- `400` — list mismatch
- `404` — owner does not exist
- `401` — unauthenticated

---

## DELETE /admin/testimonials/:id

**Responses**
- `204` — no content
- `404` — testimonial not found
- `401` — unauthenticated

---

## TestimonialResponse shape

```json
{
  "id": "uuid",
  "ownerType": "PATH | COURSE",
  "ownerId": "uuid",
  "authorName": "string",
  "authorTitle": "string | null",
  "avatarUrl": "string | null",
  "content": "string",
  "rating": 5,
  "status": "PENDING | APPROVED | HIDDEN",
  "order": 0,
  "createdAt": "2026-04-14T12:00:00.000Z"
}
```
