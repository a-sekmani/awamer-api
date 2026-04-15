# Admin — Create Feature — Backend Spec (awamer-api)

> **Module:** `MarketingModule`
> **Endpoints:**
> - `POST /api/v1/admin/paths/:ownerId/features`
> - `POST /api/v1/admin/courses/:ownerId/features`
>
> **Guards:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
> **Status code:** `201 Created`

---

## 1. Summary

Creates a new `Feature` row attached to the given path or course.
If the caller omits `order`, the service assigns it via a private
`nextOrder(ownerType, ownerId)` helper (max-existing + 1), so new
features land at the end of the list. After the write, the
ownership cache is invalidated and the dormant ISR revalidation
helper is nudged.

See [../polymorphic-ownership.md](../polymorphic-ownership.md)
for the shared ownership convention and the cache-invalidation
shape.

---

## 2. Request

```
POST /api/v1/admin/paths/:ownerId/features
POST /api/v1/admin/courses/:ownerId/features
Content-Type: application/json
Cookie: access_token=<JWT>
```

### Body — `CreateFeatureDto`

Source: `src/content/marketing/features/dto/create-feature.dto.ts`.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `icon` | `string` | yes | `@IsString`, non-empty |
| `title` | `string` | yes | `@IsString`, non-empty |
| `description` | `string` | yes | `@IsString`, non-empty |
| `order` | `number?` | no | `@IsOptional`, `@IsInt`, `@Min(0)` — defaults to "next" |

Unknown fields are rejected by the global `ValidationPipe`
(`forbidNonWhitelisted`).

---

## 3. Behavior — `FeaturesService.create(ownerType, ownerId, dto)`

Source: `src/content/marketing/features/features.service.ts`
`create()`.

1. **`OwnerValidator.ensureOwnerExists(ownerType, ownerId)`** →
   404 if missing.
2. **Resolve `order`:**
   - If `dto.order` is provided, use it.
   - Otherwise, `nextOrder(ownerType, ownerId)` reads the highest
     existing `order` and returns `+1` (or `0` for an empty
     owner).
3. **Insert:**
   ```ts
   prisma.feature.create({
     data: {
       ownerType, ownerId,
       icon: dto.icon,
       title: dto.title,
       description: dto.description,
       order,
     },
   });
   ```
4. **Invalidate cache:**
   - `cache.invalidateOwner(scope, ownerId)` where `scope` is
     `'path'` or `'course'`.
5. **Revalidate (dormant):**
   - `cache.slugFor(scope, ownerId)` — single lookup.
   - If a slug comes back,
     `revalidationHelper.revalidatePath('/paths/<slug>')` or
     `'/courses/<slug>'`. Dormant unless `FRONTEND_REVALIDATE_SECRET`
     is set — see
     [../../cache/revalidation-helper.md](../../cache/revalidation-helper.md).
6. **Return** `FeatureResponseDto.fromEntity(created)`.

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
    "icon": "shield",
    "title": "Secure by design",
    "description": "...",
    "order": 0
  },
  "message": "Success"
}
```

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | DTO rejected (missing required field, unknown field, negative `order`, etc.). |
| `400`  | `:ownerId` not a UUID. |
| `401`  | Missing/invalid access token. |
| `403`  | Not admin. |
| `404`  | Owner missing. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Prisma error. |

---

## 6. Side effects

| Table / key | Mutation |
|-------------|----------|
| `features` | INSERT (new row) |
| `marketing:features:<scope>:<ownerId>` (Redis) | DEL via `invalidateOwner` |
| `marketing:faqs:<scope>:<ownerId>` (Redis) | DEL (side effect of `invalidateOwner`) |
| `marketing:testimonials:<scope>:<ownerId>` (Redis) | DEL (side effect) |
| `paths:detail:*` / `courses:detail:*` (Redis) | pattern DEL (`invalidateOwner` blunt) |
| `paths:list:*` / `courses:list:*` (Redis) | pattern DEL |

Plus a dormant `POST` to the Next.js revalidate endpoint (no-op
in dev).

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/marketing/features/admin-features.controller.ts` | `createForPath` + `createForCourse` handlers |
| `src/content/marketing/features/features.service.ts` | `create()`, `nextOrder()` |
| `src/content/marketing/features/dto/create-feature.dto.ts` | Request validation |
| `src/content/marketing/helpers/owner-validator.helper.ts` | `ensureOwnerExists` |
| `src/common/cache/cache.service.ts` | `invalidateOwner`, `slugFor` |
| `src/common/cache/revalidation.helper.ts` | `revalidatePath` (dormant) |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/features/features.service.spec.ts` | Happy path with and without `order`, `nextOrder` behavior on empty/non-empty owner, owner-missing → 404, cache invalidation calls fire with the right scope + id, dormant revalidate skipped. |
| `test/content/marketing/*.e2e-spec.ts` | HTTP round trip, DTO validation rejections, 201 response shape. |

---

## 9. Things NOT to change without coordination

- The `nextOrder` default. Requiring the client to pass `order`
  would force a round-trip read-then-write in the admin UI.
- The `invalidateOwner` call after the write. Without it, the
  public discovery pages would serve stale marketing content
  until the detail cache expires.
- The `scope` mapping (`PATH → 'path'`, `COURSE → 'course'`).
  See [../polymorphic-ownership.md §7](../polymorphic-ownership.md).
- The dormant `revalidatePath` call. Removing it would require
  a code change to activate the ISR flow later.
