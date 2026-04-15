# Admin — List Features — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `GET /api/v1/admin/paths/:ownerId/features`
> - `GET /api/v1/admin/courses/:ownerId/features`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `200 OK`

---

## 1. Summary

Returns every `Feature` row owned by the given path or course,
ordered by `[order ASC, id ASC]`. The endpoint exists in two
parallel shapes (`paths/:ownerId` and `courses/:ownerId`) that
differ only in which `MarketingOwnerType` value the handler
passes to the service. See
[../polymorphic-ownership.md](../polymorphic-ownership.md) for the
shared ownership convention.

This endpoint does **not** cache — admin list reads hit the DB
directly. The public-side equivalent
(`PublicMarketingQueries.getFeaturesByOwner`) is used by
[../../content-discovery/paths/get-path-by-slug.md](../../content-discovery/paths/get-path-by-slug.md) and is cached at the detail level, not here.

---

## 2. Request

```
GET /api/v1/admin/paths/:ownerId/features
GET /api/v1/admin/courses/:ownerId/features
Cookie: access_token=<JWT>
```

- `:ownerId` must be a UUID — enforced by `ParseUUIDPipe`.
- No body, no query parameters.

---

## 3. Behavior — `FeaturesService.listByOwner(ownerType, ownerId)`

Source: `src/content/marketing/features/features.service.ts`
`listByOwner()`.

1. **`OwnerValidator.ensureOwnerExists(ownerType, ownerId)`** —
   throws `NotFoundException(\`Path '...' does not exist\`)` (or
   `Course '...' does not exist`) if the owner is missing.
2. **Read:**
   ```ts
   prisma.feature.findMany({
     where: { ownerType, ownerId },
     orderBy: [{ order: 'asc' }, { id: 'asc' }],
   });
   ```
3. **Map** via `FeatureResponseDto.fromEntity`.

---

## 4. Successful response

```json
{
  "data": [
    { "id": "uuid", "ownerType": "PATH", "ownerId": "uuid", "icon": "shield", "title": "...", "description": "...", "order": 0 },
    { "id": "uuid", "ownerType": "PATH", "ownerId": "uuid", "icon": "bolt",   "title": "...", "description": "...", "order": 1 }
  ],
  "message": "Success"
}
```

Empty owner → `"data": []`.

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | `:ownerId` not a UUID. |
| `401`  | Missing/invalid access token. |
| `403`  | Not admin (once `RolesGuard` is real). |
| `404`  | Owner missing — `Path '...' does not exist` or `Course '...' does not exist`. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |

---

## 6. Side effects

None. Read-only. No cache write.

---

## 7. Cache behavior

This endpoint does not touch the cache on read. Mutations on
features (create / update / reorder / remove) invalidate the
`marketing:features:<type>:<id>` key — see
[../../cache/invalidation-flow.md §4](../../cache/invalidation-flow.md).

---

## 8. Files involved

| File | Role |
|------|------|
| `src/content/marketing/features/admin-features.controller.ts` | Two handlers — `listForPath` and `listForCourse` |
| `src/content/marketing/features/features.service.ts` | `listByOwner()` + `OwnerValidator` call |
| `src/content/marketing/features/dto/feature-response.dto.ts` | `fromEntity` |
| `src/content/marketing/helpers/owner-validator.helper.ts` | `ensureOwnerExists` |

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/features/features.service.spec.ts` | Owner existence check fires, empty-owner case, ordering by `[order, id]`. |
| `test/content/marketing/*.e2e-spec.ts` | HTTP shape, 404 on unknown owner, 401 without cookie. |

---

## 10. Things NOT to change without coordination

- The `[order ASC, id ASC]` ordering. Features have no
  `createdAt` so `id` is the only stable tiebreaker.
- The owner-existence check. Without it, an admin typo returns
  `[]` and looks like success.
- The "two handlers, one service method" pattern. See
  [../polymorphic-ownership.md §1](../polymorphic-ownership.md).
