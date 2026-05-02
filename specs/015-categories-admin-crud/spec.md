# Feature Specification: BE Categories admin CRUD (KAN-82)

**Feature Branch**: `015-categories-admin-crud`
**Created**: 2026-05-02
**Status**: Draft
**Input**: User description: BE Categories admin CRUD (KAN-82) — full admin CRUD over the `Category` entity built on top of the KAN-78 admin foundation, including a migration that drops the unused `description`/`icon` columns and tightens `Path.category` and `Course.path` foreign keys from `Cascade` to `Restrict`, an infrastructure fix to `HttpExceptionFilter` so that object-shaped `errors` payloads are passed through, and Redis cache invalidation for the public categories endpoint on every successful admin mutation.

## Pre-flight Verification *(performed before drafting)*

The brief mandated a "stop and report" if any premise differed from live state. All five preconditions were verified against the working tree on `master` before this branch was cut:

| Premise | Result | Source |
|---|---|---|
| `Category` model has `id`, `name`, `slug @unique`, `description?`, `icon?`, `order`, `status`, `createdAt`, `updatedAt`, plus relations to `Path` and `Course` | ✅ matches | `prisma/schema.prisma` lines 342–356 |
| `Path.category` is `onDelete: Cascade` (must be tightened to `Restrict`) | ✅ confirmed | `prisma/schema.prisma` line 380 |
| `Course.path` is `onDelete: Cascade` (must be tightened to `Restrict`) | ✅ confirmed | `prisma/schema.prisma` line 412 |
| `HttpExceptionFilter` only emits `errors` when `resp.message` is an array; non-array `resp.errors` payloads are silently dropped | ✅ confirmed | `src/common/filters/http-exception.filter.ts` lines 46–73 (no `resp.errors` branch) |
| `categories.service.ts` carries a `TODO(KAN-?-admin-categories)` comment requiring cache invalidation on admin mutations | ✅ confirmed | `src/content/categories/categories.service.ts` lines 1–3 |

`CategoryStatus` enum values were also confirmed: `ACTIVE`, `HIDDEN` (`schema.prisma` line 53). One minor wording deviation from the brief is recorded in the Assumptions section: the brief implied 200-character lengths "match the existing column type", but Prisma `String` maps to PostgreSQL `text` (unbounded); 200 is therefore enforced at the DTO layer only, not at the column.

## Clarifications

### Session 2026-05-02

- Q: Does the admin LIST endpoint include HIDDEN categories by default, and should there be a `status` query filter? → A: Show ALL statuses by default (ACTIVE and HIDDEN), ordered by `createdAt DESC`. Optional `?status=ACTIVE` or `?status=HIDDEN` narrows the result. Any other value returns 400 `VALIDATION_FAILED` with the offending value named in `errors[]`. The param is case-sensitive and must match the Prisma enum exactly. Default `createdAt DESC` ordering applies regardless of status filter. Rationale: aligns with KAN-83 wireframes (which include a "الحالة" status column), keeps KAN-84 frontend implementation simple, matches industry admin-list precedent (WordPress, Shopify, Stripe, Notion).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin creates and lists categories (Priority: P1)

The administrator manages the catalog's top-level taxonomy. Without create/list, no other admin entity downstream (paths, courses) has a place to attach. This is the smallest demonstrable slice that proves the admin foundation works for a real entity.

**Why this priority**: This is the MVP. Until create + list works, no admin can curate the catalog at all. It also exercises the full foundation stack (`@AdminEndpoint()`, `RolesGuard`, `AuditLogInterceptor`) end-to-end on a real entity for the first time.

**Independent Test**: An authenticated admin POSTs a new category, then GETs the list, and sees the new category with `pathCount: 0` and `courseCount: 0` ordered by `createdAt DESC`. No other story (cache invalidation, FK protection, edit, delete, detail) needs to be present for this to deliver value.

**Acceptance Scenarios**:

