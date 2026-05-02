# Admin Categories — Backend Spec (awamer-api)

> **Module:** `CategoriesAdminModule` (`src/admin/categories/`) — registered via `AdminModule.imports`
> **Endpoints:** `POST | GET | GET /:id | PATCH /:id | DELETE /:id` under `/api/v1/admin/categories`
> **Decorator:** `@AdminEndpoint()` at the controller class level — bundles `JwtAuthGuard`, `RolesGuard`, `AuditLogInterceptor`, `@Roles(Role.ADMIN)`. See [admin-endpoint-decorator.md](./admin-endpoint-decorator.md).
> **Status codes:** `201 Created` on POST; `200 OK` on GET / PATCH / DELETE
> **Migration:** `prisma/migrations/20260502160429_drop_category_columns_and_restrict_content_fks/`

This document is the canonical reference for the five admin endpoints that manage the `Category` entity. It is the first per-entity admin module shipped on the KAN-78 foundation; subsequent admin modules (KAN-85 Paths, KAN-88 Courses, KAN-91 Sections, KAN-94 Lessons, KAN-97 Content Blocks) follow the same shape and reuse the cross-cutting infrastructure refined here. The companion machine-readable contract lives at [`specs/015-categories-admin-crud/contracts/categories-admin.openapi.yaml`](../../specs/015-categories-admin-crud/contracts/categories-admin.openapi.yaml). Cross-references throughout cite source line ranges so this document reads as a true reference, not a summary.

For the parallel public read endpoint, see [`docs/content-discovery/categories/list-categories.md`](../content-discovery/categories/list-categories.md) (KAN-26). For the broader admin module conventions every per-entity sub-module follows, see [conventions.md](./conventions.md). High-level platform context lives in the **Awamer Backend Tech Stack §6.10 — Admin module** (Confluence; same space as the data-model and API-design pages already cited from `CLAUDE.md`).

---

## 1. When to use this module

A `Category` is a top-level taxonomy node in the catalog hierarchy:

```
Category (1) ──→ Path (many) ──→ Course (many) ──→ Section ──→ Lesson ──→ ContentBlock
```

The seeded categories today are `الذكاء الاصطناعي وعلم البيانات` (`artificial-intelligence`) and `تطوير البرمجيات` (`software-development`). Cardinality is intentionally low — categories are coarse-grained and curated by hand; the platform expects single-digit-to-low-double-digit categories total, not user-generated content.

**This module is for catalog administration**, not for learner-facing reads. Use it when:

- Curating the public catalog from the admin console (the upcoming KAN-83 frontend).
- Backfilling or correcting categories programmatically (rare; one-off scripts in `prisma/seed.ts` handle the seeded set).
- Coordinating multi-step content rollouts where a category needs to be created before its paths land.

For learner-facing reads (the homepage category strip, the catalog browse page), use the public `GET /api/v1/categories` endpoint instead. The admin and public endpoints serve different audiences and apply different filters — see §4.

---

## 2. Schema reference

After this PR's migration, the `Category` Prisma model (`prisma/schema.prisma`) is:

```prisma
model Category {
  id        String         @id @default(uuid())
  name      String
  slug      String         @unique
  order     Int            @default(0)
  status    CategoryStatus @default(ACTIVE)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  paths   Path[]
  courses Course[]

  @@map("categories")
}

enum CategoryStatus {
  ACTIVE @map("active")
  HIDDEN @map("hidden")

  @@map("category_status")
}
```

Field semantics:

| Field | Source of truth | Notes |
|---|---|---|
| `id` | server | UUID v4 from `@default(uuid())`. Returned to the client as a string. |
| `name` | client (POST/PATCH body) | Display name. App-layer-unique (case-sensitive); not DB-enforced — see [research.md § Decision 5](../../specs/015-categories-admin-crud/research.md) and §3 below. KAN-101 will lift the constraint to the DB once the four pre-existing test fixtures stop reusing one-character names. |
| `slug` | client (POST/PATCH body) | Kebab-case URL fragment. DB-unique via `@unique`. Used as the routing key by the public catalog frontend. |
| `order` | client (PATCH only — column default `0` on create) | Public catalog ordering. NOT used by the admin list (which orders by `createdAt DESC`). |
| `status` | client (PATCH only — column default `ACTIVE` on create) | `ACTIVE` shows in public; `HIDDEN` does not. Reversible. Distinct from a soft delete (which is explicitly out of scope — see §3). |
| `createdAt`, `updatedAt` | server | Prisma-managed. ISO 8601 strings on the wire. |

**Dropped by this PR's migration** (were nullable, never read by any UI surface and confirmed unused via grep):

- `description String?`
- `icon String?`

---

## 3. Migration narrative — Cascade → Restrict, and why

Before KAN-82, two foreign keys in the catalog graph carried `ON DELETE CASCADE`:

| FK | Before | After (this PR) |
|---|---|---|
| `Path.categoryId → Category.id` | `ON DELETE CASCADE` | `ON DELETE RESTRICT` |
| `Course.pathId → Path.id` | `ON DELETE CASCADE` | `ON DELETE RESTRICT` |

This was a **latent data-loss bug**, not a design choice. A single `DELETE FROM categories WHERE id = ?` would have silently propagated through the entire content subtree:

```
DELETE Category
  └─ CASCADE → Path
       └─ CASCADE → Course  (both via Course.categoryId AND Course.pathId)
            └─ CASCADE → Section
                 └─ CASCADE → Lesson
                      └─ CASCADE → LessonContentBlock
                 └─ CASCADE → Quiz, Question, Option
            └─ CASCADE → Project, ProjectSubmission
       └─ CASCADE → PathEnrollment, PathProgress, LastPosition, Certificate
```

In other words, deleting a category from the admin console would have wiped every learner's progress, every issued certificate, and every quiz attempt that ever touched that category — with no warning, no preview, no undo. The bug was discovered during the KAN-82 plan-phase FK audit (see [research.md § Decision 1](../../specs/015-categories-admin-crud/research.md)) and fixed in the same migration that drops the unused `description`/`icon` columns:

