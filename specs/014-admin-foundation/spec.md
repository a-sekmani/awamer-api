# Feature Specification: Admin Module Foundation — Backend (KAN-78)

**Feature Branch**: `014-admin-foundation`
**Created**: 2026-05-01
**Status**: Draft
**Input**: User description: Admin Module Foundation — Backend (KAN-78). Backend-only foundation layer that every per-entity admin endpoint will depend on. Provides: (1) role-based access control with `@Roles('admin')` decorator + `RolesGuard`; (2) `AdminModule` skeleton hosting future per-entity admin sub-modules; (3) shared bulk-reorder DTO `[{ id, sortOrder }]` with UUID + non-negative-integer + no-duplicate-id validation, used by Sections / Lessons / Content Blocks / possibly Paths and Courses, but NOT Categories; (4) consistent admin response format — uniform success envelope plus error shape (code, message, optional details, optional field-level errors), scoped to admin routes; (5) audit log middleware skeleton that emits a structured log entry on admin mutations (POST/PATCH/DELETE) with userId, userEmail, role, action, route pattern, ISO-8601 timestamp, IP, and userAgent — DB persistence is out of scope. Out of scope: per-entity CRUD logic, persisted audit log table, admin user management endpoints, auth-system changes, frontend changes.

## Clarifications

### Implementation correction — 2026-05-01

**Q1, Q3, and Q4 originally specified**: `APP_GUARD` and `APP_INTERCEPTOR` providers declared inside `AdminModule.providers` to scope their activation to admin routes only.

