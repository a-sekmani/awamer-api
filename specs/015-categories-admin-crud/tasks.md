---
description: "Task list for KAN-82 — BE Categories admin CRUD"
---

# Tasks: BE Categories admin CRUD (KAN-82)

**Input**: Design documents from `/specs/015-categories-admin-crud/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md — all present

**Tests**: REQUIRED. The spec's acceptance criteria explicitly call for service-layer unit tests for all 5 service methods, e2e coverage for all 7 user stories, and 4–5 unit tests for the `HttpExceptionFilter` extension including a regression test (see spec.md § Acceptance criteria).

**Organization**: Tasks are grouped by user story (US1–US7) so each story can be implemented and verified independently against `test/admin/categories.e2e-spec.ts`. The foundation work that all stories depend on is in Phase 2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — strictly different files, no dependencies on incomplete tasks.
- **[Story]**: User story label (US1…US7) on Phase 3+ tasks only.
- File paths are absolute relative to the repo root.

## Path Conventions

NestJS backend, single-project layout: `src/` for runtime code, `test/` for e2e specs, `prisma/` for schema and migrations, `docs/` for endpoint references.

---

## Phase 1: Setup

**Purpose**: Confirm the working tree is in the expected state before any code change.

- [X] T001 Re-confirm pre-flight diagnosis from `research.md` Decision 1 still holds: read `prisma/schema.prisma` lines 342–356 (Category columns), 380 (`Path.category onDelete: Cascade`), 412 (`Course.path onDelete: Cascade`); read `src/common/filters/http-exception.filter.ts` 35–73 (only array-shaped `errors` are emitted); read `src/content/categories/categories.service.ts` lines 1–3 (TODO comment present). Stop and report any drift before proceeding.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migration, schema edits, public-mapper trim, error codes, filter extension, and the empty admin module scaffold. Every user story depends on this phase being complete.

**⚠️ CRITICAL**: No US task can begin until every task in Phase 2 is checked off. Several US tasks are tests that exercise behavior introduced here.

### Schema and migration

- [X] T002 Edit `prisma/schema.prisma`: remove `description String?` and `icon String?` from `model Category` (lines 346–347); change `Path.category` relation (line 380) and `Course.path` relation (line 412) to `onDelete: Restrict`. Do not edit any other model.
- [X] T003 Generate the migration: `npx prisma migrate dev --name drop_category_columns_and_restrict_content_fks`. Verify the produced `prisma/migrations/<timestamp>_drop_category_columns_and_restrict_content_fks/migration.sql` matches the four steps in `contracts/migration.contract.md`. Run `npx prisma migrate status` and confirm "Database schema is up to date".
- [X] T004 [P] Edit `prisma/seed.ts`: remove `description` and `icon` keys from the two category seed records around lines 137–155 (`FIXTURE.categories.ai` and `FIXTURE.categories.software`). Do not modify any other seed data.

### Error codes

- [X] T005 [P] Edit `src/common/error-codes.enum.ts`: add `CATEGORY_NOT_FOUND`, `CATEGORY_NAME_EXISTS`, `CATEGORY_SLUG_EXISTS`, `CATEGORY_IN_USE` to the existing enum (place them in a `// Categories (admin)` block, before the `// General` group).

### HttpExceptionFilter extension (cross-cutting fix)

- [X] T006 Extend `src/common/filters/http-exception.filter.ts` per `contracts/http-exception-filter-passthrough.contract.md`: inside the existing `if (typeof exceptionResponse === 'object' && exceptionResponse !== null)` branch, after the array-handling block for `resp.message`, add the new conditional that assigns `body.errors = resp.errors` when (a) `body.errors` is undefined, (b) `resp.errors` is non-null/undefined, (c) `resp.errors` is an object, (d) `resp.errors` is not an array. Do NOT modify `PASSTHROUGH_KEYS`. Do NOT change the array path.
- [X] T007 [P] Add 5 unit tests to `src/common/filters/http-exception.filter.spec.ts` per `contracts/http-exception-filter-passthrough.contract.md` § "Required test coverage": (1) passes object-shaped `errors`, (2) regression — array-shape `message` still works, (3) `null` errors dropped, (4) `undefined` errors dropped, (5) primitive errors dropped. Optional 6th test: array errors win when both shapes present.

