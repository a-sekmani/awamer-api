# Phase 0 Research: BE Categories admin CRUD (KAN-82)

**Feature**: 015-categories-admin-crud
**Date**: 2026-05-02
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

## Status of Open Questions

The spec was written from a fully-pinned brief carrying findings from a prior failed attempt; the single `/speckit.clarify` question (admin LIST status filter) was answered in `spec.md` § Clarifications, Session 2026-05-02. No `[NEEDS CLARIFICATION]` markers remain. This document records the codebase grounding behind each decision plus the framework patterns the implementation will rely on.

---

## Decision 1 — Migration shape: single migration drops columns and tightens FKs in one step

**Decision**: One Prisma migration directory, `prisma/migrations/<timestamp>_drop_category_columns_and_restrict_content_fks/migration.sql`, performs all four changes atomically:

1. `ALTER TABLE "categories" DROP COLUMN "description";`
2. `ALTER TABLE "categories" DROP COLUMN "icon";`
3. `ALTER TABLE "paths" DROP CONSTRAINT "paths_categoryId_fkey", ADD CONSTRAINT "paths_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`
4. `ALTER TABLE "courses" DROP CONSTRAINT "courses_pathId_fkey", ADD CONSTRAINT "courses_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "paths"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`

The Prisma schema is updated to remove `description` and `icon` from `Category` and to change the two `@relation` clauses to `onDelete: Restrict`. `prisma migrate dev --name drop_category_columns_and_restrict_content_fks` generates the SQL.

**Rationale**: KAN-68 (production deploy + CI/CD) is still in `To Do`. There is no live learner-facing browser session to coordinate with, so the expand-contract pattern (separate PR for column-drop, separate PR for FK changes) buys nothing. A single migration is shorter, easier to review, and rolls back as one unit if needed.

**Alternatives considered**:
- *Two separate migrations (column drops, then FK changes)*: rejected — same diff, more directories, no benefit until production exists.
- *App-layer pre-check before delete instead of FK Restrict*: rejected — race-prone (a path could be inserted between the count read and the delete) and contradicts the brief, which explicitly relies on the FK constraint as the integrity guarantee.

**Codebase grounding**:
- `prisma/schema.prisma` lines 342–356 (Category), 380 (Path.category Cascade), 412 (Course.path Cascade) — bugs confirmed during pre-flight.
- Existing migrations under `prisma/migrations/` follow the `<timestamp>_<snake_case_name>/migration.sql` naming convention.

---

## Decision 2 — DELETE catches BOTH Prisma error classes for FK violations

**Decision**: The DELETE service method wraps `prisma.category.delete({ where: { id } })` in a `try/catch` with an `isFKViolation(e)` helper that returns `true` when `e` is either:
- `PrismaClientKnownRequestError` with `e.code === 'P2003'`, OR
- `PrismaClientUnknownRequestError` whose `e.message` contains the SQLSTATE `23001` (FK Restrict rejection from Postgres surfaced via `pg`).

On a true result, the service runs two parallel `count()` queries (`prisma.path.count({ where: { categoryId: id } })` and `prisma.course.count({ where: { categoryId: id } })`) and throws a `ConflictException` with `{ errorCode: ErrorCode.CATEGORY_IN_USE, message: 'Category is in use', errors: { pathCount, courseCount } }`. On `e.code === 'P2025'` (record not found), it throws `NotFoundException` with `errorCode: CATEGORY_NOT_FOUND`. Anything else re-throws.

**Rationale**: Prisma surfaces FK violations differently based on the FK action:
- `onDelete: Cascade` blocked by a deeper constraint → `P2003` (`PrismaClientKnownRequestError`).
- `onDelete: Restrict` direct rejection → `PrismaClientUnknownRequestError` (no `P2003`; raw Postgres SQLSTATE 23001 in the message).

This PR fixes BOTH `Path.category` and `Course.path` to `Restrict`, so the DELETE handler will see the `Unknown` error class in the common case (referenced by paths). The `Known/P2003` class can still appear if a deeper deletion downstream hits a constraint Prisma is aware of. Catching both via one `isFKViolation(e)` helper makes the dual-class check unit-testable in isolation and prevents the previous-attempt failure mode where only one class was caught.

**Alternatives considered**:
- *App-layer pre-check before delete*: rejected — see Decision 1.
- *Wrap the whole DELETE in `prisma.$transaction`*: rejected — adds no benefit (the delete itself is single-row, the count reads are post-failure); only confuses error class.

**Codebase grounding**:
- The brief's "Known Prisma error pattern" section flags this as a real divergence the previous attempt encountered.
- `@prisma/client/runtime/library` exports both `PrismaClientKnownRequestError` and `PrismaClientUnknownRequestError`. Both are catchable via `instanceof`.