1. **Given** I am authenticated as an admin and zero categories exist, **When** I POST `{ name: "الذكاء الاصطناعي", slug: "ai" }`, **Then** the response is 201 with the created category and a server-assigned UUID.
2. **Given** the category from step 1 exists, **When** I GET `/admin/categories`, **Then** the response contains that category in a paginated payload with `pathCount: 0` and `courseCount: 0`, ordered by `createdAt DESC`.
3. **Given** more than 20 categories exist, **When** I GET `/admin/categories?page=2&limit=20`, **Then** I receive the second page with `meta.total`, `meta.page`, `meta.limit`, `meta.totalPages` populated.
4. **Given** five categories exist with names "AI", "Cybersecurity", "Cloud", "DevOps", "Networking", **When** I GET `/admin/categories?search=cy`, **Then** "Cybersecurity" is included and the four non-matching are not.
5. **Given** two ACTIVE and one HIDDEN category exist, **When** I GET `/admin/categories` with no `status` filter, **Then** the response includes all three.
6. **Given** the same dataset, **When** I GET `/admin/categories?status=ACTIVE`, **Then** the response includes only the two ACTIVE categories.
7. **Given** the same dataset, **When** I GET `/admin/categories?status=HIDDEN`, **Then** the response includes only the one HIDDEN category.
8. **Given** any dataset, **When** I GET `/admin/categories?status=invalid` (or `archived`, lowercase `active`, etc.), **Then** the response is 400 with `errorCode: VALIDATION_FAILED` and the offending value named in `errors[]`.

### User Story 2 - Migration applies cleanly and the public endpoint stays passing (Priority: P1)

The migration drops two columns and tightens two foreign keys in a single step. If anything regresses for the public `GET /categories` endpoint that the marketing site depends on, the deploy is blocked.

**Why this priority**: This is a gating constraint, not a feature. KAN-26's public endpoint is already in production for the marketing site; if its contract or behavior breaks (filter, ordering, or response shape beyond the dropped fields), the whole PR has to revert.

**Independent Test**: Run `prisma migrate dev` against a fresh database, run `prisma migrate status` to confirm "Database schema is up to date", and run the existing public categories e2e tests — they must all pass with the trimmed response shape (no `description`, no `icon`).

**Acceptance Scenarios**:

1. **Given** a fresh database with the previous schema, **When** `prisma migrate dev` runs, **Then** the migration applies without errors and `prisma migrate status` reports up-to-date.
2. **Given** the migration has applied, **When** the existing public-categories e2e suite runs, **Then** every test passes against the trimmed response (only `id`, `name`, `slug`, `pathCount`, `courseCount` exposed).
3. **Given** the migration has applied, **When** any code path queries `category.description` or `category.icon`, **Then** TypeScript fails to compile (column dropped from Prisma client types).

### User Story 3 - Delete is blocked when the category is in use (Priority: P1)

A category referenced by paths or courses must not be deletable, both for the admin's own benefit (preventing accidental catalog damage) and to verify the FK tightening landed correctly. This is the highest-stakes data-integrity behavior in the ticket.

**Why this priority**: The original schema had `Cascade` on `Path.category`, which would have silently deleted entire learning hierarchies (paths, courses, sections, lessons, content, enrollments, progress, certificates) on a single admin click. This story is the regression test that proves the bug is fixed and stays fixed.

**Independent Test**: Seed two paths and five courses pointing at one category; admin DELETEs the category; response is 409 with `errorCode: CATEGORY_IN_USE` and `errors: { pathCount: 2, courseCount: 5 }`; row remains in the database.

**Acceptance Scenarios**:

1. **Given** a category referenced by 2 paths and 5 courses, **When** admin DELETEs `/admin/categories/:id`, **Then** the response is 409 with `errorCode: CATEGORY_IN_USE` and `errors: { pathCount: 2, courseCount: 5 }`, and the category row still exists.
2. **Given** a category with no paths and no courses, **When** admin DELETEs `/admin/categories/:id`, **Then** the response is 200 (matching project convention used elsewhere in admin endpoints) and the row is removed.
3. **Given** a non-existent UUID, **When** admin DELETEs `/admin/categories/:id`, **Then** the response is 404 with `errorCode: CATEGORY_NOT_FOUND`.
4. **Given** a category referenced only by paths (no courses), **When** admin DELETEs it, **Then** the response is 409 with `errors: { pathCount: N, courseCount: 0 }`. (Verifies both possible Prisma error classes are caught — see Functional Requirement FR-018.)

### User Story 4 - Foundation invariants hold (Priority: P1)