**Discovered during implementation**: NestJS `APP_*` providers are always app-global regardless of which module declares them in `providers`. Module placement only affects the DI graph (where the provider's constructor dependencies resolve from), not activation scope. (Reference: NestJS docs on global guards via DI — `{ provide: APP_GUARD, useClass: ... }` from any module makes the guard universal.) Concrete evidence: when `RolesGuard` was wired as `APP_GUARD` provider inside `AdminModule`, the regression e2e suite failed 175 of 193 tests because `RolesGuard` was firing on every route (e.g., `/api/v1/health`) and rejecting non-admin authenticated users with 403 / anonymous with 401.

**Adopted resolution**: Replaced the global-provider approach with a composite class-level decorator `@AdminEndpoint()` (and `@AdminEndpointNoAudit()` for telemetry routes) at `src/admin/common/decorators/admin-endpoint.decorator.ts`. Each admin controller applies this decorator, which bundles `JwtAuthGuard`, `RolesGuard`, `AuditLogInterceptor`, and `@Roles(Role.ADMIN)` in a single `applyDecorators()` call. `RolesGuard` and `AuditLogInterceptor` are exported as regular providers from `AdminModule` (not as `APP_*` tokens) so sub-modules importing `AdminModule` resolve them via DI.

**Behavioral contract preserved**:
- 401 for anonymous, 403 for non-admin, 200 for admin (unchanged) — verified by e2e.
- Audit log emits exactly one entry per admin mutation, zero on GET (unchanged) — verified by e2e.
- Single annotation per controller (Q4's "import once, inherit everything" goal preserved at the decorator level instead of the module-imports level).

**Trade-off accepted**: A developer who creates a new admin controller and forgets `@AdminEndpoint()` exposes the routes. Mitigation: the documented code-review checklist in `docs/admin-foundation.md` and a future ESLint rule that asserts every controller class under `src/admin/**` carries `@AdminEndpoint()` or `@AdminEndpointNoAudit()` (tracked as a follow-up enhancement, not blocking acceptance).

**Affected requirements**: FR-005 (RolesGuard scoping), FR-005a (default-deny), FR-019/FR-021 (audit interceptor scope). The functional behavior of these FRs is unchanged; only the activation mechanism differs.

### Session 2026-05-01

- Q: How should `RolesGuard` be activated so that `/admin/*` is default-deny without affecting other modules? → A: Register `RolesGuard` as an `APP_GUARD` provider inside `AdminModule` (provider-scoped, not global). The guard fires only on routes mounted under `AdminModule` (or its imported sub-modules). The guard treats absence of `@Roles(...)` metadata as default-deny in the admin scope. The guard contains no URL-prefix sniffing.
- Q: How should the admin success envelope and error shape relate to the existing global `ResponseTransformInterceptor` and `HttpExceptionFilter`? → A: Reuse them as-is. Document `{ data, message }` (success) and `{ statusCode, errorCode, message, errors? }` (error) as the canonical admin contract — they are already platform-wide. This feature does NOT introduce a new admin-scoped interceptor or filter. It DOES add admin-relevant codes (e.g., `FORBIDDEN`, `INSUFFICIENT_ROLE`) to the existing `ErrorCode` enum and document the contract.
- Q: How should the audit logger be delivered (the user spec called it "middleware" but Nest middleware can't read the matched route pattern)? → A: Implement as a NestJS interceptor registered as `APP_INTERCEPTOR` inside `AdminModule`. The interceptor reads the matched route pattern from `req.route.path`, reads `req.user` (populated by `JwtAuthGuard`), and emits exactly one structured log entry on POST/PATCH/DELETE under `/admin/*`. The user spec's term "middleware" is interpreted loosely as "cross-cutting concern" — functionally an interceptor.
- Q: How should future per-entity admin sub-modules (Categories, Paths, Courses, Sections, Lessons, Content Blocks, Users, etc.) attach to the foundation? → A: Sub-modules MUST be imported into `AdminModule.imports` (NOT into `AppModule.imports`). Their controllers use a `/admin/<entity>` route prefix. Because they are children of `AdminModule`, they inherit the `RolesGuard` (`APP_GUARD`) and audit interceptor (`APP_INTERCEPTOR`) automatically. Forgetting to import a sub-module into `AdminModule` is the only way it could escape the foundation — a single, reviewable choke point.
- Q: Where should the shared bulk-reorder DTO live so it is reusable by future admin sub-modules? → A: `src/admin/common/dto/reorder-items.dto.ts`. Reordering is admin-only by definition (only admins mutate `sortOrder`), so the DTO is co-located inside the admin tree alongside other admin primitives. Future admin sub-modules import it as `import { ReorderItemsDto } from 'src/admin/common/dto/reorder-items.dto'`.
- Q: What casing should role string literals use? Spec text used lowercase (`'admin'`, `'learner'`) as a placeholder, but the codebase issues JWT `roles` as the Prisma `Role` enum's TypeScript values, which are UPPERCASE. → A: UPPERCASE everywhere in admin code. `@Roles(Role.ADMIN)`, JWT carries `['ADMIN']` / `['LEARNER']`, `RolesGuard`'s default-deny constant is `[Role.ADMIN]`. Admin code MUST import the `Role` enum from `@prisma/client` (or via the convenience re-export at `src/admin/common/constants/roles.const.ts`) rather than typing string literals. The DB column remains lowercase via Prisma's `@map`, but no admin code touches that representation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin user reaches an admin route (Priority: P1)

A platform administrator with `role = admin` calls any registered route under `/admin/*` carrying a valid JWT. The request passes authentication, passes the role check, runs the audit log emission for mutations, and reaches the controller body successfully. The response comes back inside the documented admin success envelope.

**Why this priority**: This is the load-bearing happy path. Every per-entity admin feature (KAN-82 onward) is blocked until an admin can actually reach a handler through the shared layer. Without this, the entire admin epic cannot start in parallel.

**Independent Test**: Mount a temporary `/admin/health` (or `/admin/__ping`) route guarded by `@Roles('admin')`, send a request with an admin-role JWT, assert the controller executes and the response matches the documented success envelope.

**Acceptance Scenarios**:

1. **Given** an authenticated user holding `admin` role and a registered `/admin/health` route, **When** they `GET /admin/health`, **Then** the controller body executes and the response body matches the documented admin success envelope.
2. **Given** an admin user issuing a mutation against an admin route, **When** the request is processed, **Then** an audit log entry is emitted before the response is returned, and the response still arrives inside the success envelope.
3. **Given** a user holding multiple roles including `admin`, **When** they call any `/admin/*` route, **Then** access is granted (admin among the roles is sufficient).

---

### User Story 2 - Non-admin authenticated user is blocked with a clear 403 (Priority: P1)

A learner (authenticated but without `admin` role) attempts — by mistake or maliciously — to call any `/admin/*` route. The system rejects the request with a structured 403 response that explains the failure without leaking stack traces or internal details.

**Why this priority**: Security-critical. The guard must default-deny non-admin access from day one, before any per-entity admin module is wired in. A leak here compromises every future admin endpoint.

**Independent Test**: Send a request to `/admin/health` with a JWT whose payload carries only `learner` role; assert HTTP 403, assert the body matches the documented error shape, assert no stack trace appears in the response.

**Acceptance Scenarios**:

1. **Given** an authenticated learner with no `admin` role, **When** they call any `/admin/*` route, **Then** the system responds with HTTP 403 and the body matches the documented admin error shape (`code`, `message`, optional `details`, optional `errors`).
2. **Given** any non-admin authenticated request to `/admin/*`, **When** rejected, **Then** the response body contains no stack trace, no internal exception class names, and no database/internal identifiers.

---

### User Story 3 - Unauthenticated user is blocked with a clear 401 (Priority: P1)

An anonymous client (no JWT or an invalid/expired JWT) calls an `/admin/*` route. The system rejects with HTTP 401 and the documented error shape, indicating that authentication is required.

**Why this priority**: Security-critical, paired with US2. Distinguishing 401 (auth missing) from 403 (auth insufficient) is required by spec acceptance criteria and is what API consumers expect.

**Independent Test**: Send a request to `/admin/health` with no `Authorization` header (and no auth cookie); assert HTTP 401 and the documented error shape. Repeat with an obviously invalid token; assert HTTP 401.

**Acceptance Scenarios**:

1. **Given** a client with no JWT, **When** they call any `/admin/*` route, **Then** the system responds with HTTP 401 and the documented admin error shape.
2. **Given** a client with an expired or invalid JWT, **When** they call any `/admin/*` route, **Then** the system responds with HTTP 401 and the documented admin error shape.

---

### User Story 4 - Future developer adds a new admin entity with zero re-wiring (Priority: P2)

A developer is asked to add a "Tags admin CRUD". They create a `TagsAdminModule`, import it into the central `AdminModule`, and tag their handlers with `@Roles('admin')`. They do NOT manually wire the role guard, the success envelope, the error filter, or the audit middleware — those apply automatically because the module is mounted under `AdminModule`. The repo contains documentation that walks through this exact procedure.

**Why this priority**: Developer experience and consistency safeguard. Any per-entity admin module that bypasses the shared layer creates a security/consistency gap. Locking in the pattern (and documenting it) prevents drift.

**Independent Test**: Follow the documented "add a new admin sub-module" walk-through end-to-end against a stub entity. Verify that, with no additional wiring, the new endpoints (a) reject non-admins with 403, (b) reject anonymous with 401, (c) return the success envelope on the happy path, (d) emit audit logs on mutations.

**Acceptance Scenarios**:

1. **Given** the documented procedure, **When** a developer registers a new sub-module under `AdminModule`, **Then** all guards, envelope shaping, and audit logging apply with no additional configuration on the sub-module's controllers.
2. **Given** the in-repo documentation (README section or `docs/admin.md`), **When** a developer reads it, **Then** they find: how to wire a new sub-module, the exact success envelope shape with examples, the exact error shape with examples, and how `@Roles('admin')` and `RolesGuard` work together.

---

### User Story 5 - Audit trail captures every admin mutation (Priority: P3)

A security/compliance reviewer needs to confirm that every content-affecting admin action is traceable. Every admin mutation (POST, PATCH, DELETE) emits exactly one structured log entry containing who acted, what they acted on, and when — even though no database table backs the audit yet.

**Why this priority**: Required for compliance posture and incident forensics, but the request itself succeeds whether or not the log line is written. It can ship after US1–US3 land. Persistence to a DB table is explicitly out of scope here and tracked as a follow-up.

**Independent Test**: Capture the application logger output during an admin mutation (e.g., `POST /admin/health`) and assert a single structured entry exists containing `userId`, `userEmail`, `role`, `action` (HTTP method + route pattern), `route` (the pattern, not the raw URL with IDs), ISO-8601 `timestamp`, client `ip`, and `userAgent`.

**Acceptance Scenarios**:

1. **Given** an admin mutation request (POST/PATCH/DELETE) to any `/admin/*` route, **When** the request is processed, **Then** exactly one structured log entry is emitted with all required fields.
2. **Given** an admin GET request to any `/admin/*` route, **When** the request is processed, **Then** no audit log entry is emitted (reads are not audited at this stage).
3. **Given** a request to `/admin/users/<uuid>`, **When** the audit entry is emitted, **Then** the `route` field contains the matched pattern (e.g., `/admin/users/:id`) — not the raw URL with the actual UUID.
4. **Given** the structured logger fails to write for any reason, **When** the failure occurs, **Then** the original request still completes successfully (logging is best-effort, never blocking).

---

### Edge Cases

- **JWT present but expired**: handled the same as missing JWT — 401 with the admin error shape.
- **Admin route handler that forgets to add `@Roles('admin')`**: foundation must default-deny on `/admin/*` so an accidental omission cannot expose an endpoint. Resolved via FR-005 + FR-005a: `RolesGuard` is registered as `APP_GUARD` inside `AdminModule` only, and treats missing `@Roles(...)` metadata in that scope as default-deny (403). No URL sniffing.
- **User holds multiple roles including admin**: granted (admin in the role list is sufficient).
- **Bulk-reorder DTO with empty array**: rejected — a reorder call with zero items is not meaningful and likely indicates a client bug. Rejected with a field-level validation error.
- **Bulk-reorder DTO with one item**: accepted (valid no-op-like single-item reorder).
- **Bulk-reorder DTO with duplicate `id`s**: rejected with a field-level validation error pointing at the duplicate.
- **Bulk-reorder DTO with duplicate `sortOrder` values across different `id`s**: accepted at the DTO layer (consumer services decide whether collisions are valid for their entity).
- **Bulk-reorder DTO with negative or non-integer `sortOrder`**: rejected with a field-level validation error.
- **Non-admin route shape regression**: this feature reuses the existing global `ResponseTransformInterceptor` and `HttpExceptionFilter` (per Clarifications Q2). It introduces NO new admin-scoped interceptor or filter, so by construction non-admin endpoints' response shapes cannot change.
- **Logger throws while recording an audit entry**: the request must still complete successfully; the logging failure is itself logged at warn level but does not propagate.
- **Very large request body on a mutation**: the audit entry records metadata only (method, route, user, IP, agent, timestamp). It does NOT record the request body — to keep log volume bounded and avoid leaking sensitive payloads.

## Requirements *(mandatory)*

### Functional Requirements

**Role-based access control**

- **FR-001**: System MUST require a valid JWT for every route mounted under `/admin/*`. Requests without one MUST receive HTTP 401.
- **FR-002**: System MUST require the authenticated user to hold the `admin` role for every route under `/admin/*`. Authenticated requests without that role MUST receive HTTP 403.
- **FR-003**: System MUST provide a reusable `@Roles('admin')` decorator that future admin handlers can apply to declare role requirements.
- **FR-004**: System MUST provide a `RolesGuard` that reads the required role(s) from the decorator metadata and the user's role(s) from the JWT payload, granting access only when at least one required role is present in the user's roles.
- **FR-005**: `RolesGuard` MUST be registered as an `APP_GUARD` provider inside `AdminModule` (provider-scoped, NOT registered globally in `AppModule`). The guard MUST therefore fire only on routes mounted under `AdminModule` and any sub-modules imported into it; non-admin endpoints elsewhere in the API MUST be unaffected.
- **FR-005a**: When `RolesGuard` runs (i.e., on `/admin/*` routes) and the handler has no `@Roles(...)` metadata, the guard MUST default-deny with HTTP 403. The guard MUST NOT inspect the request URL/prefix to make this decision — the default-deny behavior follows from the guard's restricted activation scope (AdminModule), not from URL sniffing.

**Admin module skeleton**

- **FR-006**: System MUST provide a central `AdminModule` that serves as the parent container for all per-entity admin sub-modules added in future features. Per-entity sub-modules MUST be registered via `AdminModule.imports` (NOT via `AppModule.imports`) so they live inside `AdminModule`'s provider scope.
- **FR-007**: System MUST expose a documented, repeatable convention for adding a new per-entity admin sub-module: (a) create `<Entity>AdminModule` with a controller using `@Controller('admin/<entity>')`, (b) tag handlers with `@Roles('admin')`, (c) add the new module to `AdminModule.imports`. With this convention the sub-module inherits the `RolesGuard` and audit interceptor automatically — no per-controller wiring is required.
- **FR-008**: System MUST include at least one test admin route (e.g., `/admin/health` or `/admin/__ping`) that exercises the full foundation stack end-to-end and is covered by an automated e2e test.

**Shared bulk-reorder DTO**

- **FR-009**: System MUST provide a reusable bulk-reorder DTO with the shape `Array<{ id: string, sortOrder: number }>` at the canonical path `src/admin/common/dto/reorder-items.dto.ts`. Future admin sub-modules (Sections, Lessons, Content Blocks, and possibly Paths and Courses) import it from there.
- **FR-010**: The bulk-reorder DTO MUST validate that every `id` is a UUID, every `sortOrder` is a non-negative integer, and the array contains no duplicate `id` values.
- **FR-011**: The bulk-reorder DTO MUST reject empty arrays (a reorder request must contain at least one item).
- **FR-012**: The bulk-reorder DTO is explicitly NOT used by Categories — Categories are sorted by `createdAt` descending and have no manual reordering.
- **FR-013**: The bulk-reorder DTO MUST be covered by unit tests covering: valid payload, non-UUID `id`, negative `sortOrder`, non-integer `sortOrder`, duplicate `id`s, and empty array.

**Consistent admin response format**

- **FR-014**: System MUST return all successful admin responses inside the existing platform-wide success envelope `{ data, message }` (as already produced by the global `ResponseTransformInterceptor`). This feature MUST NOT introduce a new admin-scoped success interceptor.
- **FR-015**: System MUST return all admin error responses (validation errors, auth/role rejections, not-found, conflicts, internal failures) inside the existing platform-wide error shape `{ statusCode, errorCode, message, errors? }` (as already produced by the global `HttpExceptionFilter`). This feature MUST NOT introduce a new admin-scoped exception filter.
- **FR-016**: The admin error shape MUST never include stack traces, internal exception class names, raw database errors, or any other internal implementation detail. (Already satisfied by the existing global filter; this feature does not regress that behavior.)
- **FR-017**: This feature MUST add admin-relevant error codes to the existing `ErrorCode` enum at minimum: `FORBIDDEN` (for 403 from `RolesGuard`) and `INSUFFICIENT_ROLE` (or equivalent named code) so admin 401/403 responses carry a stable, documented `errorCode`.
- **FR-018**: The admin response contract — the canonical success envelope, the canonical error shape, and which `errorCode` values are returned by the admin layer (401, 403, validation, not-found, conflict, internal) — MUST be documented in the repo (in README or `docs/admin-foundation.md`) with at least one concrete example each for a 200 success, a 401, a 403, and a validation (422-style) error.

**Audit log middleware skeleton**

- **FR-019**: System MUST emit exactly one structured log entry for every admin mutation request — defined as any request to `/admin/*` whose HTTP method is `POST`, `PATCH`, `PUT`, or `DELETE`. The emitter MUST be implemented as a NestJS interceptor registered as `APP_INTERCEPTOR` inside `AdminModule` (not as Express-style `MiddlewareConsumer` middleware, because middleware cannot read the matched route pattern).
- **FR-020**: The audit log entry MUST include the following fields: `userId`, `userEmail`, `role` (or `roles`), `action` (HTTP method plus matched route pattern), `route` (the matched route pattern, not the raw URL), `timestamp` in ISO 8601, client `ip`, and `userAgent`. `userId`, `userEmail`, and `role(s)` MUST be read from `req.user` (already populated by the existing `JwtAuthGuard`).
- **FR-021**: The audit log entry MUST use the matched route pattern read from `req.route.path` (e.g., `/admin/users/:id`) rather than the raw URL — IDs and other path parameters MUST NOT appear in the `route` field. No URL-scrubbing or regex-based UUID stripping is required; the matched pattern is sourced directly from the resolved route.
- **FR-022**: The audit log entry MUST NOT include the request body. Only metadata is logged at this stage.
- **FR-023**: System MUST NOT emit an audit log entry for admin GET requests (read operations are not audited at this stage).
- **FR-024**: A failure inside the audit logging path MUST NOT cause the underlying request to fail. The original handler's response must still be returned.
- **FR-025**: Persistence of audit entries to a database table is explicitly out of scope for this feature — audit entries are written to the application logger only and are tracked as a follow-up feature.

**Documentation**

- **FR-026**: System MUST include in-repo documentation (README section or dedicated `docs/admin-foundation.md`) covering: (a) the procedure to wire a new per-entity admin sub-module under `AdminModule`, (b) the success envelope shape with at least one example, (c) the error shape with at least one example for a 401, a 403, and a 422-style validation error, (d) how `@Roles('admin')` and `RolesGuard` work together.

### Key Entities

- **`@Roles(...roles)` decorator**: Marks a handler (or controller) as requiring at least one of the listed roles. Stored as route metadata read by the guard.
- **`RolesGuard`**: Inspects route metadata, reads roles from the JWT payload attached to the request, and grants or denies access. Default behavior on `/admin/*`: deny when no admin role is present.
- **`AdminModule`**: The central NestJS module that hosts per-entity admin sub-modules and applies the shared guard, response envelope, exception filter, and audit middleware to everything mounted under it.
- **Bulk-reorder DTO** (e.g., `ReorderItemsDto`): A reusable validated DTO. Items are `{ id: UUID, sortOrder: non-negative integer }`. The collection rejects empty arrays and duplicate ids.
- **Admin success envelope**: A documented response shape applied uniformly to every successful admin response.
- **Admin error shape**: A documented response shape applied uniformly to every admin error, with `code`, `message`, optional `details`, and optional field-level `errors`.
- **Audit log entry**: A structured log line emitted on admin mutations, carrying `userId`, `userEmail`, `role`, `action`, `route`, `timestamp`, `ip`, `userAgent`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of routes mounted under `/admin/*` reject anonymous (no-JWT and invalid-JWT) requests with HTTP 401 and the documented error shape — verified by an e2e test on the `/admin/health` test route.
- **SC-002**: 100% of routes mounted under `/admin/*` reject authenticated non-admin users with HTTP 403 and the documented error shape — verified by the same e2e test with a learner JWT.
- **SC-003**: A registered admin user reaches the `/admin/health` controller body and receives the documented success envelope on a happy-path request — verified end-to-end.
- **SC-004**: 100% of admin mutation requests (POST, PATCH, PUT, DELETE) produce exactly one structured audit log entry containing all required fields with the route pattern correctly substituted (no raw IDs in the `route` field) — verified by a logger-capturing test.
- **SC-005**: 0% of admin GET requests produce an audit log entry — verified by the same test.
- **SC-006**: 100% of admin error responses (401, 403, validation, not-found, internal) conform to the documented error shape and contain no stack traces or internal exception class names — verified across the test suite.
- **SC-007**: The bulk-reorder DTO rejects 100% of malformed payloads in unit tests covering: non-UUID id, negative `sortOrder`, non-integer `sortOrder`, duplicate ids, empty array. Each rejection produces a field-level error pointing to the offending field.
- **SC-008**: A developer can register a new admin sub-module under `AdminModule` by following the documented procedure, with no edits to the guard, envelope, error filter, or audit middleware — measured by walking through the procedure in a stub branch and confirming guards/envelope/audit behavior all apply automatically. Target: under 30 minutes for a developer already familiar with the codebase.
- **SC-009**: Existing learner-facing and public endpoints' response shapes are unchanged after this feature lands — verified by running the existing endpoint test suite and confirming zero regressions in response-shape assertions.
- **SC-010**: When the audit logger throws synthetically inside a test, the underlying admin mutation still returns its normal success response — verified by a fault-injection test.

## Assumptions

- **Existing JWT auth is reused as-is.** This feature does not modify the auth system. The JWT payload (`src/auth/interfaces/jwt-payload.interface.ts`) already carries `roles: string[]`, and `JwtStrategy.validate` already attaches `{ userId, email, roles, ... }` to `req.user`. No new claims are added.
- **Roles already exist.** The `UserRole` table and the `learner` / `admin` enum values are already defined in the schema. This feature only consumes them via the JWT payload.
- **Existing global `ResponseTransformInterceptor` and `HttpExceptionFilter` are the admin contract.** The platform-wide success format `{ data, message }` and error format `{ statusCode, errorCode, message, errors? }` already produced by the globally-registered interceptor and filter ARE the admin contract. This feature does not introduce admin-scoped replacements; it adds admin-relevant `errorCode` values (FR-017) and documents the contract (FR-018, FR-026). See Clarifications Q2.
- **`@Roles(...roles)` already exists** at `src/common/decorators/roles.decorator.ts` and accepts varargs. `RolesGuard` already exists at `src/common/guards/roles.guard.ts` but is currently a no-op stub — this feature replaces the stub with the real implementation specified by FR-004 + FR-005 + FR-005a.
- **`AdminModule` already exists and is already imported in `AppModule`.** This feature retains the existing skeleton, registers `RolesGuard` and the audit interceptor as scoped providers inside it, and updates / replaces the placeholder controller with the test admin route required by FR-008.
- **Audit logging targets the application logger** (`@nestjs/common` `Logger`). No new logging infrastructure is introduced. Persistence to a DB table is explicitly a follow-up.
- **The audit interceptor reads `req.user` after `JwtAuthGuard` has populated it.** Mutations on `/admin/*` always traverse the global `JwtAuthGuard` before the admin-scoped audit interceptor runs, so `userId`, `userEmail`, and `roles` are reliably available.
- **Per-entity admin CRUD logic** (Categories, Paths, Courses, Sections, Lessons, Content Blocks, Users, etc.) is out of scope for this feature and is delivered in subsequent features starting with KAN-82.
- **Persisted audit-log table is out of scope** and is tracked as a follow-up feature.
- **Admin user management endpoints** (creating admin users, listing admins, revoking admin role) are out of scope and are delivered in KAN-61 and KAN-64.
- **Frontend admin app changes are out of scope** and are delivered in KAN-80 and KAN-81.
- **No password reset, 2FA, or other auth-system changes** are made here — auth is reused as-is.
- **The bulk-reorder DTO is a primitive shipped here for reuse.** It is not wired into any endpoint as part of this feature; consumers (Sections, Lessons, Content Blocks, possibly Paths and Courses) wire it in their own features. Categories explicitly do not use it (Categories are sorted by `createdAt DESC`).
