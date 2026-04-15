# Admin — List FAQs — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `GET /api/v1/admin/paths/:ownerId/faqs`
> - `GET /api/v1/admin/courses/:ownerId/faqs`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Returns every `Faq` row owned by the given path or course,
ordered by `[order ASC, id ASC]`. Mirrors
[admin-list-features.md](../features/admin-list-features.md)
with `Feature` replaced by `Faq` throughout.

See [../polymorphic-ownership.md](../polymorphic-ownership.md) for
the shared ownership convention.

---

## 2. Request

```
GET /api/v1/admin/paths/:ownerId/faqs
GET /api/v1/admin/courses/:ownerId/faqs
Cookie: access_token=<JWT>
```

`:ownerId` must be a UUID — `ParseUUIDPipe`.

---

## 3. Behavior — `FaqsService.listByOwner(ownerType, ownerId)`

Source: `src/content/marketing/faqs/faqs.service.ts` `listByOwner()`.

1. `OwnerValidator.ensureOwnerExists(ownerType, ownerId)` — 404 on missing owner.
2. `prisma.faq.findMany({ where: { ownerType, ownerId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] })`.
3. Map via `FaqResponseDto.fromEntity`.

No cache read.

---

## 4. Successful response

```json
{
  "data": [
    { "id": "uuid", "ownerType": "PATH", "ownerId": "uuid", "question": "...", "answer": "...", "order": 0 },
    { "id": "uuid", "ownerType": "PATH", "ownerId": "uuid", "question": "...", "answer": "...", "order": 1 }
  ],
  "message": "Success"
}
```

---

## 5. Error responses

Identical to [admin-list-features.md §5](../features/admin-list-features.md).

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/faqs/admin-faqs.controller.ts` | Handlers |
| `src/content/marketing/faqs/faqs.service.ts` | `listByOwner` |
| `src/content/marketing/faqs/dto/faq-response.dto.ts` | `fromEntity` |

---

## 7. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/faqs/faqs.service.spec.ts` | Ordering, empty-owner, owner-existence check. |
| `test/content/marketing/*.e2e-spec.ts` | End-to-end shape. |

---

## 8. Things NOT to change without coordination

Same as [admin-list-features.md §10](../features/admin-list-features.md).