```sql
-- prisma/migrations/20260502160429_drop_category_columns_and_restrict_content_fks/migration.sql
ALTER TABLE "courses" DROP CONSTRAINT "courses_pathId_fkey";
ALTER TABLE "paths" DROP CONSTRAINT "paths_categoryId_fkey";
ALTER TABLE "categories" DROP COLUMN "description", DROP COLUMN "icon";
ALTER TABLE "paths" ADD CONSTRAINT "paths_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courses" ADD CONSTRAINT "courses_pathId_fkey"
  FOREIGN KEY ("pathId") REFERENCES "paths"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

### 3.1 Why FK `Restrict`, not an app-layer pre-check

A natural alternative is to count blocking refs in the service before issuing the `DELETE`:

```ts
// REJECTED — race-prone
const refs = await prisma.path.count({ where: { categoryId: id } });
if (refs > 0) throw new ConflictException(...);
await prisma.category.delete({ where: { id } });
```

This is rejected for two reasons:

1. **Race window.** Between the `count` and the `delete`, another request can insert a path pointing at the category. The pre-check passes, the delete proceeds, and the new path's FK becomes orphaned — the exact failure mode the FK was supposed to prevent.
2. **Defense-in-depth.** The DB constraint is the integrity guarantee. The app-layer check is a UX layer on top — it produces nicer 409 messages but does not own the invariant. With `Restrict` in place, the DB rejects the delete cleanly and the service translates the rejection into a 409 with structured counts (see §10 — Behavior).

### 3.2 What's still `Cascade` (out of scope for KAN-82)

Four other foreign keys in the schema retain `ON DELETE CASCADE`. They are all **user-history records** where cascade is the desired retention policy on the entity-level cascade:

- `Certificate.pathId → Path.id`
- `Certificate.courseId → Course.id`
- `QuizAttempt.quizId → Quiz.id`
- `ProjectSubmission.projectId → Project.id`

These belong to a separate retention-policy decision (do we keep certificates / quiz attempts / project submissions when their parent content is deleted?). KAN-82 does not change them. A future ticket will decide the policy and migrate accordingly. They are listed in [research.md](../../specs/015-categories-admin-crud/research.md) and the spec's `Out of scope` block.

---

## 4. Public vs admin boundary

The same `Category` table backs two distinct API surfaces. The differences are deliberate:

| Concern | Public — `GET /api/v1/categories` (KAN-26) | Admin — `GET /api/v1/admin/categories` (this module) |
|---|---|---|
| Visibility filter | `WHERE status = ACTIVE` | None by default; `?status=ACTIVE\|HIDDEN` narrows |
| Ordering | `ORDER BY order ASC` (curated catalog order) | `ORDER BY createdAt DESC` (most recently changed first — admin convenience) |
| Response fields | `id`, `name`, `slug`, `order`, `pathCount`, `courseCount` | Adds `status`, `createdAt`, `updatedAt` |
| `_count` shape | Counts only **PUBLISHED** paths and **PUBLISHED** courses | Counts **all** paths/courses regardless of status |
| Cache | Redis key `categories:all`, served from cache when present | No read cache. Mutations invalidate the public key — see §5.2 |
| Auth | `@Public()` — no JWT required | `@AdminEndpoint()` — JWT + ADMIN role |

The bottom row is the contract that ties them together: every successful admin mutation invalidates the public cache, so the public endpoint never serves data more than one request out-of-date. See §5.2 for the wiring; see [`src/content/categories/categories.service.ts`](../../src/content/categories/categories.service.ts) for the public side.

---

## 5. Cross-cutting behavior

### 5.1 Authorization

Every endpoint inherits the standard admin pipeline from `@AdminEndpoint()` (`src/admin/common/decorators/admin-endpoint.decorator.ts:30–35`):

| Layer | Source | Failure |
|---|---|---|
| `JwtAuthGuard` (global + idempotent route-level) | `src/auth/guards/jwt-auth.guard.ts` | `401` on missing/invalid/expired JWT |
| `RolesGuard` (route-level) | `src/common/guards/roles.guard.ts:19–49` | `403` `INSUFFICIENT_ROLE` if `req.user.roles` lacks `'ADMIN'`. See [roles-guard.md](./roles-guard.md). |
| `AuditLogInterceptor` (route-level) | `src/admin/interceptors/audit-log.interceptor.ts:67–87` | One structured `AdminAudit` log entry per mutation; zero on GET. See [audit-log-interceptor.md](./audit-log-interceptor.md). |
| `ValidationPipe` (global) | `src/main.ts` | `400` `VALIDATION_FAILED` on DTO violation |

The full activation order is documented in [admin-endpoint-decorator.md §4](./admin-endpoint-decorator.md). Per-endpoint sections below cite only the parts each endpoint adds.

### 5.2 Cache invalidation

Every successful POST / PATCH / DELETE calls `await this.cache.del(CacheKeys.categories.all())` immediately before returning to the controller. The key string is `'categories:all'` (`src/common/cache/cache-keys.ts:14–16`). Failed mutations skip the call by virtue of throwing earlier in the method body — there is no `try/finally` wrapping the cache call.

| Method | Cache eviction | Source |
|---|---|---|
| `create` success | yes | `categories-admin.service.ts:56` |
| `update` success | yes | `categories-admin.service.ts:161` |
| `remove` success | yes | `categories-admin.service.ts:190` |
| Any failed mutation (400 / 404 / 409) | no | thrown before reaching the `cache.del` line |
| `list`, `get` (reads) | no | not called — reads do not need to invalidate |

If Redis is unavailable, `cache.del` returns silently — `CacheService` swallows transport errors at `warn` level and returns `null`/`undefined` rather than throwing (`src/common/cache/cache.service.ts:21–30`). A successful mutation therefore never fails because of a Redis blip; the cost is a stale public read until the next mutation evicts the key or the TTL expires (`CacheTTL.CATEGORIES = null` — no expiry, mutation-based invalidation only).

### 5.3 Module wiring (FR-005a)

`CategoriesAdminModule` registers `RolesGuard` and `AuditLogInterceptor` **locally** in its own `providers` array (`src/admin/categories/categories-admin.module.ts:21–26`):

```ts
@Module({
  imports: [PrismaModule, CacheModule, AuthModule],
  controllers: [CategoriesAdminController],
  providers: [CategoriesAdminService, RolesGuard, AuditLogInterceptor],
})
export class CategoriesAdminModule {}
```

The local registration is mandatory, not stylistic. NestJS module imports are unidirectional: `AdminModule.imports = [CategoriesAdminModule]` makes the sub-module's exports visible **inside** `AdminModule`, not the reverse. So even though `AdminModule` provides and exports both `RolesGuard` and `AuditLogInterceptor`, those providers do **not** flow into a sub-module that lacks them locally — the controller's `@AdminEndpoint()` would fail DI resolution at boot. Both providers are stateless (`Reflector` and `Logger` only — both framework-supplied), so per-module instances cost nothing. Full diagnosis at [research.md § Decision 6](../../specs/015-categories-admin-crud/research.md).

KAN-100 will correct the foundation docs that currently describe this incorrectly. KAN-82 documents and ships the working pattern locally; nothing in this module is contingent on KAN-100 landing first.

---

## 6. POST `/api/v1/admin/categories` — Create

### 6.1 Summary

Creates a new category with admin-supplied `name` and `slug`. Server fills `id` (UUID), `order` (`0`), `status` (`ACTIVE`), and timestamps. The category is immediately visible to the public endpoint (status defaults to `ACTIVE` and the public cache is evicted as part of the call).

This is the only entry point for new categories. Backfills via `prisma/seed.ts` set the seeded fixtures; everything else routes through this endpoint.

### 6.2 Request

```http
POST /api/v1/admin/categories HTTP/1.1
Cookie: access_token=<admin JWT>
Content-Type: application/json

