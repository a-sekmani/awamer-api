# Admin — Reorder Features — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `PATCH /api/v1/admin/paths/:ownerId/features/reorder`
> - `PATCH /api/v1/admin/courses/:ownerId/features/reorder`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Atomically reassigns the `order` column for every `Feature` row
owned by the given path/course, based on a client-provided array
of ids. The client sends the full list in the new order; the
service validates set equality (every owned id must be present,
no extras, no duplicates) and then runs the updates in a single
transaction.

See [../reorder-helper.md](../reorder-helper.md) for the shared
algorithm and the full validation rules.

---

## 2. Request

```
PATCH /api/v1/admin/paths/:ownerId/features/reorder
PATCH /api/v1/admin/courses/:ownerId/features/reorder
Content-Type: application/json
Cookie: access_token=<JWT>
```

### Body — `ReorderItemsDto`
Source: `src/content/marketing/features/dto/reorder-items.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `itemIds` | `string[]` | yes | `@IsArray`, `@ArrayMinSize(1)`, `@IsUUID('4', { each: true })` |

### Example

```json
{ "itemIds": ["uuid-c", "uuid-a", "uuid-b"] }
```

---

## 3. Behavior — `FeaturesService.reorder(ownerType, ownerId, itemIds)`

Source: `src/content/marketing/features/features.service.ts` `reorder()`.

1. **`OwnerValidator.ensureOwnerExists(ownerType, ownerId)`** →
   404 on missing owner.
2. **`ReorderHelper.reorder('feature', ownerType, ownerId, itemIds)`** —
   see [../reorder-helper.md](../reorder-helper.md) for the full
   breakdown. In short: dedupe check, set equality check against
   the current owner ids, atomic transaction that assigns
   `order: 0..n-1` in the client-provided order.
3. **Invalidate cache** via `cache.invalidateOwner(scope, ownerId)`.
4. **Revalidate** (dormant) `/paths/<slug>` or `/courses/<slug>`.
5. **Return** `listByOwner(ownerType, ownerId)` — the fresh,
   ordered list is read back and returned so the admin UI does
   not have to make a second call.

---

## 4. Successful response

```json
{
  "data": [
    { "id": "uuid-c", "order": 0, "title": "...", "icon": "...", "description": "...", "ownerType": "PATH", "ownerId": "..." },
    { "id": "uuid-a", "order": 1, "title": "...", "icon": "...", "description": "...", "ownerType": "PATH", "ownerId": "..." },
    { "id": "uuid-b", "order": 2, "title": "...", "icon": "...", "description": "...", "ownerType": "PATH", "ownerId": "..." }
  ],
  "message": "Success"
}
```

The array is sorted by `order ASC` — the newly-assigned order.

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | DTO rejected (empty array, non-UUID ids, unknown field). |
| `400`  | Duplicate id — `"Reorder list contains duplicate id 'X'"`. |
| `400`  | Extra id — `"Reorder list contains id 'X' which does not belong to this owner"`. |
| `400`  | Missing id — `"Reorder list is missing id 'X' which belongs to this owner"`. |
| `400`  | Size mismatch — `"Reorder list size mismatch: owner has N items but request provided M"`. |
| `401`  | Missing/invalid access token. |
| `403`  | Not admin. |
| `404`  | Owner missing. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |

---

## 6. Side effects

| Table / key | Mutation |
|-------------|----------|
| `features` | UPDATE × N (one per provided id, inside a single transaction) |
| All marketing + detail/list cache keys for the owner's scope | DEL / pattern DEL via `invalidateOwner` |

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/marketing/features/admin-features.controller.ts` | `reorderForPath`, `reorderForCourse` handlers |
| `src/content/marketing/features/features.service.ts` | `reorder()` glue |
| `src/content/marketing/helpers/reorder.helper.ts` | The shared atomic reorder + validation |
| `src/content/marketing/features/dto/reorder-items.dto.ts` | `itemIds` array validation |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/helpers/reorder.helper.spec.ts` | Every validation branch — see [../reorder-helper.md §5](../reorder-helper.md). |
| `src/content/marketing/features/features.service.spec.ts` | `reorder` glue calls `OwnerValidator`, `ReorderHelper`, `invalidateOwner`, and returns the fresh list. |
| `test/content/marketing/*.e2e-spec.ts` | End-to-end reorder + re-read, error shapes for every 400 branch. |

---

## 9. Things NOT to change without coordination

- The "full list required" contract. Partial reorder would
  need a completely different validation strategy.
- The set-equality validation. See [../reorder-helper.md §2.2](../reorder-helper.md).
- The atomic transaction. A non-transactional loop would leak
  a partially-reordered state.
- The re-read at the end. The admin UI depends on the returned
  list matching the new order exactly.
