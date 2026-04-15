# Admin — Update FAQ — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoint:** `PATCH /api/v1/admin/faqs/:id`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Patches an existing `Faq` row. Mirrors
[admin-update-feature.md](../features/admin-update-feature.md)
with the DTO swapped.

---

## 2. Request

### Body — `UpdateFaqDto`
Source: `src/content/marketing/faqs/dto/update-faq.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `question` | `string?` | no | `@IsOptional`, `@IsString`, non-empty |
| `answer` | `string?` | no | `@IsOptional`, `@IsString`, non-empty |
| `order` | `number?` | no | `@IsOptional`, `@IsInt`, `@Min(0)` |

Empty body → `BadRequestException('At least one field must be provided')`.

---

## 3. Behavior — `FaqsService.update(id, dto)`

Same flow as [admin-update-feature.md §3](../features/admin-update-feature.md).
Conditional-spread update, `P2025` → 404, read updated row's
`ownerType`/`ownerId` to drive cache invalidation.

---

## 4. Successful response

```json
{
  "data": {
    "id": "uuid",
    "ownerType": "PATH",
    "ownerId": "uuid",
    "question": "...",
    "answer": "...",
    "order": 1
  },
  "message": "Success"
}
```

---

## 5. Error responses

Identical to [admin-update-feature.md §5](../features/admin-update-feature.md).

---

## 6. Side effects

Same invalidation set. DB mutation is `UPDATE faqs`.

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/marketing/faqs/admin-faqs.controller.ts` | Handler |
| `src/content/marketing/faqs/faqs.service.ts` | `update` |
| `src/content/marketing/faqs/dto/update-faq.dto.ts` | Validation |

---

## 8. Tests

Same as [admin-update-feature.md §8](../features/admin-update-feature.md).

---

## 9. Things NOT to change without coordination

Same as [admin-update-feature.md §9](../features/admin-update-feature.md).
