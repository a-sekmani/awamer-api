# Contract — Admin FAQs endpoints

**Base**: `/api/v1/admin`
**Auth**: `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
**Envelope**: Standard `{ data, message }` on success; standard error shape on failure.

Path segment `{owner}` is literally `paths` or `courses`.

---

## GET /admin/{owner}/:ownerId/faqs

List all FAQs for an owner, sorted by `order` ASC then `id` ASC.

**Responses**
- `200` — `{ data: FaqResponse[], message }`
- `404` — owner does not exist
- `401` — unauthenticated

---

## POST /admin/{owner}/:ownerId/faqs

**Body** — `CreateFaqDto`
```json
{
  "question": "string (1–300, trimmed)",
  "answer": "string (1–2000, trimmed)",
  "order": 0
}
```
`order` optional → append on omission.

**Responses**
- `201` — `{ data: FaqResponse, message }`
- `400` — validation error
- `404` — owner does not exist
- `401` — unauthenticated

---

## PATCH /admin/faqs/:id

**Body** — `UpdateFaqDto` (partial, at least one field of `question`, `answer`, `order` required)

**Responses**
- `200` — `{ data: FaqResponse, message }`
- `400` — validation / empty body
- `404` — faq not found
- `401` — unauthenticated

---

## PATCH /admin/{owner}/:ownerId/faqs/reorder

**Body** — `ReorderItemsDto` `{ itemIds: string[] }` — set equality with current owner faqs.

**Responses**
- `200` — `{ data: FaqResponse[], message }`
- `400` — list mismatch
- `404` — owner does not exist
- `401` — unauthenticated

Atomic via `prisma.$transaction`.

---

## DELETE /admin/faqs/:id

**Responses**
- `204` — no content
- `404` — faq not found
- `401` — unauthenticated

---

## FaqResponse shape

```json
{
  "id": "uuid",
  "ownerType": "PATH | COURSE",
  "ownerId": "uuid",
  "question": "string",
  "answer": "string",
  "order": 0
}
```