Every admin endpoint must enforce auth+role and emit one structured audit log entry per successful mutation. If the foundation isn't holding, every per-entity admin module that comes after KAN-82 will inherit broken behavior.

**Why this priority**: This is the validation that the KAN-78 foundation works in production for a real module. KAN-85, KAN-88, KAN-91, KAN-94, KAN-97 all clone this pattern. Any drift here amplifies across five future tickets.

**Independent Test**: Hit each of the five endpoints with three identities (anonymous, learner, admin); confirm 401, 403+`INSUFFICIENT_ROLE`, and 2xx respectively. Inspect logs after every successful mutation — one structured audit entry per mutation, zero on GETs.

**Acceptance Scenarios**:

1. **Given** an anonymous request, **When** it hits any of POST/GET/GET-by-id/PATCH/DELETE, **Then** the response is 401.
2. **Given** an authenticated learner (no admin role), **When** they hit any of the five endpoints, **Then** the response is 403 with `errorCode: INSUFFICIENT_ROLE`.
3. **Given** an authenticated admin, **When** a successful POST/PATCH/DELETE completes, **Then** exactly one audit log entry is emitted with the user id, action, entity, target id, and timestamp.
4. **Given** an authenticated admin, **When** a GET (list or detail) completes, **Then** zero audit log entries are emitted.
5. **Given** an authenticated admin, **When** a mutation fails (validation error, 404, 409), **Then** zero audit log entries are emitted.

### User Story 5 - Cache freshness on every successful mutation (Priority: P2)

The public `GET /categories` is cached in Redis (KAN-26). If admin POST/PATCH/DELETE doesn't evict the cache, the marketing site shows stale data until TTL expires. The TODO comment in `categories.service.ts` already promises this integration.

**Why this priority**: P2 because the cache has a finite TTL and the marketing audience tolerates seconds-of-latency on taxonomy changes — but it's still worth getting right since the whole purpose of the comment is to wire this in.

**Independent Test**: Prime the cache with a GET; admin makes a successful mutation; the next GET hits the database (cache miss), and the response reflects the change.

**Acceptance Scenarios**:

1. **Given** the public categories cache is primed, **When** admin POSTs a new category successfully, **Then** the cache key is evicted before the admin response is returned.
2. **Given** the cache is primed, **When** admin PATCHes a category successfully, **Then** the cache key is evicted.
3. **Given** the cache is primed, **When** admin DELETEs a category successfully, **Then** the cache key is evicted.
4. **Given** the cache is primed, **When** admin attempts a mutation that fails (validation 400, conflict 409, not-found 404), **Then** the cache key is **not** evicted.

### User Story 6 - Admin updates a category with partial fields (Priority: P2)

Admins frequently need to rename a category, change its display order, or hide it without affecting other fields. Partial updates (PATCH) are the right semantic.

**Why this priority**: P2 because while editing is essential to running the catalog day-to-day, the MVP create-and-list slice (US1) is enough to demonstrate the foundation. Edits get added next.

**Independent Test**: Create a category, then PATCH only `name`; confirm the other fields (`slug`, `order`, `status`) are unchanged.

**Acceptance Scenarios**:

1. **Given** an existing category `{ name: "AI", slug: "ai", order: 0, status: ACTIVE }`, **When** I PATCH `{ name: "الذكاء الاصطناعي" }`, **Then** the response shows the new `name` and the unchanged `slug`, `order`, `status`.
2. **Given** an existing category with name `"AI"`, **When** I PATCH another category to `{ name: "AI" }`, **Then** the response is 409 `CATEGORY_NAME_EXISTS`.
3. **Given** PATCH body `{ name: "X", slug: "existing-slug" }` where both collide with different existing rows, **When** the request is processed, **Then** the response is 409 `CATEGORY_NAME_EXISTS` (name checked first; slug check is skipped).
4. **Given** PATCH body `{ status: "INVALID_VALUE" }`, **When** the request is processed, **Then** the response is 400 `VALIDATION_FAILED`.

### User Story 7 - Detail view (Priority: P2)

A single-item GET is needed by the admin UI to populate the edit form and show usage counts before the admin decides to delete.

**Why this priority**: P2 because list view (US1) is sufficient to demonstrate read access; detail is needed for the editing UX which is downstream.