### Public KAN-26 mapper trim (US2's actual implementation work)

- [X] T008 [P] Edit `src/content/categories/dto/category-response.dto.ts`: remove the `description!: string | null;` and `icon!: string | null;` fields. Other fields unchanged.
- [X] T009 Edit `src/content/categories/categories.service.ts`: remove `description: row.description,` and `icon: row.icon,` from the mapper at lines 41–42. Update the file-header TODO at lines 1–3 to read `// KAN-82: Admin Categories CRUD invokes this.cache.del(CacheKeys.categories.all()) on every successful mutation. Removing this comment is fine once KAN-82 ships.` (or simply delete the comment block — implementer's call). Depends on T008.
- [X] T010 [P] Edit `src/content/categories/categories.service.spec.ts`: remove every assertion against `description` and `icon` (lines 11, 12, 20, 21, 61, 62 in the current file). Do not change other assertions or the test structure.
- [X] T011 [P] Edit `test/content/categories/categories.controller.e2e-spec.ts`: remove every assertion against `description` and `icon` in the response shape. Do not add new assertions. The trimmed shape MUST keep the existing filter (`status = ACTIVE`), ordering (`order ASC`), `pathCount`, `courseCount` assertions intact.

### CategoriesAdminModule scaffold

- [X] T012 [P] Create `src/admin/categories/dto/create-category.dto.ts` per `data-model.md` § 2.1: `name` and `slug` fields, `class-validator` decorators (`@IsString`, `@MinLength(1)`, `@MaxLength(200)`, `@Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)` on slug), `@Transform(trim)` on both. Do not declare `order` or `status`.
- [X] T013 [P] Create `src/admin/categories/dto/update-category.dto.ts` per `data-model.md` § 2.2: all four fields (`name`, `slug`, `order`, `status`) optional with the same validators as create plus `@IsInt + @Min(0)` for order and `@IsEnum(CategoryStatus)` for status (with the message `'status must be one of: ACTIVE, HIDDEN'`).
- [X] T014 [P] Create `src/admin/categories/dto/list-categories-query.dto.ts` per `data-model.md` § 2.3: `page` (default 1, min 1), `limit` (default 20, min 1, max 100), `search` (optional, max 200, trimmed), `status` (optional, `@IsEnum(CategoryStatus)`). Use `@Type(() => Number)` on `page`/`limit` so query strings coerce.
- [X] T015 [P] Create `src/admin/categories/dto/category-admin-response.dto.ts` per `data-model.md` § 2.4: 9 fields (`id`, `name`, `slug`, `order`, `status`, `createdAt`, `updatedAt`, `pathCount`, `courseCount`). Plain class with `!` non-null assertions; no decorators (output shape only).
- [X] T016 Create `src/admin/categories/categories-admin.service.ts` skeleton: `@Injectable()`, constructor injecting `PrismaService` and `CacheService`, five empty method signatures (`create`, `list`, `get`, `update`, `remove`) returning typed promises. Each method body throws `new Error('not implemented')` for now. Depends on T012–T015.
- [X] T017 Create `src/admin/categories/categories-admin.controller.ts` per `data-model.md` § 4: `@Controller('admin/categories') @AdminEndpoint()` at the class level; five method handlers (`create`, `list`, `get`, `update`, `remove`); use `ParseUUIDPipe` on `:id`. Depends on T016.
- [X] T018 Create `src/admin/categories/categories-admin.module.ts` per `data-model.md` § 4a: `imports: [PrismaModule, CacheModule, AuthModule]`, `controllers: [CategoriesAdminController]`, `providers: [CategoriesAdminService, RolesGuard, AuditLogInterceptor]`. **The local registration of `RolesGuard` and `AuditLogInterceptor` is mandatory per FR-005a** — see `research.md` Decision 6 for why. Depends on T016, T017.
- [X] T019 Edit `src/admin/admin.module.ts`: add `CategoriesAdminModule` to the `imports` array. Keep `[AuthModule]` first, append `CategoriesAdminModule`. Do NOT modify `controllers`, `providers`, or `exports`. Depends on T018.

**Checkpoint**: After Phase 2 the app boots, the migration is applied, the public KAN-26 endpoint still works, the filter accepts object-shape errors, and the admin module is wired but has no working logic. All five admin endpoints respond with `Error: not implemented` (500) — that's expected. Run `npm run start:dev` and `curl -i http://localhost:3001/api/v1/admin/categories` with admin JWT — expect 500 with the placeholder message; without JWT expect 401.

---

## Phase 3: User Story 1 — Admin creates and lists categories (Priority: P1) 🎯 MVP

**Goal**: An authenticated admin can POST a new category and GET it back in a paginated, search-able, status-filterable list ordered by `createdAt DESC` with inline `pathCount` and `courseCount`.

**Independent Test**: With an admin JWT, POST `{ "name": "AI", "slug": "ai" }`, then GET `/admin/categories`. The response includes the new category with `pathCount: 0`, `courseCount: 0`. Filter scenarios for status work as specified in spec.md US1 acceptance scenarios 5–8.

### Implementation

- [X] T020 [US1] Implement `CategoriesAdminService.create(dto)` in `src/admin/categories/categories-admin.service.ts`: name pre-check via `prisma.category.findFirst({ where: { name: dto.name } })` → if found throw `ConflictException({ errorCode: ErrorCode.CATEGORY_NAME_EXISTS, message: 'Category name already exists' })`; slug pre-check via `prisma.category.findUnique({ where: { slug: dto.slug } })` → if found throw `ConflictException({ errorCode: ErrorCode.CATEGORY_SLUG_EXISTS, ... })`; then `prisma.category.create({ data: { name, slug } })` (do NOT pass `order` or `status` — column defaults take over); fetch with `_count` for the response (or attach `pathCount: 0, courseCount: 0` directly since this is a fresh record); return mapped `CategoryAdminResponseDto`. Cache invalidation is added later in US5.
- [X] T021 [US1] Implement `CategoriesAdminService.list(query)` in the same file: build `where` from `query.search` (using `OR: [{ name: { contains, mode: 'insensitive' } }, { slug: { contains, mode: 'insensitive' } }]`) and `query.status` (when present); count + findMany in parallel via `prisma.$transaction([prisma.category.count({ where }), prisma.category.findMany({ where, include: { _count: { select: { paths: true, courses: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit })])`; map rows to `CategoryAdminResponseDto`; return `{ data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }`.

### Tests

- [X] T022 [US1] Add unit tests for `create` in `src/admin/categories/categories-admin.service.spec.ts`: success returns mapped DTO with counts 0/0; name conflict throws `ConflictException CATEGORY_NAME_EXISTS`; slug conflict throws `ConflictException CATEGORY_SLUG_EXISTS`; both name AND slug colliding → name wins (slug check is not reached — assert via mock call count). Use `jest.fn()` mocks for `PrismaService` and `CacheService`.
- [X] T023 [US1] Add unit tests for `list` in the same spec file: pagination computes `totalPages` correctly; `search` builds the OR/contains/insensitive where clause; `status=ACTIVE` filters; absent `status` does not add a where clause; rows map to DTO with `_count` projected to `pathCount` / `courseCount`; ordering is `createdAt DESC`. Tests live in same file as T022 — sequential, not parallel with T022.
- [X] T024 [P] [US1] Add e2e tests for US1 in `test/admin/categories.e2e-spec.ts`. Cover the 8 US1 acceptance scenarios plus 2 DTO-validation smoke scenarios that prove the global `ValidationPipe` is wired into the admin endpoints. Acceptance: (1) POST creates; (2) created category appears in GET; (3) pagination meta fields populated; (4) search narrows; (5) no `status` returns ACTIVE+HIDDEN both; (6) `status=ACTIVE` filters; (7) `status=HIDDEN` filters; (8) invalid `status` (e.g. `?status=invalid`) returns 400 `VALIDATION_FAILED`. Validation smoke: (9) POST `{ name: "   ", slug: "ai" }` (whitespace-only name) → 400 `VALIDATION_FAILED`; (10) POST `{ name: "AI", slug: "Bad Slug" }` (malformed slug) → 400 `VALIDATION_FAILED`. Seed minimal fixtures inline (`prisma.category.createMany`) and clean them up in `afterEach`. Use admin JWT cookie helper (mirror existing e2e specs that use admin auth).

**Checkpoint**: US1 ships independently. The admin can curate the catalog through create + list. Cache invalidation, partial update, detail view, and FK-protected delete are still missing — those land in subsequent stories.

---

## Phase 4: User Story 2 — Migration applies cleanly + public preserved (Priority: P1)

**Goal**: The migration introduced in Phase 2 applies cleanly to a fresh database AND the existing public KAN-26 e2e suite passes against the trimmed response shape.

**Independent Test**: Run `npx prisma migrate reset --force && npx prisma migrate dev` against a dev database — expect "Database schema is up to date". Then `npm run test:e2e -- test/content/categories` — expect zero failures. Then `grep -rn "category\\.\\(description\\|icon\\)\\|description: row\\.description\\|icon: row\\.icon" src/ test/ prisma/` — expect zero matches.

### Verification

- [X] T025 [US2] Verify the public KAN-26 endpoint still passes: run `npm run test:e2e -- test/content/categories/categories.controller.e2e-spec.ts` and confirm every test passes against the trimmed response shape. If any assertion still references `description` or `icon`, remove it (T011 should already have done this — re-check).
- [X] T026 [US2] Verify the public service unit spec passes: run `npm test -- src/content/categories/categories.service.spec.ts` and confirm zero failures. T010 should have already removed the dropped-field assertions — re-check.
- [X] T027 [US2] Run the residual-references grep: `grep -rn "category\.\(description\|icon\)\|description: row\.description\|icon: row\.icon" src/ test/ prisma/`. Expect zero matches. If matches remain, remove them (do not preserve via `_var` rename — delete entirely).

**Checkpoint**: US2 ships. The migration is safe; the public marketing endpoint is unaffected by KAN-82's changes beyond losing the two dropped fields.

---

## Phase 5: User Story 3 — Delete with FK protection (Priority: P1)

**Goal**: Deleting a category that is referenced by paths or courses returns 409 `CATEGORY_IN_USE` with `errors: { pathCount, courseCount }` populated; deleting an unreferenced category succeeds with `{ ok: true }`; deleting a non-existent category returns 404 `CATEGORY_NOT_FOUND`.

**Independent Test**: Seed a category with 2 paths and 5 courses, DELETE via admin → 409 with exact `{ pathCount: 2, courseCount: 5 }`. Then create a new category with no references and DELETE → 200 + `{ ok: true }`. Both branches of `isFKViolation` (P2003 Known and SQLSTATE-23001 Unknown) MUST be unit-tested.

### Implementation

- [X] T028 [US3] Implement `CategoriesAdminService.remove(id)` in `src/admin/categories/categories-admin.service.ts` per `contracts/delete-fk-violation.contract.md`: `try { await prisma.category.delete({ where: { id } }) }`; on FK violation, run `Promise.all([path.count, course.count])` and throw `ConflictException({ errorCode: CATEGORY_IN_USE, message: 'Category is in use', errors: { pathCount, courseCount } })`; on `P2025` throw `NotFoundException({ errorCode: CATEGORY_NOT_FOUND, message: 'Category not found' })`; otherwise re-throw.
- [X] T029 [US3] Add private helpers `isFKViolation(e: unknown): boolean` and `isPrismaP2025(e: unknown): boolean` to the same service file. `isFKViolation` returns `true` when (a) `e instanceof PrismaClientKnownRequestError && e.code === 'P2003'` OR (b) `e instanceof PrismaClientUnknownRequestError && /23001/.test(e.message)`. Import both classes from `@prisma/client/runtime/library`.

### Tests

- [X] T030 [US3] Add unit tests for `remove` in `src/admin/categories/categories-admin.service.spec.ts`: success with no references; 409 when Prisma raises `P2003` `KnownRequestError`; 409 when Prisma raises `Unknown` error with SQLSTATE 23001 in message; 404 when Prisma raises `P2025`; populates `errors.pathCount` and `errors.courseCount` correctly; generic re-throw of unrelated errors. (Cache invalidation gating on success-only is added in US5; do not assert it here.)
- [X] T031 [P] [US3] Add e2e tests for US3 in `test/admin/categories.e2e-spec.ts`: (a) seeded category referenced by 2 paths and 5 courses → 409 + `errorCode: CATEGORY_IN_USE` + `errors: { pathCount: 2, courseCount: 5 }`; (b) seeded category with 0 paths and 0 courses → 200 + `{ data: { ok: true }, message: 'Success' }`; (c) DELETE non-existent UUID → 404 + `errorCode: CATEGORY_NOT_FOUND`; (d) seeded category referenced only by paths (no courses) → 409 with `errors.courseCount: 0`. Re-seed the FK fixtures inline so the test is self-contained.

**Checkpoint**: US3 ships. The high-stakes FK-protection contract is verified at both unit and e2e layers; both Prisma error classes proven to map to 409.

---

## Phase 6: User Story 4 — Foundation invariants hold (Priority: P1)

**Goal**: Every admin endpoint enforces auth (401 anonymous), role (403 + `INSUFFICIENT_ROLE` for learner), and emits exactly one structured audit log entry per successful mutation. GETs and failed mutations emit zero entries.

**Independent Test**: Hit each of the five endpoints with three identities (anon / learner JWT / admin JWT). Spy on the `Logger` instance scoped to the `AdminAudit` context; assert call count after each request.

### Tests

- [X] T032 [P] [US4] Add e2e tests for US4 in `test/admin/categories.e2e-spec.ts`: (1) anonymous request to each of 5 endpoints → 401; (2) learner JWT (no ADMIN role) → 403 + `errorCode: INSUFFICIENT_ROLE`; (3) admin JWT to a successful POST → exactly one audit log entry with the expected fields (`userId`, `userEmail`, `roles: ['ADMIN']`, `action: 'POST /api/v1/admin/categories'`, `outcome: 'success'`); (4) admin JWT to a successful GET → zero audit entries; (5) admin JWT to a 409-rejected DELETE → one audit entry with `outcome: 'error'`, `statusCode: 409` (per the existing AuditLogInterceptor behavior — the spec invariant about "no entry on failed mutation" refers to *no success-flavored entry*; the interceptor still logs the error-flavored entry). Use a `Logger` spy via NestJS's `@Logger.overrideLogger()` or the `LoggerService` injection pattern.

**Checkpoint**: US4 ships. The KAN-78 foundation is verified to work end-to-end on a real per-entity module — the precedent for KAN-85, KAN-88, KAN-91, KAN-94, KAN-97.

---

## Phase 7: User Story 5 — Cache freshness on every successful mutation (Priority: P2)

**Goal**: Every successful POST / PATCH / DELETE invalidates the public `categories:all` Redis key BEFORE returning the admin response. Failed mutations (validation 400, 409, 404) do NOT invalidate.

**Independent Test**: Prime the cache via public GET (`curl /api/v1/categories`); confirm the key exists in Redis (`redis-cli GET categories:all`); admin mutates; confirm the key is gone before the admin response returns; mutate failingly (e.g. POST a duplicate slug); confirm the key was NOT touched.

### Implementation

- [X] T033 [US5] Wire `await this.cache.del(CacheKeys.categories.all())` into `src/admin/categories/categories-admin.service.ts` at the end of every successful `create` (after `prisma.create`), every successful `update` (after `prisma.update`), and every successful `remove` (between `prisma.delete` and the `return { ok: true }`). Place the call OUTSIDE any `try/catch` so it runs only on the success path — failed mutations throw before reaching it.

### Tests

- [X] T034 [US5] Add unit tests for cache invalidation in `src/admin/categories/categories-admin.service.spec.ts`: success POST calls `cache.del('categories:all')` exactly once; success PATCH same; success DELETE same; validation error / 409 / 404 do NOT call `cache.del` (assert via mock call count = 0). Spread these assertions across the existing per-method test suites or add a dedicated `describe('cache invalidation', ...)` block.
- [X] T035 [P] [US5] Add an e2e test for US5 in `test/admin/categories.e2e-spec.ts`: prime the cache by hitting public `/categories`; assert the `categories:all` key exists in Redis (use the existing `RedisService` or test harness); admin POSTs successfully; assert the key is now `null`; admin POSTs again with a duplicate slug → 409; assert the key is still `null` (was already evicted) AND that no extra Redis activity happened beyond the expected delete on the first POST.

**Checkpoint**: US5 ships. Read-after-write window between admin and public is closed.

---

## Phase 8: User Story 6 — Admin updates a category with partial fields (Priority: P2)

**Goal**: PATCH `/admin/categories/:id` updates only the supplied fields; conflicts on `name` first, then `slug`; 404 on unknown UUID; rejects invalid `status` enum values with 400.

**Independent Test**: Create a category, PATCH only `name`; confirm `slug`, `order`, `status` unchanged. PATCH another category to a colliding `name` → 409 `CATEGORY_NAME_EXISTS`. PATCH with both `name` and `slug` colliding against different rows → 409 `CATEGORY_NAME_EXISTS` (name wins; slug check skipped — assert via mock call count in unit test).

### Implementation

- [X] T036 [US6] Implement `CategoriesAdminService.update(id, dto)` in `src/admin/categories/categories-admin.service.ts`: first run `prisma.category.findUnique({ where: { id } })` → if null throw `NotFoundException({ errorCode: CATEGORY_NOT_FOUND, message: 'Category not found' })`; if `dto.name` provided, run `findFirst({ where: { name: dto.name, NOT: { id } } })` → throw `CATEGORY_NAME_EXISTS` if found; if `dto.slug` provided AND name didn't conflict, run `findUnique({ where: { slug: dto.slug } })` → throw `CATEGORY_SLUG_EXISTS` if found and `result.id !== id`; then `prisma.category.update({ where: { id }, data: dto })` and return mapped DTO via the same `_count`-include pattern as `list`. Cache invalidation appended (US5 task already covers this).

### Tests

- [X] T037 [US6] Add unit tests for `update` in `src/admin/categories/categories-admin.service.spec.ts`: success with single-field PATCH preserves other fields; 404 on unknown UUID; name conflict against another row → 409 `CATEGORY_NAME_EXISTS`; slug conflict against another row → 409 `CATEGORY_SLUG_EXISTS`; both `name` AND `slug` colliding (different rows) → name wins (slug `findUnique` is NOT called — assert via mock call count); patching to the same row's own `name`/`slug` is allowed (no conflict).
- [X] T038 [P] [US6] Add e2e tests for US6 in `test/admin/categories.e2e-spec.ts`: PATCH single field preserves others; 409 `CATEGORY_NAME_EXISTS` on name collision; 409 `CATEGORY_NAME_EXISTS` when both name and slug collide (with two different rows); 400 `VALIDATION_FAILED` on `?body { status: "INVALID_VALUE" }` (case-sensitive — `?body { status: "active" }` lowercase also rejected); 404 on unknown UUID; empty body `{}` is a no-op success.

**Checkpoint**: US6 ships. Admin editing flow complete.

---

## Phase 9: User Story 7 — Detail view (Priority: P2)

**Goal**: GET `/admin/categories/:id` returns 200 with the category data plus computed `pathCount` and `courseCount`; 404 for unknown UUIDs.

**Independent Test**: Seed a category with 3 paths and 7 courses; GET; expect 200 with `pathCount: 3` and `courseCount: 7`. GET an unknown UUID; expect 404 `CATEGORY_NOT_FOUND`.

### Implementation

- [X] T039 [US7] Implement `CategoriesAdminService.get(id)` in `src/admin/categories/categories-admin.service.ts`: `prisma.category.findUnique({ where: { id }, include: { _count: { select: { paths: true, courses: true } } } })` → if null throw `NotFoundException({ errorCode: CATEGORY_NOT_FOUND, message: 'Category not found' })`; otherwise map to `CategoryAdminResponseDto` (same mapper as `list`). No cache mutation on read.

### Tests

- [X] T040 [US7] Add unit tests for `get` in `src/admin/categories/categories-admin.service.spec.ts`: success returns DTO with non-zero counts when seeded; 404 on null findUnique result.
- [X] T041 [P] [US7] Add e2e tests for US7 in `test/admin/categories.e2e-spec.ts`: seed a category with N paths and M courses; GET `/admin/categories/:id` returns 200 with exact `pathCount: N`, `courseCount: M`; GET with unknown valid UUID returns 404 `CATEGORY_NOT_FOUND`; GET with non-UUID `:id` (e.g. `not-a-uuid`) returns 400 `VALIDATION_FAILED` (from `ParseUUIDPipe`).

**Checkpoint**: US7 ships. All 7 user stories complete.

---

## Phase 10: Polish & Cross-Cutting

**Purpose**: Final verification + documentation.

- [X] T042 [P] Create `docs/admin/categories.md` mirroring the per-endpoint documentation style established by KAN-78 (one section per endpoint with: method + path, request body example, success response example, error responses with `errorCode` table, audit-log behavior note, cache-invalidation note where relevant). Reference `contracts/categories-admin.openapi.yaml` as the canonical machine-readable shape.
- [X] T043 Run `npm run lint` and confirm output shows the 16 pre-existing errors (from the audit referenced in the brief) and zero new errors. Investigate any new error before proceeding.
- [X] T044 Run `npx tsc -p tsconfig.build.json --noEmit` and confirm zero errors.
- [X] T045 Run `npm test` and confirm at least 575 passing unit tests with zero failures (KAN-78 baseline + the new unit specs from this PR).
- [X] T046 Run `npm run test:e2e` and confirm at least 332 passing e2e tests with zero failures, including the new `test/admin/categories.e2e-spec.ts`.
- [X] T047 [P] Run residual-references grep one more time: `grep -rn "category\.\(description\|icon\)\|description: row\.description\|icon: row\.icon" src/ test/ prisma/`. Expect zero matches.
- [X] T048 [P] Verify the Postgres FK actions landed correctly. Connect via `psql` or your tool and run the query in `contracts/migration.contract.md` § "Verification" step 5. Both rows should show `confdeltype = 'r'` (RESTRICT).
- [X] T049 Manual smoke: run the curl walkthrough in `quickstart.md` § 4 and § 5. Confirm the success and conflict envelopes match the documented shapes exactly.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → no dependencies; pre-flight diagnosis only.
- **Foundational (Phase 2)** → depends on Phase 1; BLOCKS every user story.
- **US1 (Phase 3)** → depends on Phase 2; no dependency on other stories.
- **US2 (Phase 4)** → depends on Phase 2 (the migration + public-mapper trim landed there). US2's tasks are verification-only; no implementation.
- **US3 (Phase 5)** → depends on Phase 2 (filter extension is required for the 409 `errors` shape) and on T020 from US1 (DELETE needs the service file to exist with at least the create/list scaffold). Otherwise independent of US1's behavior.
- **US4 (Phase 6)** → depends on Phase 2 + at least one mutating endpoint from US1 or US3 to spy on. In practice runs after US3 because the e2e test exercises 401/403 across all five endpoints.
- **US5 (Phase 7)** → depends on Phase 2 + the three mutating service methods (US1's create, US3's remove, US6's update). Cache invalidation cannot land before all three exist; safest order is US1 → US3 → US6 → US5.
- **US6 (Phase 8)** → depends on Phase 2 + the conflict-checking pattern proven in US1 (T020).
- **US7 (Phase 9)** → depends on Phase 2 + the `_count` mapper from US1 (T021).
- **Polish (Phase 10)** → depends on every prior phase.

### Within-story ordering

- Implementation task(s) before unit tests for the same method (when the unit test would otherwise fail trivially against the not-implemented stub). Unit tests can be written first (TDD-style) at the developer's discretion, but they must end up green before the e2e task runs.
- E2E tests for a story run after the implementation tasks for that story.

### Parallel opportunities

Within a single phase, [P] tasks touch different files and have no dependencies on incomplete tasks:

- Phase 2 [P]: T004, T005, T007, T008, T010, T011, T012, T013, T014, T015 — most can run concurrently. T002 → T003 is the only mandatory sequential pair early; T009 depends on T008; T016 → T017 → T018 → T019 form the module-construction chain.
- Phase 3 [P]: T024 (e2e) parallel with T022 / T023 (which are in the same spec file, so not [P] with each other).
- Phase 5–9 [P]: each story's e2e task is in its own file region but the spec files (`*.service.spec.ts` / `categories.e2e-spec.ts`) accumulate, so within-story parallelism is mostly between unit-test and e2e-test tasks.

### Recommended sequencing if working solo

1. Phase 1 (T001).
2. Phase 2 in this order: T002 → T003, then T004 / T005 / T007 / T008 (concurrent in your editor), then T009 / T010 / T011 / T012–T015 / T006 (any order), then T016 → T017 → T018 → T019.
3. Phase 3 (US1 — MVP): T020 → T021 → T022/T023 → T024.
4. Phase 4 (US2): T025 → T026 → T027 (these are mostly `npm` invocations).
5. Phase 5 (US3): T028 + T029 → T030 → T031.
6. Phase 6 (US4): T032 (this is pure-test).
7. Phase 7 (US5): T033 → T034 → T035.
8. Phase 8 (US6): T036 → T037 → T038.
9. Phase 9 (US7): T039 → T040 → T041.
10. Phase 10 polish: T042 → T043 → T044 → T045 → T046 → T047 → T048 → T049.

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1: pre-flight (T001).
2. Phase 2: every foundational task (T002–T019).
3. Phase 3: US1 (T020–T024).
4. STOP and validate: an admin can POST and GET categories end-to-end. Audit logs emit. Cache invalidation, FK-protected delete, partial update, and detail are still missing — they're not blocking the MVP.

### Incremental Delivery (preferred for this PR — single PR contains everything)

1. Foundation ready (T001–T019).
2. Add US1 → ship internally → run T024 e2e and confirm green.
3. Add US2 → run T025–T027 → confirm public e2e still green.
4. Add US3 → run T031 → confirm FK protection works on real data.
5. Add US4 → run T032 → confirm auth + audit invariants hold.
6. Add US5 → run T035 → confirm cache freshness.
7. Add US6 → run T038 → confirm partial update.
8. Add US7 → run T041 → confirm detail view.
9. Polish (T042–T049).

### Stop-and-report triggers (per the brief)

If implementation hits any of the following, stop and report rather than working around it:

- T003 `prisma migrate dev` produces SQL that does not match `contracts/migration.contract.md` (e.g., touches a different FK or generates a backfill).
- T019 admin module wiring causes `Nest can't resolve dependencies of CategoriesAdminController` at boot — this would mean `RolesGuard` or `AuditLogInterceptor` weren't registered locally per FR-005a despite T018; check the file before reporting.
- T028 (`remove`) catches only one Prisma error class and 500s on the `Restrict` rejection path — `isFKViolation` is missing the Unknown branch.
- T011 / T025 reveal that the public e2e suite has assertions on dropped fields that weren't covered by T011 — fix in scope, but flag if the count is large.
- Any `npm run lint` count delta beyond zero new errors.

---

## Notes

- [P] = different file, no dependency on incomplete task. Within-spec-file additions (e.g., adding tests to `categories-admin.service.spec.ts` across multiple stories) are NOT [P] with each other.
- Each story is independently testable by running the e2e task for that story after the foundation + that story's implementation are in place.
- The brief's process-discipline rule (no commits between phases) holds; commit only when explicitly told to after `/speckit.implement` completes.
- KAN-100's expanded scope (foundation doc fixes, integration test for sub-module pattern) is NOT executed in this PR — it's tracked separately. Reference: spec.md § Known follow-ups.