---

## Decision 3 — `HttpExceptionFilter` pass-through for object-shaped `errors`

**Decision**: Inside the existing `if (typeof exceptionResponse === 'object' && exceptionResponse !== null)` branch in `src/common/filters/http-exception.filter.ts`, after the existing array-handling code path for `resp.message`, add:

```ts
if (
  resp.errors !== null &&
  resp.errors !== undefined &&
  typeof resp.errors === 'object' &&
  !Array.isArray(resp.errors)
) {
  body.errors = resp.errors;
}
```

The existing array-error path (populated from `resp.message` arrays during validation) is left untouched. The `PASSTHROUGH_KEYS` allow-list (`parentPathId`, `upgradeUrl`, `reason`) is not modified.

**Rationale**: The current filter only sets `body.errors` when `resp.message` is an array (the validation-failure pattern), silently dropping any other `errors` payload. KAN-82 needs to return `errors: { pathCount: N, courseCount: N }` on `CATEGORY_IN_USE` 409s. Adding a one-conditional pass-through preserves the array path (regression-safe) and makes object-shaped `errors` structurally available for every per-entity admin module that follows.

**Alternatives considered**:
- *Add `errors` to `PASSTHROUGH_KEYS`*: rejected — that mechanism only carries through scalar-ish keys onto the top-level body verbatim; treating `errors` as a passthrough key would conflict with the validation-error code path (which sets `body.errors` based on `message`, not `errors`).
- *Module-scoped exception filter for admin*: rejected — see Complexity Tracking in plan.md.
- *Re-shape the conflict response to use the array form*: rejected — `errors: ['pathCount: 2', 'courseCount: 5']` is hostile to consumers.

**Codebase grounding**:
- `src/common/filters/http-exception.filter.ts` lines 35–73. The `errors` array is only populated from `resp.message` (line 47); `body.errors` is only set when `errors.length > 0` (line 71).
- Existing passthrough idiom for cross-cutting concerns at lines 33, 54–58.

---

## Decision 4 — Cache invalidation runs after the successful write, before the response

**Decision**: After every successful POST / PATCH / DELETE in the service, call `await this.cache.del(CacheKeys.categories.all())` BEFORE returning to the controller. Failed mutations (validation errors thrown by the pipe, conflict 409s, not-found 404s, any `throw`) skip cache invalidation entirely because control never reaches the `del` call.

**Rationale**: Two reasons: (a) the brief explicitly says "Wire this into every successful admin mutation"; (b) running `del` before responding closes the read-after-write window — a frontend that GETs the public `/categories` immediately after a successful admin mutation sees fresh data, not the cached pre-mutation snapshot. The `cache.del` is fire-and-forget cheap (single Redis DEL), so awaiting it adds < 1ms but eliminates a real race.

**Alternatives considered**:
- *Fire-and-forget `cache.del` (no `await`)*: rejected — the read-after-write race would silently re-emerge under load.
- *NestJS interceptor that invalidates on success*: rejected — too clever for one cache key; couples the interceptor to a specific cache helper. Service-level call is direct and obvious in the diff.

**Codebase grounding**:
- `src/common/cache/cache-keys.ts` lines 14–16 — `CacheKeys.categories.all()` returns `'categories:all'`.
- `src/content/categories/categories.service.ts` lines 1–3 — TODO comment promises this exact integration.

---

## Decision 5 — Conflict resolution order: name first, then slug (sequential `findUnique` lookups)

**Decision**: On both CREATE and PATCH, the service runs `prisma.category.findUnique({ where: { name } })` first. If a row is returned (and on PATCH, the row is not the same `:id`), it throws `ConflictException` with `errorCode: CATEGORY_NAME_EXISTS`. Only when the name check passes does it run `prisma.category.findUnique({ where: { slug } })` and throw `CATEGORY_SLUG_EXISTS` on collision.

**Rationale**: The order mirrors the DTO field declaration order (`name` before `slug` in `CreateCategoryDto`), which is what callers expect. The brief explicitly forbids combining the two checks into a single `findFirst({ where: { OR: [...] } })` because Prisma does not guarantee deterministic ordering of which row "wins" the OR. Two sequential `findUnique`s are deterministic, both individually use the existing slug `@unique` index (and a planned name index — but actually `name` has no index in the current schema; see "Planned non-blocking follow-up" below).

**Alternatives considered**:
- *Single `findFirst` with OR*: rejected — non-deterministic per the brief.
- *Combined transactional check + insert*: rejected — `name` has no DB-enforced unique constraint until KAN-101 lands. The check-then-insert race is documented as residual risk in spec.md § Assumptions.