**Acceptance Scenarios**:

1. **Given** a category with 3 paths and 7 courses, **When** admin GETs `/admin/categories/:id`, **Then** the response is 200 with the category data plus `pathCount: 3` and `courseCount: 7`.
2. **Given** a non-existent UUID, **When** admin GETs `/admin/categories/:id`, **Then** the response is 404 with `errorCode: CATEGORY_NOT_FOUND`.

### Edge Cases

- **Whitespace-only name or slug**: Trimmed empty string must fail validation (treated as missing).
- **Slug not in kebab-case**: Patterns like `Foo Bar`, `foo_bar`, `--foo`, `foo-`, `FOO`, `foo--bar` must fail validation.
- **Negative `order`**: Rejected by validator (must be ≥ 0 integer).
- **Concurrent admin POSTs with the same name**: Both pre-checks pass, both inserts attempted, the second fails on the slug `@unique` (any auto-generated slug will collide if names match). The race window for two distinct slugs with the same name is theoretical at human admin throughput and accepted as a residual risk until KAN-101 lands and `@unique` on `name` becomes possible.
- **Non-existent UUID on PATCH**: 404 `CATEGORY_NOT_FOUND` (consistent with DELETE).
- **Pagination boundary**: `?limit=0` rejected with 400 `VALIDATION_FAILED` (must be ≥ 1); `?limit=200` rejected with 400 `VALIDATION_FAILED` (DTO `@Max(100)` rejects, does not silently cap). `?limit=100` accepted; `?limit=101` rejected.
- **`HttpExceptionFilter` regression**: Existing validation-failure responses (where `resp.message` is an array) must continue to populate `body.errors` exactly as before — the filter extension must not change that path.
- **Object-shaped errors with both `message` array and `errors` object**: `errors` array (from `message`) takes precedence over `errors` object (regression-friendly — validation failures are higher-volume).

## Requirements *(mandatory)*

### Functional Requirements

#### Endpoints and routing

- **FR-001**: System MUST expose five admin endpoints under `/api/v1/admin/categories`: POST (create), GET (list), GET `/:id` (detail), PATCH `/:id` (update), DELETE `/:id` (delete).
- **FR-002**: All five endpoints MUST be decorated with `@AdminEndpoint()` at the controller class level, inheriting the auth + role + audit interceptor pipeline established by KAN-78.

#### Authentication and authorization

- **FR-003**: System MUST return 401 to anonymous requests on every admin endpoint.
- **FR-004**: System MUST return 403 with `errorCode: INSUFFICIENT_ROLE` when an authenticated user lacks the `ADMIN` role.
- **FR-005**: System MUST emit exactly one structured audit log entry per mutation (POST/PATCH/DELETE), with `outcome: 'success'` on success and `outcome: 'error'` (plus `statusCode`) when the mutation throws an `HttpException`. GETs MUST emit zero entries. (This matches the existing `AuditLogInterceptor` behavior from KAN-78 — failed mutations produce one error-flavored entry, not zero entries.)
- **FR-005a**: `CategoriesAdminModule.providers` MUST register `RolesGuard` and `AuditLogInterceptor` locally so `@AdminEndpoint()` can resolve them via the controller's own module DI scope.

> **Foundation pattern correction (discovered 2026-05-02 during planning)**: The KAN-78 foundation pattern documented in `docs/admin/conventions.md` § "Sub-module registration" is incomplete. Sub-modules using `@AdminEndpoint()` MUST register `RolesGuard` and `AuditLogInterceptor` in their own `providers` array locally — NestJS imports are unidirectional, so `AdminModule.imports = [SubModule]` does **not** make `AdminModule`'s exported providers visible inside the sub-module. The foundation was only ever tested with `AdminHealthController` in the same module that owns those providers; KAN-82 is the first sub-module to exercise the cross-module case. KAN-100 will be expanded to correct the foundation documentation. **This spec assumes the corrected pattern**: `CategoriesAdminModule.providers` contains `[CategoriesAdminService, RolesGuard, AuditLogInterceptor]`. Both providers are stateless (only inject framework-provided `Reflector` / `Logger`), so per-module instances have zero functional cost. See `research.md` Decision 6 for the full diagnosis.

