# Admin Categories — Backend Reference (awamer-api)

> **Module:** `CategoriesAdminModule` (`src/admin/categories/`) — registered via `AdminModule.imports`
> **Endpoints:** `POST | GET | GET /:id | PATCH /:id | DELETE /:id` under `/api/v1/admin/categories`
> **Decorator:** `@AdminEndpoint()` at the controller class level
> **Status:** shipped in KAN-82

This document covers all five admin endpoints for the `Category` entity. It mirrors the per-endpoint style established by [`docs/admin/_template.md`](./_template.md) — one section per endpoint, plus shared cross-cutting notes at the top.

The machine-readable contract is at [`specs/015-categories-admin-crud/contracts/categories-admin.openapi.yaml`](../../specs/015-categories-admin-crud/contracts/categories-admin.openapi.yaml).

---

## Cross-cutting

### Authorization

Every endpoint inherits the standard admin pipeline from `@AdminEndpoint()`:

- `JwtAuthGuard` (global) → 401 if no/invalid JWT
- `RolesGuard` (route-level) → 403 `INSUFFICIENT_ROLE` for non-admin users
- `AuditLogInterceptor` (route-level) → emits one structured `AdminAudit` log entry per POST/PATCH/DELETE; zero on GET (see [`audit-log-interceptor.md`](./audit-log-interceptor.md))

### Cache invalidation

Every successful mutation (POST, PATCH, DELETE) calls `cache.del(CacheKeys.categories.all())` before returning. Failed mutations (validation 400, conflict 409, not-found 404, or any thrown error) do **not** invalidate. The public `GET /categories` endpoint (KAN-26) reads through this same cache key — admin mutations therefore close the read-after-write window before the admin response is sent.

### Module wiring (FR-005a)

`CategoriesAdminModule` registers `RolesGuard` and `AuditLogInterceptor` **locally** in its own `providers` array. NestJS module imports are unidirectional — `AdminModule.imports = [CategoriesAdminModule]` does not flow `AdminModule`'s exported providers into the sub-module. Both providers are stateless (`Reflector` / `Logger` only), so per-module instances cost nothing. KAN-100 will correct the foundation docs that describe this incorrectly.

---

## 1. `POST /api/v1/admin/categories` — Create

### Request

```http
POST /api/v1/admin/categories HTTP/1.1
Cookie: access_token=<admin JWT>
Content-Type: application/json

{
  "name": "الذكاء الاصطناعي",
  "slug": "artificial-intelligence"
}
```