**Codebase grounding**:
- `slug` is `@unique` in `Category` (`schema.prisma` line 345). `name` is NOT `@unique` (deferred to KAN-101 per spec).
- `prisma.category.findUnique({ where: { name } })` is supported but generates a runtime warning when `name` is not unique. **Note**: this requires `findFirst`, not `findUnique`, since `findUnique` only accepts unique fields. The implementation will use `findFirst({ where: { name } })` for the name check and `findUnique({ where: { slug } })` for the slug check. The contract semantics (deterministic, name-first) are unchanged.

**Planned non-blocking follow-up**: KAN-101 standardizes test fixtures, after which a follow-up PR can add `@unique` to `Category.name`. At that point both lookups can use `findUnique` and the residual race window closes.

---

## Decision 6 — Module wiring: register `RolesGuard` and `AuditLogInterceptor` locally in the sub-module *(resolved 2026-05-02)*

**Decision**: `CategoriesAdminModule` declares:

- `imports: [PrismaModule, CacheModule, AuthModule]` — `AuthModule` provides `JwtAuthGuard` (also referenced by `@AdminEndpoint()`); `PrismaModule`/`CacheModule` provide the service's runtime deps.
- `controllers: [CategoriesAdminController]`.
- `providers: [CategoriesAdminService, RolesGuard, AuditLogInterceptor]` — the latter two registered **locally** so `@AdminEndpoint()` can resolve them via the controller's own module DI scope.

`AdminModule.imports` still gains `CategoriesAdminModule` (this is the agreed wiring location for admin sub-modules and serves as a code-review choke point), but the `RolesGuard` / `AuditLogInterceptor` resolution does NOT depend on that import — it depends on the local provider registration above.

**Rationale (the diagnosis)**:

The KAN-78 quickstart claimed sub-modules could omit `RolesGuard` / `AuditLogInterceptor` from their `providers` because they're exported from `AdminModule`. Investigation against the live codebase contradicts that claim:

1. **NestJS imports are unidirectional.** `AdminModule.imports = [CategoriesAdminModule]` makes `CategoriesAdminModule`'s exports visible **inside** `AdminModule`. The reverse is not true — `AdminModule`'s exports do **not** flow into the imported child. So `RolesGuard` is not in `CategoriesAdminModule`'s DI scope under that wiring.
2. **The foundation was only tested in same-module configuration.** `AdminHealthController` is registered directly in `AdminModule.controllers` (`src/admin/admin.module.ts:23`), and `AdminModule.providers` includes `RolesGuard` + `AuditLogInterceptor` (line 24). Same-module DI is trivial. The cross-module / sub-module case has never been exercised.
3. **DI failure is hard, not silent.** `RolesGuard` injects `Reflector` (`src/common/guards/roles.guard.ts:17`). If NestJS cannot resolve `RolesGuard` from the controller's module container, it errors at boot — there's no `new RolesGuard()` fallback that would silently produce a half-working guard.

So KAN-82 — the first sub-module — is the first time the documented pattern would actually run in the cross-module configuration. The pattern fails. The local-provider-registration fix is the canonical sub-module pattern; it costs nothing functionally because both providers are stateless (the only injected dep, `Reflector`, is framework-provided and globally available, and `AuditLogInterceptor` only injects `Logger`).

**This is a foundation documentation bug, not a KAN-82 design problem.** KAN-100 will be expanded to amend the foundation docs (`docs/admin/conventions.md` § "Sub-module registration", `docs/admin/audit-log-interceptor.md`, `docs/admin/roles-guard.md`, ADR-006, the `specs/014-admin-foundation/quickstart.md`, and the Confluence Tech Stack §6.9.7) and add an integration test that exercises the sub-module pattern. KAN-82 documents its own correct wiring locally and proceeds.

**Alternatives considered**:
- *Mark `AdminModule` as `@Global()`*: rejected — changes foundation behavior unilaterally; KAN-100 should decide that, not KAN-82.
- *Have `CategoriesAdminModule` import `AdminModule`*: rejected — circular (`AdminModule.imports` already includes `CategoriesAdminModule`). Could be unblocked with `forwardRef`, but that's weird-looking for what should be a clean sub-module pattern.
- *Extract a `@Global()` `AdminProvidersModule` exporting `RolesGuard` + `AuditLogInterceptor`*: rejected for KAN-82 — touches foundation; defer to KAN-100. The local-providers approach is two added lines, no foundation change required.
- *Follow the foundation quickstart verbatim and discover the failure at runtime*: rejected — we already discovered it via the investigation step, before writing code.

