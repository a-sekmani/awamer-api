# Admin — Create FAQ — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `POST /api/v1/admin/paths/:ownerId/faqs`
> - `POST /api/v1/admin/courses/:ownerId/faqs`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `201 Created`

---

## 1. Summary

Creates a new `Faq` row attached to the given path or course.
Mirrors [admin-create-feature.md](../features/admin-create-feature.md)
with the DTO swapped. See
[../polymorphic-ownership.md](../polymorphic-ownership.md).

---

## 2. Request

### Body — `CreateFaqDto`
Source: `src/content/marketing/faqs/dto/create-faq.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `question` | `string` | yes | `@IsString`, non-empty |
| `answer` | `string` | yes | `@IsString`, non-empty |
| `order` | `number?` | no | `@IsOptional`, `@IsInt`, `@Min(0)` — defaults to next |

---

## 3. Behavior — `FaqsService.create(ownerType, ownerId, dto)`

Same flow as [admin-create-feature.md §3](../features/admin-create-feature.md):

1. `OwnerValidator.ensureOwnerExists` → 404 on missing.
2. `nextOrder` on missing `dto.order`.
3. `prisma.faq.create(...)`.
4. `cache.invalidateOwner(scope, ownerId)`.
5. `cache.slugFor(...)` + dormant revalidate.
6. Return `FaqResponseDto.fromEntity(created)`.

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
    "question": "What do I need to know?",
    "answer": "Nothing!",
    "order": 0
  },
  "message": "Success"
}
```

---

## 5. Error responses

Identical to [admin-create-feature.md §5](../features/admin-create-feature.md).

---

## 6. Side effects

Same invalidation set as
[admin-create-feature.md §6](../features/admin-create-feature.md),
but the DB insert is on `faqs` instead of `features`.

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/marketing/faqs/admin-faqs.controller.ts` | Handlers |
| `src/content/marketing/faqs/faqs.service.ts` | `create`, `nextOrder` |
| `src/content/marketing/faqs/dto/create-faq.dto.ts` | Validation |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/faqs/faqs.service.spec.ts` | Happy paths, `nextOrder`, cache invalidation, dormant revalidate. |
| `test/content/marketing/*.e2e-spec.ts` | HTTP round-trip. |

---

## 9. Things NOT to change without coordination

Same as [admin-create-feature.md §9](../features/admin-create-feature.md).