| Field | Type | Constraints |
|---|---|---|
| `name` | string | required, trimmed, 1–200 chars; app-layer unique (case-sensitive) — see FR-014 |
| `slug` | string | required, trimmed, 1–200 chars, kebab-case (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`), DB-unique |

`order` and `status` are NOT accepted on create — the column defaults take over (`order: 0`, `status: ACTIVE`).

### Behavior — `CategoriesAdminService.create()`

1. `findFirst({ where: { name } })` — name pre-check (uses `findFirst` because `Category.name` is not `@unique`; KAN-101 will tighten this).
2. If found → 409 `CATEGORY_NAME_EXISTS`. Slug is **not** checked.
3. `findUnique({ where: { slug } })` — slug pre-check.
4. If found → 409 `CATEGORY_SLUG_EXISTS`.
5. `prisma.category.create({ data: { name, slug } })`.
6. `cache.del('categories:all')`.
7. Return the new row mapped to `CategoryAdminResponseDto` with `pathCount: 0`, `courseCount: 0`.

### Successful response — 201

```json
{
  "data": {
    "id": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f",
    "name": "الذكاء الاصطناعي",
    "slug": "artificial-intelligence",
    "order": 0,
    "status": "ACTIVE",
    "createdAt": "2026-05-02T16:00:00.000Z",
    "updatedAt": "2026-05-02T16:00:00.000Z",
    "pathCount": 0,
    "courseCount": 0
  },
  "message": "Success"
}
```

### Error responses

| Status | errorCode | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body fails DTO validation (missing field, whitespace-only after trim, slug not kebab-case, etc.) |
| 401 | (unset) | Anonymous request |
| 403 | `INSUFFICIENT_ROLE` | Authenticated user lacks `Role.ADMIN` |
| 409 | `CATEGORY_NAME_EXISTS` | Name already taken |
| 409 | `CATEGORY_SLUG_EXISTS` | Slug already taken (and name was unique) |

---

## 2. `GET /api/v1/admin/categories` — List

### Request

```http
GET /api/v1/admin/categories?page=1&limit=20&search=cy&status=ACTIVE HTTP/1.1
Cookie: access_token=<admin JWT>
```

| Query | Default | Constraint |
|---|---|---|
| `page` | `1` | integer ≥ 1 |
| `limit` | `20` | integer 1–100 (rejects 101+ with 400; does NOT silently cap) |
| `search` | — | trimmed, ≤ 200 chars; case-insensitive substring against `name` AND `slug` |
| `status` | (all statuses) | `ACTIVE` or `HIDDEN` (case-sensitive); other values → 400 `VALIDATION_FAILED` |

### Ordering

`createdAt DESC` always, regardless of `status` filter. (Distinct from public `GET /categories` which orders by `order ASC`.)

### Behavior — `CategoriesAdminService.list()`

1. Build `where`: `OR(name contains search, slug contains search)` if `search`; `status` filter if provided.
2. `prisma.$transaction([category.count, category.findMany])` — count + paginated rows in one round-trip.
3. `findMany` includes `_count: { paths: true, courses: true }` for inline counts.
4. Map rows; return `{ data, meta: { total, page, limit, totalPages } }`.

### Successful response — 200

```json
{
  "data": {
    "data": [
      {
        "id": "...",
        "name": "AI",
        "slug": "ai",
        "order": 0,
        "status": "ACTIVE",
        "createdAt": "...",
        "updatedAt": "...",
        "pathCount": 3,
        "courseCount": 7
      }
    ],
    "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
  },
  "message": "Success"
}
```

### Error responses

| Status | errorCode | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Invalid `page`/`limit`/`status` |
| 401 | (unset) | Anonymous |
| 403 | `INSUFFICIENT_ROLE` | Non-admin |

GET emits **zero** audit log entries.

---

## 3. `GET /api/v1/admin/categories/:id` — Detail

### Request

```http
GET /api/v1/admin/categories/0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f HTTP/1.1
Cookie: access_token=<admin JWT>
```

`ParseUUIDPipe` validates `:id` and rejects non-UUIDs with 400 before the service runs.

### Behavior — `CategoriesAdminService.get()`

1. `findUnique({ where: { id }, include: { _count: { paths, courses } } })`.
2. If null → 404 `CATEGORY_NOT_FOUND`.
3. Map and return.

### Successful response — 200

Same shape as POST response (single object under `data`, with `pathCount` / `courseCount` reflecting the live count).

### Error responses

| Status | errorCode | When |
|---|---|---|
| 400 | (unset) | `:id` is not a UUID (rejected by `ParseUUIDPipe`) |
| 401 | (unset) | Anonymous |
| 403 | `INSUFFICIENT_ROLE` | Non-admin |
| 404 | `CATEGORY_NOT_FOUND` | No category with that `id` |

GET emits **zero** audit log entries.

---

## 4. `PATCH /api/v1/admin/categories/:id` — Update

### Request

```http
PATCH /api/v1/admin/categories/0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f HTTP/1.1
Cookie: access_token=<admin JWT>
Content-Type: application/json

{ "name": "اسم جديد" }
```

All fields optional (`name`, `slug`, `order`, `status`). Empty body `{}` is accepted as a no-op (returns the unchanged row).

### Behavior — `CategoriesAdminService.update()`

1. `findUnique({ where: { id } })` — existence check; if null → 404 `CATEGORY_NOT_FOUND`.
2. If `dto.name` is provided and differs from existing: `findFirst({ where: { name, NOT: { id } } })`. If found → 409 `CATEGORY_NAME_EXISTS`. (Slug check is **skipped**.)
3. If `dto.slug` is provided and differs from existing: `findUnique({ where: { slug } })`. If found and id ≠ `:id` → 409 `CATEGORY_SLUG_EXISTS`.
4. `prisma.category.update({ where: { id }, data: { ...sparse } })`.
5. `cache.del('categories:all')`.
6. Return mapped row with `_count`.

### Successful response — 200

Same shape as POST response.

### Error responses

| Status | errorCode | When |
|---|---|---|
| 400 | (unset)/`VALIDATION_FAILED` | `:id` not UUID, or body fails DTO validation |
| 401 | (unset) | Anonymous |
| 403 | `INSUFFICIENT_ROLE` | Non-admin |
| 404 | `CATEGORY_NOT_FOUND` | No category with that `id` |
| 409 | `CATEGORY_NAME_EXISTS` | Name taken on another row (checked before slug) |
| 409 | `CATEGORY_SLUG_EXISTS` | Slug taken on another row (only reached if name didn't conflict) |

---

## 5. `DELETE /api/v1/admin/categories/:id` — Delete

### Request

```http
DELETE /api/v1/admin/categories/0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f HTTP/1.1
Cookie: access_token=<admin JWT>
```

### Behavior — `CategoriesAdminService.remove()`

Relies on the database FK constraint as the integrity guarantee (see KAN-82's migration). No app-layer pre-check, no `$transaction` wrapper.

1. `prisma.category.delete({ where: { id } })`.
2. On `PrismaClientKnownRequestError` with `code === 'P2003'` **or** `PrismaClientUnknownRequestError` whose message contains SQLSTATE `23001`: run `Promise.all([path.count, course.count])` for the blocking refs and throw 409 `CATEGORY_IN_USE` with `errors: { pathCount, courseCount }`.
3. On `P2025`: throw 404 `CATEGORY_NOT_FOUND`.
4. On success: `cache.del('categories:all')` and return `{ ok: true }`.

The dual-class FK-violation match is **mandatory** — `paths.categoryId` and `courses.pathId` are now `ON DELETE RESTRICT`, which Prisma surfaces as `Unknown` (not `Known/P2003`). See [`specs/015-categories-admin-crud/contracts/delete-fk-violation.contract.md`](../../specs/015-categories-admin-crud/contracts/delete-fk-violation.contract.md) for the test matrix.

### Successful response — 200

```json
{
  "data": { "ok": true },
  "message": "Success"
}
```

### Error responses

| Status | errorCode | When | Body extras |
|---|---|---|---|
| 400 | (unset) | `:id` not UUID | — |
| 401 | (unset) | Anonymous | — |
| 403 | `INSUFFICIENT_ROLE` | Non-admin | — |
| 404 | `CATEGORY_NOT_FOUND` | No category with that `id` | — |
| 409 | `CATEGORY_IN_USE` | Referenced by ≥1 path or course | `errors: { pathCount: number, courseCount: number }` |

The 409 response carries an **object-shaped** `errors` field. The shared `HttpExceptionFilter` was extended in KAN-82 to pass through object-shaped `errors` (the legacy array path for validation failures is unchanged).

---

## Side effects

| Mutation | DB writes | Audit log | Cache invalidation |
|---|---|---|---|
| `POST /admin/categories` | `INSERT INTO categories` | one `outcome: 'success'` entry | yes (on success only) |
| `PATCH /admin/categories/:id` | `UPDATE categories` | one entry | yes (on success only) |
| `DELETE /admin/categories/:id` | `DELETE FROM categories` | one entry | yes (on success only) |
| Any of the above failing | none | one `outcome: 'error'` entry with `statusCode` | no |
| `GET /admin/categories` | none | none | no |
| `GET /admin/categories/:id` | none | none | no |

Audit log fields: see [`audit-log-interceptor.md`](./audit-log-interceptor.md). The interceptor records `req.route.path`, so URLs containing UUIDs (e.g. `/api/v1/admin/categories/:id`) are stored as the matched **pattern** — no IDs leak.

---

## Files involved

| File | Role |
|---|---|
| `src/admin/categories/categories-admin.module.ts` | Module wiring; local providers for `RolesGuard` + `AuditLogInterceptor` (FR-005a) |
| `src/admin/categories/categories-admin.controller.ts` | 5 routes; `@Controller('admin/categories') @AdminEndpoint()` |
| `src/admin/categories/categories-admin.service.ts` | Business logic for all 5 methods; `isFKViolation` helper |
| `src/admin/categories/dto/create-category.dto.ts` | POST body |
| `src/admin/categories/dto/update-category.dto.ts` | PATCH body |
| `src/admin/categories/dto/list-categories-query.dto.ts` | GET query |
| `src/admin/categories/dto/category-admin-response.dto.ts` | Output shape |
| `src/common/filters/http-exception.filter.ts` | Object-shape `errors` passthrough (FR-026) |
| `src/common/error-codes.enum.ts` | `CATEGORY_NOT_FOUND`, `CATEGORY_NAME_EXISTS`, `CATEGORY_SLUG_EXISTS`, `CATEGORY_IN_USE` |
| `src/admin/admin.module.ts` | Wires `CategoriesAdminModule` into `AdminModule.imports` |
| `prisma/schema.prisma` | Drops `description`/`icon` from Category; tightens `Path.category` and `Course.path` FKs to `Restrict` |
| `prisma/migrations/<ts>_drop_category_columns_and_restrict_content_fks/migration.sql` | The migration |
| `test/admin/categories.e2e-spec.ts` | E2E for US1, US3, US4, US5, US6, US7 |
| `src/admin/categories/categories-admin.service.spec.ts` | Unit tests for all 5 methods |
| `src/common/filters/http-exception.filter.spec.ts` | 6 new tests for the object-shape passthrough |

---

## Things NOT to change without coordination

- The class-level `@AdminEndpoint()` decorator on `CategoriesAdminController`.
- Local registration of `RolesGuard` and `AuditLogInterceptor` in `CategoriesAdminModule.providers` (FR-005a).
- The dual Prisma error-class match in `isFKViolation` — both `PrismaClientKnownRequestError (P2003)` and `PrismaClientUnknownRequestError (SQLSTATE 23001)` MUST be caught.
- The conflict resolution order on CREATE and PATCH: name first (`findFirst`), then slug (`findUnique`) — never combined OR.
- The migration shape: drop `description`/`icon` AND tighten `paths.categoryId` + `courses.pathId` FKs in a single migration. The four user-history cascades (`Certificate.path`, `Certificate.course`, `QuizAttempt.quiz`, `ProjectSubmission.project`) are explicitly out of scope.
- The route prefix `admin/categories` (kebab-case, plural) — frontend (KAN-83) pins on this exact path.