#### Validation rules (DTOs)

- **FR-006**: `name` MUST be required, trimmed-non-empty, max length 200 characters (DTO-layer cap; see Assumptions).
- **FR-007**: `slug` MUST be required, trimmed-non-empty, max length 200, and match the regex `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
- **FR-008**: `order` (PATCH only — defaults to 0 on create) MUST be an integer ≥ 0 when provided.
- **FR-009**: `status` (PATCH only — defaults to `ACTIVE` on create) MUST be one of the `CategoryStatus` enum values: `ACTIVE`, `HIDDEN`.
- **FR-010**: List query parameters MUST support `page` (≥ 1, default 1), `limit` (1–100, default 20), `search` (case-insensitive substring against `name` and `slug`), and `status` (optional; absent → all statuses).
- **FR-010a**: When `status` is provided, it MUST match a `CategoryStatus` enum value exactly (case-sensitive uppercase: `ACTIVE` or `HIDDEN`). Any other value MUST return 400 `VALIDATION_FAILED` with the offending value named in `errors[]`. The default `createdAt DESC` ordering (FR-030) applies regardless of whether `status` is provided.

#### Conflict resolution and uniqueness

- **FR-011**: On CREATE and PATCH, system MUST check `name` uniqueness via `findUnique`-equivalent before checking `slug`. If `name` collides, respond 409 `CATEGORY_NAME_EXISTS` and do **not** check `slug`.
- **FR-012**: If `name` is unique and `slug` collides, respond 409 `CATEGORY_SLUG_EXISTS`.
- **FR-013**: Conflict checks MUST be two sequential lookups — `findFirst({ where: { name } })` for `name` (no `@unique` constraint on this column per FR-014) followed by `findUnique({ where: { slug } })` for `slug` — not a combined `findFirst` with OR. Deterministic ordering required.
- **FR-014**: `name` uniqueness is enforced at the application layer only; the column does NOT carry a `@unique` constraint in this PR (deferred to KAN-101).

#### Schema migration

- **FR-015**: A single Prisma migration MUST drop the `description` and `icon` columns from the `categories` table.
- **FR-016**: The same migration MUST change `Path.category` from `ON DELETE CASCADE` to `ON DELETE RESTRICT`, and `Course.path` from `ON DELETE CASCADE` to `ON DELETE RESTRICT`.
- **FR-017**: After migration, no remaining references to `category.description` or `category.icon` exist in `src/`, `test/`, or `prisma/seed.ts`.

#### DELETE semantics

- **FR-018**: DELETE MUST attempt the database delete first, with no `$transaction` wrapper and no app-layer pre-check, and MUST catch FK violations from **both** Prisma error classes — `PrismaClientKnownRequestError` (with code `P2003`, raised when an `onDelete: Cascade` is blocked by a deeper constraint) and `PrismaClientUnknownRequestError` (raised when an `onDelete: Restrict` directly rejects). An `isFKViolation(e)` helper MUST be used so the dual-class match is testable in isolation.
- **FR-019**: When an FK violation is caught, the response MUST be 409 with `errorCode: CATEGORY_IN_USE`, message `"Category is in use"`, and `errors: { pathCount: <count>, courseCount: <count> }` populated from `prisma.path.count` and `prisma.course.count` queries running in parallel.
- **FR-020**: When Prisma raises `P2025` (record not found), the response MUST be 404 with `errorCode: CATEGORY_NOT_FOUND`.

#### Cache invalidation

- **FR-021**: Every successful mutation (POST, PATCH, DELETE) MUST invalidate the public categories cache key (`CacheKeys.categories.all()`) before the admin response is returned.
- **FR-022**: Failed mutations (validation error, 404, 409, or any thrown exception) MUST NOT invalidate the cache.
- **FR-023**: The TODO comment at the top of `src/content/categories/categories.service.ts` MUST be updated to reference KAN-82 (or removed once the integration lands).

#### Public endpoint integrity (KAN-26 contract)

- **FR-024**: The public `GET /categories` endpoint MUST continue to filter on `status = ACTIVE` and order by `order ASC`. Its existing e2e tests MUST all pass.
- **FR-025**: The public `CategoryResponseDto` MUST drop the `description` and `icon` fields (and the mapper too); no other fields change.

#### Infrastructure: HttpExceptionFilter passthrough

- **FR-026**: The shared `HttpExceptionFilter` MUST be extended so that when an exception body's `errors` property is a non-null, non-array, non-primitive object, it is passed through verbatim to the response body's top-level `errors` field.
- **FR-027**: The existing array-shaped `errors` path (populated from `resp.message` arrays during validation) MUST continue to work unchanged. A regression unit test asserts this.
- **FR-028**: The `PASSTHROUGH_KEYS` allow-list MUST NOT be modified.

#### Detail and list response shape

- **FR-029**: List and detail responses MUST include `pathCount` and `courseCount` computed via Prisma `_count` (no separate count round-trips for the list path).
- **FR-030**: List response MUST be ordered by `createdAt DESC` (admin convenience — most recent first), distinct from the public `order ASC` ordering.

### Key Entities

- **Category**: A top-level taxonomy node owned by admins. After this PR, attributes are `id` (UUID), `name` (trimmed, app-layer-unique), `slug` (kebab-case, DB-unique), `order` (Int ≥ 0, default 0), `status` (`ACTIVE` | `HIDDEN`, default `ACTIVE`), and timestamps. Has many `Path` and `Course` records — both relations are now `ON DELETE RESTRICT`.
- **Path** *(referenced, not owned)*: Existing entity whose `categoryId` FK changes from `Cascade` to `Restrict` in this PR.
- **Course** *(referenced, not owned)*: Existing entity whose `pathId` FK changes from `Cascade` to `Restrict` in this PR.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can create, view, list, edit, and delete a category through the API end-to-end without manual database access.
- **SC-002**: Attempting to delete a category that is referenced by any path or course is rejected with a 409 response that names the exact `pathCount` and `courseCount` blocking the delete; the row remains in the database.
- **SC-003**: After the migration applies, no part of the public marketing flow regresses: the existing KAN-26 e2e suite (covering `/categories` filtering, ordering, and the response shape minus the dropped fields) passes with zero changes to test bodies beyond the dropped-field assertions.
- **SC-004**: An anonymous or learner request to any of the five admin endpoints is denied (401 or 403 + `INSUFFICIENT_ROLE`) before any business logic runs.
- **SC-005**: A successful admin mutation produces exactly one structured audit log line with `outcome: 'success'`; a failed mutation produces exactly one entry with `outcome: 'error'`; any GET produces zero entries.
- **SC-006**: A successful admin mutation invalidates the public categories cache before responding; a failed mutation does not.
- **SC-007**: All seven user stories are covered by automated e2e tests. Six stories (US1, US3, US4, US5, US6, US7) are covered by `test/admin/categories.e2e-spec.ts`; US2 (migration + public preserved) is verified by the existing `test/content/categories/categories.controller.e2e-spec.ts` continuing to pass against the trimmed response shape.
- **SC-008**: The full repo passes lint with no new errors compared to the 16-error pre-existing baseline, builds cleanly under TypeScript strict mode, and runs at least 575 unit tests + 332 e2e tests green (matching or exceeding the KAN-78 baseline).
- **SC-009**: A grep across `src/` and `test/` finds zero remaining references to `category.description` or `category.icon`.
- **SC-010**: The `HttpExceptionFilter` accepts both array-shaped and object-shaped `errors` payloads; both are covered by unit tests, plus a regression test that the legacy array path is unchanged.

## Assumptions

- **DTO-layer length cap**: The schema declares `name` and `slug` as Prisma `String` (PostgreSQL `text`, unbounded). The 200-character cap mentioned in the brief is enforced at the DTO/validator layer only, not at the column. This is sufficient for input sanitation and matches the validator-only conventions used in adjacent admin DTOs.
- **`@unique` on `name` deferred**: Adding a database-enforced unique constraint on `Category.name` would break four pre-existing test suites that reuse literal one-character names (`'C'`, `'AI'`, `'X'`, `'D'`) within single tests. KAN-101 will standardize those fixtures; once it lands, a follow-up PR can add the constraint cleanly. Until then, the app-layer pre-check + the slug `@unique` (auto-generated slugs collide whenever names match) covers real-world admin throughput.
- **KAN-78 admin foundation is stable**: `@AdminEndpoint()`, `RolesGuard`, and `AuditLogInterceptor` are treated as fixed contracts. Any divergence in their behavior is a stop-and-report event for this ticket.
- **KAN-26 public endpoint contract is fixed**: Filter (`status = ACTIVE`), ordering (`order ASC`), and response field set (minus `description`/`icon`) cannot change as part of this PR.
- **No production deploy concerns**: KAN-68 (Production deployment + CI/CD) is in `To Do`. There are no live learner-facing browser sessions to coordinate with. The migration ships in the same PR as the code; no expand/contract pattern, no two-PR split.
- **No user-history cascade fixes**: The four cascades on user-history records (`Certificate.path`, `Certificate.course`, `QuizAttempt.quiz`, `ProjectSubmission.project`) are explicitly out of scope and tracked as a separate retention-policy concern.
- **Admin throughput is human-paced**: The race window between two concurrent admin POSTs both passing the `name` pre-check and proceeding to insert is treated as theoretical and accepted until KAN-101.
- **HTTP success status for DELETE**: 200 (project convention used elsewhere in admin endpoints) rather than 204; matches the existing `{ ok: true }` body pattern used by sibling admin services.

## Out of Scope *(explicit non-goals)*

- Manual reordering / `/admin/categories/reorder` endpoint
- `nameEn`, `description`, `iconUrl`, or any new content fields (description and icon are dropped; others never existed)
- Database-enforced `@unique` on `Category.name` (deferred to KAN-101)
- Bulk operations (bulk delete, bulk reorder, bulk import)
- Soft delete / archive flow
- User-history cascade fixes (`Certificate.path`, `Certificate.course`, `QuizAttempt.quiz`, `ProjectSubmission.project`)
- Production deploy strategy (revisited cross-cuttingly when KAN-68 lands)
- Frontend admin UI work (KAN-83 owns the wireframe-driven UI)

## Dependencies

- **KAN-78** (admin module foundation): merged on master at `1a8fde0`. Provides `@AdminEndpoint()`, `RolesGuard`, `AuditLogInterceptor`, and the audit log emission contract.
- **KAN-26** (public discovery endpoints): merged on master at `0a02ba3`. Owns the public `GET /categories` endpoint, its caching, and its e2e test suite.
- **KAN-12** (Redis cache module): provides `CacheService` and `CacheKeys.categories.all()`.

## Cross-cutting impact (downstream tickets)

The `HttpExceptionFilter` extension (FR-026, FR-027, FR-028) is generic and benefits every per-entity admin module that follows. KAN-85, KAN-88, KAN-91, KAN-94, and KAN-97 all need to return object-shaped `errors` payloads (counts, ids, reasons) — they will inherit the filter passthrough from this ticket without further change.

## Known follow-ups (out of scope for KAN-82, but flagged here)

- **KAN-100 (expanded)**: The original KAN-100 scope is fixing the stale JSDoc in `src/admin/interceptors/audit-log.interceptor.ts:49–51`. KAN-82's planning surfaced two more items that should be folded in:
  1. The foundation's documented sub-module registration pattern (in `docs/admin/conventions.md` § "Sub-module registration", `docs/admin/audit-log-interceptor.md`, `docs/admin/roles-guard.md`, ADR-006, `specs/014-admin-foundation/quickstart.md` Step 3, and the Confluence Tech Stack §6.9.7) is wrong: it claims sub-modules can omit `RolesGuard` / `AuditLogInterceptor` from their `providers` because `AdminModule` exports them, but NestJS `imports` are unidirectional — exports flow from imported modules **into** the importer, not the reverse. KAN-100 should rewrite that guidance to require local provider registration in every sub-module.
  2. An integration test that boots a minimal sub-module using `@AdminEndpoint()` and asserts the route returns 200 / 403 / 401 correctly. Such a test would have caught this at KAN-78 review time.
  KAN-82 itself documents and follows the corrected pattern locally; nothing in KAN-82 is contingent on KAN-100 landing first.
- **KAN-101**: Standardize the four pre-existing test fixture suites that reuse literal one-character category names (see Assumptions). Once landed, a follow-up PR can add `@unique` to `Category.name` cleanly and remove the residual app-layer race window.