**Codebase grounding**:
- `src/admin/admin.module.ts:23–25` — `AdminHealthController` registered directly in `AdminModule.controllers` alongside `RolesGuard` + `AuditLogInterceptor` providers (the same-module case).
- `src/admin/common/decorators/admin-endpoint.decorator.ts` — `applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), UseInterceptors(AuditLogInterceptor), Roles(Role.ADMIN))`. The class references trigger DI resolution at controller construction time.
- `src/common/guards/roles.guard.ts:17` — `constructor(private readonly reflector: Reflector)`. Injection is required; no zero-arg fallback exists.
- `specs/014-admin-foundation/quickstart.md` Step 3 — incorrectly states "do NOT register RolesGuard or the audit interceptor here." This guidance is wrong for the sub-module case and will be corrected by KAN-100.

---

## Decision 7 — Admin list ordering is `createdAt DESC` (distinct from public `order ASC`)

**Decision**: `GET /admin/categories` orders by `createdAt DESC` (newest first). The public `GET /categories` keeps its `orderBy: { order: 'asc' }`. The two endpoints are decoupled.

**Rationale**: The admin's day-to-day workflow is "I just created/edited this — let me find it again", so the most recently changed category should be at the top. The public marketing site orders by manually-curated `order` (ASC) so the catalog appears in a designed sequence regardless of insert timestamp. These two needs are genuinely different — one is operational, the other is curated.

**Alternatives considered**:
- *Match the public ordering (ASC by `order`)*: rejected — admin routinely creates new categories with default `order: 0`, which would lump them with all other zero-ordered categories at the bottom, making them hard to find.
- *Make ordering a query parameter*: rejected — out of scope; the brief pinned `createdAt DESC`.

**Codebase grounding**:
- `src/content/categories/categories.service.ts` line 26 — `orderBy: { order: 'asc' }`. KAN-82 leaves this exactly as-is.

---

## Decision 8 — Status filter is an enum-validated optional query param (clarification answer codified)

**Decision**: `GET /admin/categories?status=ACTIVE|HIDDEN` filters the result. Absent → all statuses. Any other value → 400 `VALIDATION_FAILED` with the offending value named in `errors[]`. Implemented as `status?: CategoryStatus` on `ListCategoriesQueryDto` with `@IsOptional() + @IsEnum(CategoryStatus, { message: 'status must be one of: ACTIVE, HIDDEN' })`.

**Rationale**: See spec.md § Clarifications, Session 2026-05-02 Q1 for full rationale. Aligns with KAN-83 wireframes (status column), keeps the KAN-84 frontend simple, matches industry admin-list precedent.

**Alternatives considered**: See the clarification log.

**Codebase grounding**:
- `CategoryStatus` is a Prisma-generated enum (`schema.prisma` line 53). `@IsEnum(CategoryStatus)` validates against `ACTIVE`/`HIDDEN` exactly as the brief requires (case-sensitive, uppercase).

---

## Framework patterns this feature relies on

### A — `@AdminEndpoint()` composite decorator

`src/admin/common/decorators/admin-endpoint.decorator.ts` bundles `UseGuards(JwtAuthGuard, RolesGuard)`, `UseInterceptors(AuditLogInterceptor)`, and `@Roles(Role.ADMIN)`. Apply at the controller class level. Forgetting the decorator is the single highest-impact security mistake — the code-review checklist in `docs/admin-foundation.md` §5.2 catches it.

### B — Audit log emission

`AuditLogInterceptor` (KAN-78) emits exactly one structured log line per successful POST/PATCH/PUT/DELETE on routes within admin scope. Mutations that throw produce one error-flavored entry. GET/HEAD/OPTIONS produce zero. The interceptor reads `req.route.path` (matched pattern, e.g. `/admin/categories/:id`), so UUIDs never leak into the `route` field.

### C — Global response envelope and error filter

The existing global `ResponseTransformInterceptor` wraps every successful response in `{ data, message: 'Success' }`. The existing global `HttpExceptionFilter` formats errors as `{ statusCode, errorCode?, message, errors? }`. This feature's filter extension is additive (one new branch).

### D — Cache invalidation helper

`CacheService.del(key: string)` already exists. `CacheKeys.categories.all()` returns the canonical key. No new cache helper is introduced.

### E — Prisma `_count` for inline aggregates

`prisma.category.findMany({ include: { _count: { select: { paths: true, courses: true } } } })` already used by `CategoriesService.listAllPublic()`. KAN-82 reuses this pattern (without the public's `where: { status: PUBLISHED }` sub-filter — admin counts include all path/course statuses).

---

## Summary

All decisions are codebase-grounded and reference the brief's pinned requirements. No `[NEEDS CLARIFICATION]` markers carried over from spec. One stop-and-report risk (Decision 6, NestJS module DI for guards declared via `applyDecorators`) is flagged with documented recovery; implementation MUST verify the documented foundation pattern before applying workarounds.
