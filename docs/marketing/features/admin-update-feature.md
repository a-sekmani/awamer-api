# Admin — Update Feature — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoint:** `PATCH /api/v1/admin/features/:id`
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Patches an existing `Feature` row by id. Every field is optional;
at least one must be present. The service does not require the
`ownerType`/`ownerId` on the request — it reads them off the
existing row to drive cache invalidation.

See [../polymorphic-ownership.md](../polymorphic-ownership.md) for
the shared ownership convention.

---

## 2. Request

```
PATCH /api/v1/admin/features/:id
Content-Type: application/json
Cookie: access_token=<JWT>
```

### Body — `UpdateFeatureDto`
Source: `src/content/marketing/features/dto/update-feature.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `icon` | `string?` | no | `@IsOptional`, `@IsString`, non-empty |
| `title` | `string?` | no | `@IsOptional`, `@IsString`, non-empty |
| `description` | `string?` | no | `@IsOptional`, `@IsString`, non-empty |
| `order` | `number?` | no | `@IsOptional`, `@IsInt`, `@Min(0)` |

Empty body → `BadRequestException('At least one field must be provided')`.

---

## 3. Behavior — `FeaturesService.update(id, dto)`

Source: `src/content/marketing/features/features.service.ts` `update()`.

1. **Empty-body guard.** `Object.keys(dto).length === 0` →
   `BadRequestException('At least one field must be provided')`.
2. **Update:**
   ```ts
   prisma.feature.update({
     where: { id },
     data: { ...only the provided fields },
   });
   ```
   - On `P2025` → `NotFoundException(\`Feature '${id}' not found\`)`.
3. **Invalidate cache** based on the updated row's
   `ownerType`/`ownerId`:
   - `cache.invalidateOwner(scope, updated.ownerId)`.
4. **Revalidate** (dormant) `/paths/<slug>` or `/courses/<slug>`.
5. **Return** `FeatureResponseDto.fromEntity(updated)`.

The conditional-spread update pattern means passing
`description: undefined` is **not** the same as `description: null`
— `undefined` is dropped, `null` would clear the column (and is
rejected by the DTO's `@IsString` anyway).

---

## 4. Successful response

```json
{
  "data": {
    "id": "uuid",
    "ownerType": "PATH",
    "ownerId": "uuid",
    "icon": "updated-icon",
    "title": "...",
    "description": "...",
    "order": 2
  },
  "message": "Success"
}
```

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | DTO rejected. |
| `400`  | `:id` not a UUID. |
| `400`  | Empty body — `"At least one field must be provided"`. |
| `401`  | Missing/invalid access token. |
| `403`  | Not admin. |
| `404`  | `Feature '${id}' not found` (from `P2025`). |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |

---

## 6. Side effects

Same invalidation set as create — see
[admin-create-feature.md §6](./admin-create-feature.md). Only the
DB mutation differs (UPDATE instead of INSERT).

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/marketing/features/admin-features.controller.ts` | `update()` handler |
| `src/content/marketing/features/features.service.ts` | `update()` logic |
| `src/content/marketing/features/dto/update-feature.dto.ts` | Request validation |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/features/features.service.spec.ts` | Partial update, full update, empty-body rejection, `P2025` → 404, invalidation fires with the updated row's scope. |
| `test/content/marketing/*.e2e-spec.ts` | Round-trip including the 400 empty-body and 404 unknown-id cases. |

---

## 9. Things NOT to change without coordination

- The conditional-spread pattern. Sending `undefined` values
  should never clear columns.
- The empty-body rejection.
- Reading `ownerType`/`ownerId` from the updated row (not the
  request). The request does not carry them, and making them
  required would complicate every admin update call.
