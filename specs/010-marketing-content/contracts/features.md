# Contract — Admin Features endpoints

**Base**: `/api/v1/admin`
**Auth**: `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
**Envelope**: Standard `{ data, message }` on success; standard error shape on failure.

Path segments `{owner}` are literally `paths` or `courses`. Controller maps each to the matching `MarketingOwnerType`.

---

## GET /admin/{owner}/:ownerId/features

List all features for an owner, sorted by `order` ASC then `id` ASC.

**Params**
- `owner` — `paths` | `courses`
- `ownerId` — UUID

**Responses**
- `200` — `{ data: FeatureResponse[], message: "Success" }` (empty array when none)
- `404` — owner does not exist
- `401` — unauthenticated

---

## POST /admin/{owner}/:ownerId/features

Create a feature under the owner. If `order` is omitted, the service appends (max existing + 1, or 0 when empty).

**Body** — `CreateFeatureDto`
```json
{
  "icon": "string (non-empty)",
  "title": "string (1–150, trimmed)",
  "description": "string (1–500, trimmed)",
  "order": 5
}
```

**Responses**
- `201` — `{ data: FeatureResponse, message: "Success" }`
- `400` — validation error
- `404` — owner does not exist
- `401` — unauthenticated

---

## PATCH /admin/features/:id

Update a subset of fields. At least one of `icon`, `title`, `description`, `order` must be present.

**Body** — `UpdateFeatureDto` (partial of create, all fields optional, at least one required)

**Responses**
- `200` — `{ data: FeatureResponse, message: "Success" }`
- `400` — validation error / empty body
- `404` — feature not found
- `401` — unauthenticated

Update does NOT change owner. Attempts to include `ownerType`/`ownerId` are stripped by the global `ValidationPipe({ whitelist: true })`.

---

## PATCH /admin/{owner}/:ownerId/features/reorder

Atomically reorder every feature under the owner. `itemIds` MUST be the exact set of the owner's current feature ids, in desired order.

**Body** — `ReorderItemsDto`
```json
{ "itemIds": ["uuid-a", "uuid-b", "uuid-c"] }
```

**Responses**
- `200` — `{ data: FeatureResponse[], message: "Success" }` (freshly re-sorted list)
- `400` — list has duplicates / missing ids / foreign ids
- `404` — owner does not exist
- `401` — unauthenticated

Atomic: either all `order` values are updated or none are.

---

## DELETE /admin/features/:id

Delete a feature.

**Responses**
- `204` — no content
- `404` — feature not found
- `401` — unauthenticated

---

## FeatureResponse shape

```json
{
  "id": "uuid",
  "ownerType": "PATH | COURSE",
  "ownerId": "uuid",
  "icon": "string",
  "title": "string",
  "description": "string",
  "order": 0
}
```