{
  "name": "Cybersecurity",
  "slug": "cyber"
}
```

Body — `CreateCategoryDto` (`src/admin/categories/dto/create-category.dto.ts`):

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | `string` | yes | `@IsString`, `@Transform(trim)`, `@MinLength(1)`, `@MaxLength(200)` |
| `slug` | `string` | yes | `@IsString`, `@Transform(trim)`, `@MinLength(1)`, `@MaxLength(200)`, `@Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)` |

Both fields are trimmed before validation; whitespace-only input fails `@MinLength(1)`. `order` and `status` are not accepted on the body — the global `ValidationPipe` rejects unknown fields (`whitelist: true, forbidNonWhitelisted: true`).

### 6.3 Behavior — `CategoriesAdminService.create()`

Source: `src/admin/categories/categories-admin.service.ts:31–59`.

```ts
async create(dto: CreateCategoryDto): Promise<CategoryAdminResponseDto> {
  const nameClash = await this.prisma.category.findFirst({
    where: { name: dto.name },
  });
  if (nameClash) {
    throw new ConflictException({
      errorCode: ErrorCode.CATEGORY_NAME_EXISTS,
      message: 'Category name already exists',
    });
  }

  const slugClash = await this.prisma.category.findUnique({
    where: { slug: dto.slug },
  });
  if (slugClash) {
    throw new ConflictException({
      errorCode: ErrorCode.CATEGORY_SLUG_EXISTS,
      message: 'Category slug already exists',
    });
  }

  const created = await this.prisma.category.create({
    data: { name: dto.name, slug: dto.slug },
  });

  await this.cache.del(CacheKeys.categories.all());

  return this.toDto({ ...created, _count: { paths: 0, courses: 0 } });
}
```

1. **Name pre-check.** `findFirst({ where: { name } })` — `findFirst` (not `findUnique`) because `Category.name` lacks `@unique` until KAN-101 lands. If a row matches, throw 409 `CATEGORY_NAME_EXISTS`.
2. **Slug pre-check.** Only runs if name is unique. `findUnique({ where: { slug } })` benefits from the DB-level `@unique` index. Throws 409 `CATEGORY_SLUG_EXISTS` on collision.
3. **Insert.** Single-row `prisma.category.create({ data: { name, slug } })`. `order` and `status` are not passed; the column defaults (`0`, `ACTIVE`) take over.
4. **Cache eviction.** Awaited `cache.del('categories:all')` — public reads see the new category on the next request.
5. **Return.** `_count` is hard-coded to `{ paths: 0, courses: 0 }` because the row was just created and trivially has no references; this avoids an extra `findUnique({ include: { _count } })` round-trip.

### 6.4 Successful response — `201 Created`

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "data": {
    "id": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f",
    "name": "Cybersecurity",
    "slug": "cyber",
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

The `{ data, message }` envelope is produced by the global `ResponseTransformInterceptor` (`src/common/interceptors/response-transform.interceptor.ts`).

### 6.5 Error responses

All errors are normalized by `HttpExceptionFilter` (`src/common/filters/http-exception.filter.ts`).

| Status | `errorCode` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | DTO validation failed (missing field, whitespace-only after trim, slug not kebab-case, body has unknown fields). The response carries `errors[]` listing the failing properties. |
| `401` | (unset) | Anonymous request — Passport's `UnauthorizedException` does not set `errorCode`. |
| `403` | `INSUFFICIENT_ROLE` | Authenticated user lacks `Role.ADMIN`. |
| `409` | `CATEGORY_NAME_EXISTS` | Name already taken. Slug check is **not** reached. |
| `409` | `CATEGORY_SLUG_EXISTS` | Slug already taken (and name was unique). |

### 6.6 Side effects

| Event | When |
|---|---|
| `INSERT INTO categories` (one row) | On success. |
| `cache.del('categories:all')` | On success only — failed mutations skip. |
| One `AdminAudit` log line, `outcome: 'success'`, `method: 'POST'`, `route: '/api/v1/admin/categories'` | On success. |
| One `AdminAudit` log line, `outcome: 'error'`, `statusCode: 4xx` | On any failure that throws an `HttpException`. |
| **No** outbound network calls | The endpoint is purely internal. |

### 6.7 Edge cases / pitfalls

- **Race window for concurrent name collisions.** Two simultaneous POSTs with the same `name` and different `slug` values can both pass the `findFirst({ where: { name } })` check and both insert. The DB will not catch the collision because `name` lacks `@unique`. This is the residual risk explicitly accepted in [research.md § Decision 5](../../specs/015-categories-admin-crud/research.md); KAN-101 closes it. Admin throughput is human-paced (single-digit edits per day in expected operation), so the practical risk is near zero.
- **Slug `@unique` is the DB-layer fallback for name collisions.** If two POSTs race past the name pre-check with the same name **and** identical slugs, the second `prisma.category.create` raises `PrismaClientKnownRequestError` `P2002` (unique violation). This bubbles up as a generic 500 today — KAN-82 does not specifically map `P2002` to a clean 409 because the failure mode is theoretical at human throughput. KAN-101 will both add `@unique` to `name` and add the `P2002` translation cleanly.
- **`order` and `status` on POST are forbidden by `forbidNonWhitelisted: true`, not silently ignored.** A POST body like `{ name, slug, order: 5 }` returns `400 VALIDATION_FAILED` with `errors: ['property order should not exist']`. To set non-default `order` or `status`, POST first then PATCH.

### 6.8 Tests

| File | Cases |
|---|---|
| `src/admin/categories/categories-admin.service.spec.ts:109–171` | `describe('create()')` — success returns mapped DTO with counts 0/0; name conflict throws `CATEGORY_NAME_EXISTS`; slug conflict throws `CATEGORY_SLUG_EXISTS`; both colliding → name wins (slug check **not** reached). |
| `test/admin/categories.e2e-spec.ts:127–162` | US1 scenarios (1) POST creates and (2) created appears in GET list. |
| `test/admin/categories.e2e-spec.ts:268–286` | US1 scenarios (9) whitespace-only name → 400 and (10) malformed slug → 400. |

### 6.9 Related files

| File | Role |
|---|---|
| `src/admin/categories/categories-admin.controller.ts:31–34` | `@Post()` handler delegates to the service. |
| `src/admin/categories/categories-admin.service.ts:31–59` | `create()` implementation. |
| `src/admin/categories/dto/create-category.dto.ts` | Body shape and validators. |
| `src/admin/categories/dto/category-admin-response.dto.ts` | Output shape. |
| `src/common/error-codes.enum.ts:25–27` | `CATEGORY_NOT_FOUND`, `CATEGORY_NAME_EXISTS`, `CATEGORY_SLUG_EXISTS`. |

---

## 7. GET `/api/v1/admin/categories` — List

### 7.1 Summary

Paginated, filterable, searchable list of every category — both `ACTIVE` and `HIDDEN` by default. Returns inline `pathCount` and `courseCount` (across all path/course statuses, not just published). Ordered by `createdAt DESC` so the most recently changed category surfaces first; this is the admin operational ordering, distinct from the public endpoint's curated `order ASC`.

The list is the entry point for the admin console's table view. Use it for browsing, searching, and surfacing usage counts before deletion.

### 7.2 Request

```http
GET /api/v1/admin/categories?page=1&limit=20&search=cyber&status=ACTIVE HTTP/1.1
Cookie: access_token=<admin JWT>
```

Query — `ListCategoriesQueryDto` (`src/admin/categories/dto/list-categories-query.dto.ts`):

| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | `number` | no | `1` | `@Type(() => Number)`, `@IsInt`, `@Min(1)` |
| `limit` | `number` | no | `20` | `@Type(() => Number)`, `@IsInt`, `@Min(1)`, `@Max(100)` |
| `search` | `string` | no | — | `@IsString`, `@Transform(trim)`, `@MaxLength(200)` |
| `status` | `'ACTIVE' \| 'HIDDEN'` | no | (no filter) | `@IsEnum(CategoryStatus)` |

### 7.3 Behavior — `CategoriesAdminService.list()`

Source: `src/admin/categories/categories-admin.service.ts:61–96`.

```ts
async list(query: ListCategoriesQueryDto): Promise<{
  data: CategoryAdminResponseDto[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}> {
  const where: Prisma.CategoryWhereInput = {};
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { slug: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.status) {
    where.status = query.status;
  }

  const [total, rows] = await this.prisma.$transaction([
    this.prisma.category.count({ where }),
    this.prisma.category.findMany({
      where,
      include: { _count: { select: { paths: true, courses: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  return {
    data: rows.map((row) => this.toDto(row as CategoryRow)),
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
```

1. **Build `where`.** Search adds `OR(name contains, slug contains)` with `mode: 'insensitive'`. Status, when present, narrows the result. Both clauses combine when both are supplied.
2. **Count + fetch in one round-trip.** `prisma.$transaction([count, findMany])` runs both queries in the same DB call; the array form guarantees both see the same snapshot.
3. **`_count` aggregation.** `include: { _count: { select: { paths: true, courses: true } } }` projects the count of related rows into each row. The aggregation is **unfiltered** — counts include drafts and archived paths/courses, not just published ones (distinct from the public endpoint, see §4).
4. **Map and return.** `toDto` (lines 221–233) projects to `CategoryAdminResponseDto`. The `meta` object is the standard paginated envelope (Constitution §III).

### 7.4 Successful response — `200 OK`

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "data": {
    "data": [
      {
        "id": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f",
        "name": "Cybersecurity",
        "slug": "cyber",
        "order": 0,
        "status": "ACTIVE",
        "createdAt": "2026-05-02T16:00:00.000Z",
        "updatedAt": "2026-05-02T16:00:00.000Z",
        "pathCount": 3,
        "courseCount": 7
      }
    ],
    "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
  },
  "message": "Success"
}
```

Note the **double-nested `data`** — the outer envelope is the global `ResponseTransformInterceptor`, the inner `{ data, meta }` is the service's paginated return. E2E tests assert `res.body.data.data` for the array (`test/admin/categories.e2e-spec.ts:157`).

### 7.5 Error responses

| Status | `errorCode` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Invalid `page` (not integer, < 1), `limit` (not integer, < 1, > 100), `search` (> 200 chars), or `status` (not exactly `ACTIVE` or `HIDDEN`). |
| `401` | (unset) | Anonymous. |
| `403` | `INSUFFICIENT_ROLE` | Non-admin. |

### 7.6 Side effects

| Event | When |
|---|---|
| **No** DB writes, **no** cache invalidation, **no** audit log | Reads do not mutate; the `AuditLogInterceptor` method gate excludes `GET`. |

### 7.7 Edge cases / pitfalls

- **`?limit=200` is rejected with 400, not silently capped at 100.** The DTO uses `@Max(100)`, which rejects values above the maximum; the response is `400 VALIDATION_FAILED` with `errors: ['limit must not be greater than 100']`. Frontend pagination must not assume the request will be accepted — handle the 400.
- **Admin ordering is `createdAt DESC` regardless of `?status` filter.** A reader expecting the public catalog's `order ASC` (Constitution §III pagination defaults) will be surprised. The decoupling is documented in §4 and [research.md § Decision 7](../../specs/015-categories-admin-crud/research.md).
- **`?status=active` (lowercase) is rejected with 400.** `@IsEnum(CategoryStatus)` matches the TypeScript enum values (`'ACTIVE'`, `'HIDDEN'`), not the DB-layer `@map('active')`. The casing is documented in [conventions.md §1](./conventions.md#1-role-string-conventions) — same rule as the role enum.
- **The response is doubly-nested.** Anyone consuming the endpoint must read `res.body.data.data` for the array and `res.body.data.meta` for pagination. The first `.data` is the global envelope; the second is the service's `{ data, meta }` return. This is consistent with every paginated admin endpoint going forward.

### 7.8 Tests

| File | Cases |
|---|---|
| `src/admin/categories/categories-admin.service.spec.ts:176–250` | `describe('list()')` — pagination math, search OR clause, status filter, no-status path, ordering, `_count` mapping, no cache eviction. |
| `test/admin/categories.e2e-spec.ts:146–286` | US1 scenarios (2)–(10). Covers GET list with seeded categories, pagination meta, search narrowing, status filter (default / ACTIVE / HIDDEN / invalid), and the 2 DTO-validation smoke tests. |

### 7.9 Related files

| File | Role |
|---|---|
| `src/admin/categories/categories-admin.controller.ts:36–39` | `@Get()` handler. |
| `src/admin/categories/categories-admin.service.ts:61–96` | `list()` implementation. |
| `src/admin/categories/dto/list-categories-query.dto.ts` | Query shape and validators. |

---

## 8. GET `/api/v1/admin/categories/:id` — Detail

### 8.1 Summary

Single-row read with inline `pathCount` and `courseCount`. Used by the admin console to populate the edit form and to surface usage counts on the delete-confirmation modal before the admin commits to a delete.

### 8.2 Request

```http
GET /api/v1/admin/categories/0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f HTTP/1.1
Cookie: access_token=<admin JWT>
```

Path parameter:

| Param | Type | Validation |
|---|---|---|
| `id` | `string` (UUID v4) | `ParseUUIDPipe` — rejects non-UUIDs with `400` before the service is invoked. |

### 8.3 Behavior — `CategoriesAdminService.get()`

Source: `src/admin/categories/categories-admin.service.ts:98–110`.

```ts
async get(id: string): Promise<CategoryAdminResponseDto> {
  const row = await this.prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { paths: true, courses: true } } },
  });
  if (!row) {
    throw new NotFoundException({
      errorCode: ErrorCode.CATEGORY_NOT_FOUND,
      message: 'Category not found',
    });
  }
  return this.toDto(row as CategoryRow);
}
```

1. **`findUnique({ where: { id }, include: { _count } })`** — single round-trip with the count aggregation.
2. **404 on null.** `NotFoundException` with `errorCode: CATEGORY_NOT_FOUND` is the only failure case beyond auth/role/UUID-format.
3. **Map and return.**

### 8.4 Successful response — `200 OK`

Same shape as POST §6.4. `pathCount` and `courseCount` reflect the live counts (all path/course statuses).

### 8.5 Error responses

| Status | `errorCode` | When |
|---|---|---|
| `400` | (unset) | `:id` is not a UUID. Thrown by `ParseUUIDPipe` before the service runs. |
| `401` | (unset) | Anonymous. |
| `403` | `INSUFFICIENT_ROLE` | Non-admin. |
| `404` | `CATEGORY_NOT_FOUND` | No category with that `id`. |

### 8.6 Side effects

| Event | When |
|---|---|
| **No** DB writes, cache invalidation, or audit log | Same as §7 — reads are silent. |

### 8.7 Edge cases / pitfalls

- **`_count` includes all path/course statuses.** A category with 5 `DRAFT` paths and 2 `ARCHIVED` courses returns `pathCount: 5, courseCount: 2`, even though the public endpoint would report `pathCount: 0, courseCount: 0` (it counts only `PUBLISHED`). Admins need to see the full graph to make deletion decisions; the public count is a publishing concept.
- **GETs emit zero audit entries by design.** `AuditLogInterceptor`'s `MUTATING_METHODS` set excludes `GET`/`HEAD`/`OPTIONS` ([audit-log-interceptor.md §3](./audit-log-interceptor.md)). A reader expecting "every admin call is audited" will be surprised; the rationale is that read traffic would drown the mutation signal.
- **`ParseUUIDPipe` rejects pre-service.** A request to `/api/v1/admin/categories/not-a-uuid` returns `400` with no `errorCode` (the pipe throws a generic `BadRequestException`). The service never sees the request, so no `CATEGORY_NOT_FOUND` 404 path is reachable for malformed `:id`.

### 8.8 Tests

| File | Cases |
|---|---|
| `src/admin/categories/categories-admin.service.spec.ts:252–281` | `describe('get()')` — success returns DTO with non-zero counts; 404 on null; no cache invalidation. |
| `test/admin/categories.e2e-spec.ts:603–657` | US7 scenarios — GET with seeded N paths/M courses returns 200 + counts; unknown UUID → 404; non-UUID → 400. |

### 8.9 Related files

| File | Role |
|---|---|
| `src/admin/categories/categories-admin.controller.ts:41–44` | `@Get(':id')` handler. |
| `src/admin/categories/categories-admin.service.ts:98–110` | `get()` implementation. |

---

## 9. PATCH `/api/v1/admin/categories/:id` — Update

### 9.1 Summary

Sparse update — every body field is optional, and an empty body is a valid 200 no-op. The endpoint is the only way to change `order` or `status` (POST does not accept them). Conflict checks for `name` and `slug` are sequential and ordered (name first, then slug), excluding the row being updated from the lookup so the admin can PATCH a row to its own current value.

### 9.2 Request

```http
PATCH /api/v1/admin/categories/0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f HTTP/1.1
Cookie: access_token=<admin JWT>
Content-Type: application/json

{ "name": "اسم جديد" }
```

Body — `UpdateCategoryDto` (`src/admin/categories/dto/update-category.dto.ts`):

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | `string` | no | `@IsOptional`, `@IsString`, `@Transform(trim)`, `@MinLength(1)`, `@MaxLength(200)` |
| `slug` | `string` | no | `@IsOptional`, `@IsString`, `@Transform(trim)`, `@MinLength(1)`, `@MaxLength(200)`, `@Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)` |
| `order` | `number` | no | `@IsOptional`, `@IsInt`, `@Min(0)` |
| `status` | `'ACTIVE' \| 'HIDDEN'` | no | `@IsOptional`, `@IsEnum(CategoryStatus, { message: 'status must be one of: ACTIVE, HIDDEN' })` |

### 9.3 Behavior — `CategoriesAdminService.update()`

Source: `src/admin/categories/categories-admin.service.ts:112–164`.

```ts
async update(id: string, dto: UpdateCategoryDto): Promise<CategoryAdminResponseDto> {
  const existing = await this.prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundException({
      errorCode: ErrorCode.CATEGORY_NOT_FOUND,
      message: 'Category not found',
    });
  }

  if (dto.name !== undefined && dto.name !== existing.name) {
    const nameClash = await this.prisma.category.findFirst({
      where: { name: dto.name, NOT: { id } },
    });
    if (nameClash) {
      throw new ConflictException({
        errorCode: ErrorCode.CATEGORY_NAME_EXISTS,
        message: 'Category name already exists',
      });
    }
  }

  if (dto.slug !== undefined && dto.slug !== existing.slug) {
    const slugClash = await this.prisma.category.findUnique({
      where: { slug: dto.slug },
    });
    if (slugClash && slugClash.id !== id) {
      throw new ConflictException({
        errorCode: ErrorCode.CATEGORY_SLUG_EXISTS,
        message: 'Category slug already exists',
      });
    }
  }

  const updated = await this.prisma.category.update({
    where: { id },
    data: {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.slug !== undefined && { slug: dto.slug }),
      ...(dto.order !== undefined && { order: dto.order }),
      ...(dto.status !== undefined && { status: dto.status as CategoryStatus }),
    },
    include: { _count: { select: { paths: true, courses: true } } },
  });

  await this.cache.del(CacheKeys.categories.all());

  return this.toDto(updated as CategoryRow);
}
```

1. **Existence check.** `findUnique({ where: { id } })`; 404 on null.
2. **Name conflict — name first.** Only runs when `dto.name !== undefined && dto.name !== existing.name`. The `dto.name === existing.name` short-circuit allows PATCH-ing a row to its own current name without firing the check. `NOT: { id }` excludes the row being updated.
3. **Slug conflict — only if name didn't conflict.** Same short-circuit logic. The `slugClash.id !== id` check inside is redundant with the `dto.slug !== existing.slug` short-circuit but defends against the (impossible-by-uniqueness-but-cheap-to-check) case where the existing slug match is the row itself.
4. **Sparse update.** `prisma.category.update` with the spread pattern `...(dto.field !== undefined && { field: dto.field })` — only supplied fields land in the `data` object.
5. **Cache eviction + return.** Mapped to `CategoryAdminResponseDto` with `_count`.

### 9.4 Successful response — `200 OK`

Same shape as POST §6.4. The `updatedAt` timestamp is bumped to the current time even on a no-op update (Prisma's `@updatedAt` triggers on every `update` call, regardless of whether any column actually changed).

### 9.5 Error responses

| Status | `errorCode` | When |
|---|---|---|
| `400` | (unset) | `:id` is not a UUID. |
| `400` | `VALIDATION_FAILED` | Body fails DTO validation (e.g. `status: 'INVALID_VALUE'`, `order: -1`, `slug: 'Bad Slug'`). |
| `401` | (unset) | Anonymous. |
| `403` | `INSUFFICIENT_ROLE` | Non-admin. |
| `404` | `CATEGORY_NOT_FOUND` | No category with that `id`. |
| `409` | `CATEGORY_NAME_EXISTS` | Name taken on another row (checked first). |
| `409` | `CATEGORY_SLUG_EXISTS` | Slug taken on another row (only reached if name didn't conflict). |

### 9.6 Side effects

| Event | When |
|---|---|
| `UPDATE categories SET …` | On success. |
| `cache.del('categories:all')` | On success only. |
| One `AdminAudit` log line, `outcome: 'success'`, `method: 'PATCH'` | On success. |
| One `AdminAudit` log line, `outcome: 'error'`, `statusCode: 4xx` | On failure that throws an `HttpException`. |

### 9.7 Edge cases / pitfalls

- **Empty body `{}` is a valid 200 no-op.** None of the conditional pre-checks fire; the `update` call's `data` object is empty; Prisma updates `updatedAt` and returns the row unchanged. Asserted by the e2e `'PATCH empty body is a no-op success'` case (`test/admin/categories.e2e-spec.ts:588–597`). Frontend forms must not assume PATCH means "something changed".
- **Self-PATCH allowed.** `PATCH { name: existing.name }` short-circuits the name check and is allowed. Same for slug. This matters when a form re-submits the full record on save — the admin doesn't need to diff fields client-side.
- **Both `name` and `slug` colliding → name wins, slug check skipped.** A PATCH body like `{ name: 'A-taken-name', slug: 'a-taken-slug' }` (with each colliding against a different existing row) returns `409 CATEGORY_NAME_EXISTS`. The slug check never runs. Asserted by the unit test `'name wins when both name AND slug collide on different rows (slug check NOT reached)'` (`categories-admin.service.spec.ts:341–356`). Documented in [research.md § Decision 5](../../specs/015-categories-admin-crud/research.md).
- **`status: 'INVALID_VALUE'` returns `400 VALIDATION_FAILED`, not `404`.** The DTO validator runs before the existence check, so a malformed body never reaches `findUnique`. Even if the `:id` is a non-existent UUID, the response is the validation 400.
- **PATCH does not change `id` or `createdAt`.** The DTO does not declare them as fields; `forbidNonWhitelisted: true` rejects bodies that try.

### 9.8 Tests

| File | Cases |
|---|---|
| `src/admin/categories/categories-admin.service.spec.ts:283–377` | `describe('update()')` — single-field PATCH, 404, name conflict, slug conflict, name-wins-on-both, self-PATCH allowed. |
| `test/admin/categories.e2e-spec.ts:527–600` | US6 scenarios — single-field preserves others; name conflict; both-collide → name wins; invalid status; 404 unknown UUID; empty body no-op. |

### 9.9 Related files

| File | Role |
|---|---|
| `src/admin/categories/categories-admin.controller.ts:46–52` | `@Patch(':id')` handler. |
| `src/admin/categories/categories-admin.service.ts:112–164` | `update()` implementation. |
| `src/admin/categories/dto/update-category.dto.ts` | Body shape. |

---

## 10. DELETE `/api/v1/admin/categories/:id` — Delete

### 10.1 Summary

Hard-delete the category row. Blocked with `409 CATEGORY_IN_USE` (and a structured `errors: { pathCount, courseCount }` payload) if the category is referenced by any path or course — the foreign-key fix from §3 is what makes this reliable. Successful delete is the rare end state for a curated catalog; most categories live forever and toggle between `ACTIVE` and `HIDDEN` via PATCH.

### 10.2 Request

```http
DELETE /api/v1/admin/categories/0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f HTTP/1.1
Cookie: access_token=<admin JWT>
```

Path parameter — same `ParseUUIDPipe` handling as §8.

### 10.3 Behavior — `CategoriesAdminService.remove()`

Source: `src/admin/categories/categories-admin.service.ts:166–192`.

```ts
async remove(id: string): Promise<{ ok: true }> {
  try {
    await this.prisma.category.delete({ where: { id } });
  } catch (e) {
    if (this.isFKViolation(e)) {
      const [pathCount, courseCount] = await Promise.all([
        this.prisma.path.count({ where: { categoryId: id } }),
        this.prisma.course.count({ where: { categoryId: id } }),
      ]);
      throw new ConflictException({
        errorCode: ErrorCode.CATEGORY_IN_USE,
        message: 'Category is in use',
        errors: { pathCount, courseCount },
      });
    }
    if (this.isPrismaP2025(e)) {
      throw new NotFoundException({
        errorCode: ErrorCode.CATEGORY_NOT_FOUND,
        message: 'Category not found',
      });
    }
    throw e;
  }

  await this.cache.del(CacheKeys.categories.all());
  return { ok: true };
}
```

1. **Optimistic delete.** `prisma.category.delete({ where: { id } })` — no app-layer pre-check (see §3.1). The DB FK is the integrity guarantee.
2. **FK-violation catch.** `isFKViolation(e)` (lines 204–216) returns true for **either** of two Prisma error classes. Once captured, run `Promise.all([path.count, course.count])` to populate the structured 409 body. The two counts run in parallel because they're independent reads.
3. **Not-found catch.** `isPrismaP2025(e)` (lines 217–220) — Prisma's "record to delete does not exist" error code is `P2025`. Mapped to `404 CATEGORY_NOT_FOUND`.
4. **Re-throw on anything else.** Any other exception bubbles up and surfaces as a 500.
5. **Cache eviction + success.** Only on the happy path. The `cache.del` is **outside** the `try/catch`, so failed deletes never invalidate.

The dual-class FK match is mandatory because Prisma surfaces FK violations differently depending on which `onDelete` action the FK declares:

| FK action | Class | `code` |
|---|---|---|
| `Cascade` blocked by a deeper constraint | `PrismaClientKnownRequestError` | `'P2003'` |
| `Restrict` directly rejecting the delete | `PrismaClientUnknownRequestError` | (no `code`; SQLSTATE `23001` in `e.message`) |

After this PR's migration, both `Path.categoryId` and `Course.pathId` are `Restrict` — so the **Unknown** branch is the dominant case. Catching only `P2003` would silently fall through to a 500. The contract is captured at [`specs/015-categories-admin-crud/contracts/delete-fk-violation.contract.md`](../../specs/015-categories-admin-crud/contracts/delete-fk-violation.contract.md).

### 10.4 Successful response — `200 OK`

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "data": { "ok": true },
  "message": "Success"
}
```

### 10.5 Error responses

| Status | `errorCode` | When | Body extras |
|---|---|---|---|
| `400` | (unset) | `:id` is not a UUID (`ParseUUIDPipe`). | — |
| `401` | (unset) | Anonymous. | — |
| `403` | `INSUFFICIENT_ROLE` | Non-admin. | — |
| `404` | `CATEGORY_NOT_FOUND` | No category with that `id` (Prisma `P2025`). | — |
| `409` | `CATEGORY_IN_USE` | Referenced by ≥ 1 path or course. | `errors: { pathCount: number, courseCount: number }` |

The `409` body in full:

```json
{
  "statusCode": 409,
  "errorCode": "CATEGORY_IN_USE",
  "message": "Category is in use",
  "errors": { "pathCount": 2, "courseCount": 5 }
}
```

The structured `errors` field requires the `HttpExceptionFilter` extension shipped in this PR — the legacy filter (pre-KAN-82) silently dropped object-shaped `errors`. See `src/common/filters/http-exception.filter.ts:75–93` and the [filter passthrough contract](../../specs/015-categories-admin-crud/contracts/http-exception-filter-passthrough.contract.md).

### 10.6 Side effects

| Event | When |
|---|---|
| `DELETE FROM categories WHERE id = …` | On success only. |
| `cache.del('categories:all')` | On success only — the 409/404 paths skip it (they `throw` before reaching the call). |
| One `AdminAudit` log line, `outcome: 'success'`, `method: 'DELETE'`, `statusCode` absent | On success. |
| One `AdminAudit` log line, `outcome: 'error'`, `statusCode: 409 \| 404` | On the rejection paths. |
| **No** outbound calls, no transaction wrapper | The delete is a single-row write. |

### 10.7 Edge cases / pitfalls

- **DELETE on an already-deleted id returns `404 CATEGORY_NOT_FOUND`, not `410 Gone`.** Prisma raises `P2025` for "record to delete does not exist", which the service maps to 404. The endpoint is idempotent in the sense that re-issuing the same DELETE produces the same 404 — but the response code does not signal "previously existed and was removed"; it signals "does not exist now".
- **Cache is invalidated only on the success path.** The `cache.del` line lives **after** the `try/catch`, so 409 (in-use) and 404 (not found) responses leave the cache untouched. The public `categories:all` key remains warm. Asserted by the e2e cache-freshness test (`test/admin/categories.e2e-spec.ts:499–525`).
- **Race window between FK-violation and `Promise.all([path.count, course.count])`.** The counts are read **after** the delete attempt fails, in a separate transaction. A path or course inserted between the failed delete and the count reads will be reflected in the response. This is the safer direction (over-counting beats under-counting for "is this safe to delete?"); the alternative (counts fixed at delete time) would require extra coordination for no reader-value benefit.
- **No `prisma.$transaction` wrapper.** A transaction would not change behavior — the delete is a single row write, and the post-failure count reads are intentionally outside any DB transaction. Adding `$transaction` would add lock contention without fixing any race or invariant.

### 10.8 Tests

| File | Cases |
|---|---|
| `src/admin/categories/categories-admin.service.spec.ts:379–448` | `describe('remove()')` — success returns `{ ok: true }`; `P2003` Known → 409; SQLSTATE-23001 Unknown → 409; `P2025` → 404; generic re-throw; counts populated correctly. |
| `src/admin/categories/categories-admin.service.spec.ts:451–479` | `describe('cache invalidation gating')` — 409 path does not invalidate; 404 path does not invalidate. |
| `test/admin/categories.e2e-spec.ts:292–378` | US3 scenarios — referenced by 2 paths + 5 courses → 409 with exact counts; zero refs → 200; non-existent UUID → 404; only-paths case → `errors.courseCount: 0`. |

### 10.9 Related files

| File | Role |
|---|---|
| `src/admin/categories/categories-admin.controller.ts:54–57` | `@Delete(':id')` handler. |
| `src/admin/categories/categories-admin.service.ts:166–192` | `remove()` implementation. |
| `src/admin/categories/categories-admin.service.ts:204–216` | `isFKViolation()` helper — the dual-class match. |
| `src/admin/categories/categories-admin.service.ts:217–220` | `isPrismaP2025()` helper. |
| `src/common/filters/http-exception.filter.ts:75–93` | Object-shape `errors` passthrough — what makes the structured 409 body reach the client. |

---

## 11. Cross-cutting side-effects table

| Mutation | DB writes | Audit log entry | Cache invalidation |
|---|---|---|---|
| `POST /admin/categories` (success) | `INSERT INTO categories` | `outcome: 'success'`, `method: 'POST'` | yes |
| `POST` (validation 400 / 409) | none | `outcome: 'error'`, `statusCode: 4xx` | no |
| `PATCH /admin/categories/:id` (success) | `UPDATE categories` | `outcome: 'success'`, `method: 'PATCH'` | yes |
| `PATCH` (404 / 409 / 400) | none | `outcome: 'error'`, `statusCode: 4xx` | no |
| `DELETE /admin/categories/:id` (success) | `DELETE FROM categories` | `outcome: 'success'`, `method: 'DELETE'` | yes |
| `DELETE` (409 / 404) | none | `outcome: 'error'`, `statusCode: 4xx` | no |
| `GET /admin/categories` | none | none | no |
| `GET /admin/categories/:id` | none | none | no |

Audit log fields are documented in [audit-log-interceptor.md §4](./audit-log-interceptor.md). The interceptor records `req.route.path`, so the `route` field is always the matched **pattern** (e.g. `/api/v1/admin/categories/:id`) — UUIDs never leak.

---

## 12. Files involved

| File | Role |
|---|---|
| `src/admin/categories/categories-admin.module.ts` | Module wiring; **locally** registers `RolesGuard` + `AuditLogInterceptor` per FR-005a (§5.3). |
| `src/admin/categories/categories-admin.controller.ts` | 5 routes; `@Controller('admin/categories') @AdminEndpoint()` at the class level. |
| `src/admin/categories/categories-admin.service.ts` | Business logic for all 5 methods plus the `isFKViolation` / `isPrismaP2025` / `toDto` helpers. |
| `src/admin/categories/dto/create-category.dto.ts` | POST body. |
| `src/admin/categories/dto/update-category.dto.ts` | PATCH body. |
| `src/admin/categories/dto/list-categories-query.dto.ts` | GET-list query. |
| `src/admin/categories/dto/category-admin-response.dto.ts` | Output shape. |
| `src/common/filters/http-exception.filter.ts` | Object-shape `errors` passthrough (FR-026, lines 75–93). |
| `src/common/error-codes.enum.ts:25–28` | `CATEGORY_NOT_FOUND`, `CATEGORY_NAME_EXISTS`, `CATEGORY_SLUG_EXISTS`, `CATEGORY_IN_USE`. |
| `src/admin/admin.module.ts` | Wires `CategoriesAdminModule` into `AdminModule.imports`. |
| `prisma/schema.prisma` | Drops `description`/`icon` from `Category`; tightens `Path.category` and `Course.path` FKs to `Restrict`. |
| `prisma/migrations/20260502160429_drop_category_columns_and_restrict_content_fks/migration.sql` | The migration described in §3. |
| `prisma/seed.ts` | Two seed categories (no `description`/`icon` keys). |
| `src/admin/categories/categories-admin.service.spec.ts` | Service unit tests (see §6.8 / §7.8 / §8.8 / §9.8 / §10.8). |
| `src/common/filters/http-exception.filter.spec.ts` | 6 unit tests for the object-shape passthrough including a regression for the array path. |
| `test/admin/categories.e2e-spec.ts` | E2E for US1, US3, US4, US5, US6, US7 (US2 verified via the existing public e2e). |
| `test/content/categories/categories.controller.e2e-spec.ts` | Public e2e — must continue to pass against the trimmed response shape. |

---

## 13. Things NOT to change without coordination

- **The class-level `@AdminEndpoint()` decorator** on `CategoriesAdminController`. Removing it or downgrading to per-method silently exposes the route to anyone authenticated. The code-review checklist in [conventions.md §3](./conventions.md#3-code-review-checklist) catches this.
- **Local registration of `RolesGuard` and `AuditLogInterceptor` in `CategoriesAdminModule.providers` (FR-005a).** Removing them would break DI resolution at boot. See [research.md § Decision 6](../../specs/015-categories-admin-crud/research.md).
- **The dual Prisma error-class match in `isFKViolation`.** Both `PrismaClientKnownRequestError (P2003)` and `PrismaClientUnknownRequestError (SQLSTATE 23001)` MUST be caught. After the migration, the `Restrict` rejection comes through as the **Unknown** class — catching only `P2003` would silently 500.
- **The conflict resolution order on CREATE and PATCH.** Name first via `findFirst` (because `name` lacks `@unique`), then slug via `findUnique`. Never combine into a single `findFirst` with OR — the brief explicitly forbids it because Prisma does not guarantee deterministic ordering inside an OR.
- **The migration shape:** drop `description`/`icon` AND tighten `paths.categoryId` + `courses.pathId` FKs in a single migration. The four user-history cascades (`Certificate.path`, `Certificate.course`, `QuizAttempt.quiz`, `ProjectSubmission.project`) are explicitly **out of scope** — see §3.2.
- **The route prefix `admin/categories`** (kebab-case, plural) — the upcoming KAN-83 frontend pins on this exact path.
- **The `categories:all` cache key** — invalidated by every successful admin mutation, read by `CategoriesService.listAllPublic()` (KAN-26). Renaming it requires a paired update on both sides.
- **The doubly-nested response shape on the list endpoint** (`res.body.data.data`). The outer wrapping comes from the global response interceptor; the inner from the service's `{ data, meta }` paginated return. Any consumer reading the response must traverse both.

---

## 14. Change history

| Date | Ticket | Change |
|---|---|---|
| 2026-05-02 | KAN-82 | Initial implementation. 5 endpoints under `/api/v1/admin/categories`; migration drops `Category.description`/`Category.icon` and tightens `Path.category` + `Course.path` FKs from `Cascade` to `Restrict`. |
| 2026-05-02 | KAN-82 followup | Polish to register.md gold standard. Added document-level FK narrative + public-vs-admin boundary. Per-endpoint Summary, Edge cases, source-line citations, code blocks. Decision 6 link corrected. |
