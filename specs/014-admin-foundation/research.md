# Phase 0 Research: Admin Module Foundation — Backend (KAN-78)

**Feature**: 014-admin-foundation
**Date**: 2026-05-01
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

## Status of Open Questions

All five `[NEEDS CLARIFICATION]`-grade ambiguities were resolved in `/speckit.clarify` (see `spec.md` § Clarifications, Session 2026-05-01). No unresolved unknowns remain. This research document records (a) the codebase grounding that confirmed each clarification answer, and (b) NestJS framework patterns used by the implementation.

## Decisions

### Decision 1 — RolesGuard activation strategy

**Decision**: Register `RolesGuard` as `APP_GUARD` provider inside `AdminModule` (provider-scoped, not global). On the admin scope, missing `@Roles(...)` metadata default-denies (HTTP 403). The guard does not inspect the request URL.

**Rationale**: NestJS module-provider-scoped `APP_GUARD` activates only on routes whose owning module imports the provider. By placing it in `AdminModule`, the guard fires for every controller mounted under `AdminModule` and every controller in any sub-module imported into `AdminModule.imports` (per Decision 4). Other modules (Auth, Users, Content, Learning, etc.) are unaffected because their providers do not see this `APP_GUARD`. This eliminates URL-prefix sniffing inside the guard — its scope is enforced by Nest's DI hierarchy, not by string comparison. Default-deny on missing metadata is safe because the guard only runs in admin scope; non-admin endpoints (which never have `@Roles`) are never reached by this guard at all.

**Alternatives considered**:
- *Global `APP_GUARD` with URL prefix check*: rejected — couples the guard to URL strings, requires every developer to remember the special case, leaks admin scope into a "common" guard.
- *Per-controller `@UseGuards(RolesGuard)` + `@Roles('admin')`*: rejected — a forgotten decorator silently exposes the route. No single choke point for security review.

**Codebase grounding**:
- `src/common/guards/roles.guard.ts` exists today as a stub (`return true` regardless of metadata). It will be replaced.
- `src/common/decorators/roles.decorator.ts` already defines `Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)` — varargs, ready to reuse.
- `src/auth/interfaces/jwt-payload.interface.ts` defines `roles: string[]`; `JwtStrategy.validate` returns `{ userId, email, ..., roles }` — `req.user.roles` is reliably available after `JwtAuthGuard`.

### Decision 2 — Reuse existing global response interceptor and exception filter

**Decision**: Do not create admin-scoped success interceptors or exception filters. The existing globally-registered `ResponseTransformInterceptor` (`{ data, message: 'Success' }`) and `HttpExceptionFilter` (`{ statusCode, errorCode, message, errors? }`) are reused as the admin contract. Add admin-relevant codes to the existing `ErrorCode` enum.

**Rationale**: The existing global pieces already produce shapes that match the spec's admin envelope and admin error shape (the field-level `errors` array, stable `errorCode`, and absence of stack traces are already implemented in `src/common/filters/http-exception.filter.ts`). Adding parallel admin-scoped versions would create dual code paths that drift over time and would split the frontend's response-handling logic. The existing platform-wide CLAUDE.md explicitly defines `{ data, message }` as the canonical shape — admin endpoints adopting it is the consistent choice.

**Alternatives considered**:
- *New admin-scoped interceptor/filter as `APP_INTERCEPTOR`/`APP_FILTER` providers in `AdminModule`*: rejected — duplicates working code, creates two contracts, future drift risk is high.
- *Augment global behavior conditionally for admin routes*: rejected — adds branching to a pure pipeline.

**Codebase grounding**:
- `src/common/interceptors/response-transform.interceptor.ts` already returns `{ data, message: 'Success' }`.
- `src/common/filters/http-exception.filter.ts` already produces `{ statusCode, message, errorCode?, errors? }` and includes a passthrough mechanism for special keys (`upgradeUrl`, `parentPathId`, `reason`). Stack traces are explicitly stripped (the `else` branch returns generic 500 text and only logs the real error server-side).
- Both are registered as `APP_INTERCEPTOR` and `APP_FILTER` in `src/app.module.ts`.

**Action this feature takes**:
- Add `ErrorCode.FORBIDDEN` and `ErrorCode.INSUFFICIENT_ROLE` to `src/common/error-codes.enum.ts` (FR-017).
- The new `RolesGuard` throws `ForbiddenException` with `{ errorCode: ErrorCode.INSUFFICIENT_ROLE, message: '...' }` so the existing filter surfaces both fields verbatim. The default 401 from `JwtAuthGuard` already gets `UNAUTHORIZED`-flavored handling (the existing filter sets `errorCode` only when present on the response object — for 401 it falls back to message-only, which the documentation will reflect).

### Decision 3 — Audit logging as a NestJS interceptor (not classical middleware)

**Decision**: Implement audit logging as a NestJS interceptor at `src/admin/interceptors/audit-log.interceptor.ts`, registered as `APP_INTERCEPTOR` provider inside `AdminModule`. Reads `req.route.path` (matched pattern) and `req.user` (populated by `JwtAuthGuard` upstream). Filters HTTP method ∈ {POST, PATCH, PUT, DELETE}. Uses RxJS `tap(...)` and `catchError(...)` to emit on both success and failure outcomes. Failures inside the logger are caught and ignored — never propagated to the request pipeline.

**Rationale**: NestJS classical Express middleware (`MiddlewareConsumer`) runs BEFORE route resolution. At that point, only `req.url` (raw URL, including UUIDs) is available; `req.route.path` is undefined. The user spec requires the matched route pattern (FR-021), which means UUIDs must NOT appear in the `route` field. An interceptor runs AFTER route resolution and AFTER guards (so `req.user` is populated), and `req.route.path` is set by Express to the registered pattern (e.g., `/admin/users/:id`). RxJS `tap` + `catchError` give equally clean handling for both 2xx and 4xx/5xx outcomes.

**Alternatives considered**:
- *Express middleware via `MiddlewareConsumer`*: rejected — cannot read matched pattern without regex-scrubbing UUIDs out of the raw URL, which is brittle.
- *A "logging" guard*: rejected — guards return boolean access decisions; using one for cross-cutting logging confuses semantics.
- *NestJS event listener via `@OnEvent`*: rejected — requires emitting a domain event from every controller, defeating the "import once, inherit everything" goal.

**Codebase grounding**:
- The existing global `ResponseTransformInterceptor` runs as `APP_INTERCEPTOR` at app scope. Module-scoped `APP_INTERCEPTOR` providers are stacked AFTER global ones, so the audit interceptor running inside `AdminModule` has full visibility (ordering is consistent across Nest 10/11). The interceptor logs the audit entry inside `tap()`/`catchError()` — by the time those run, the matched route is finalized.
- Existing project uses `@nestjs/common` `Logger` (e.g., `src/common/filters/http-exception.filter.ts:14`). The audit interceptor uses the same logger — no new logging library introduced.

### Decision 4 — Sub-module registration pattern

**Decision**: Per-entity admin sub-modules (Categories, Paths, Courses, Sections, Lessons, Content Blocks, Users, Tags, etc.) MUST be imported into `AdminModule.imports`, NOT into `AppModule.imports`. Their controllers use `@Controller('admin/<entity>')` and tag handlers with `@Roles('admin')`. They inherit the `RolesGuard` and audit interceptor automatically because both providers are scoped to `AdminModule`.

**Rationale**: NestJS DI cascades providers to imported modules. By imposing the convention "all admin sub-modules import into AdminModule", we get a single review choke point — `git diff AdminModule.imports` answers the question "what is admin-protected?". This also satisfies User Story 4 ("import once, inherit everything") and prevents the failure mode where a sub-module is added to `AppModule` and accidentally bypasses the audit interceptor or guard.

**Alternatives considered**:
- *Sub-modules import directly into `AppModule`* with the `/admin/...` URL prefix: rejected — bypasses the providers in `AdminModule` and silently disables both the guard and audit logging.
- *Sub-modules import `AdminModule` themselves to "borrow" providers*: rejected — re-export logistics get awkward, circular-import risk grows, and the choke point disperses.

**Codebase grounding**:
- `src/app.module.ts:26,89` already imports `AdminModule` once. Future feature PRs touch only `AdminModule.imports`, never `AppModule.imports` for admin work.

### Decision 5 — Shared admin primitives location

**Decision**: `ReorderItemsDto` lives at `src/admin/common/dto/reorder-items.dto.ts`. Future shared admin DTOs go in the same `src/admin/common/dto/` folder. Public modules (Content, Learning, Users, Auth, etc.) MUST NOT import from `src/admin/**`.

**Rationale**: Reordering (mutating `sortOrder`) is an admin-only concern by definition — learners never POST a reorder payload. Co-locating the DTO under `src/admin/common/dto/` keeps the admin surface area discoverable in one place. Forbidding non-admin imports from `src/admin/**` prevents accidental leakage of admin primitives into learner-facing modules. (No tooling enforces the import boundary in v1; it's a documented and reviewed convention. A lint rule can be added later if drift is observed.)

**Alternatives considered**:
- *`src/common/dto/`* (platform-wide common): rejected — overstates reusability since reordering is admin-only.
- *`src/common/admin/dto/`* (a new "admin-flavored common" subdirectory): rejected — adds a new tree without a strong reason; `src/admin/common/` already exists conceptually after this feature.

**Codebase grounding**:
- `src/common/error-codes.enum.ts` is the prior-art for sharing a cross-cutting primitive from a `common/` location. This feature follows the same pattern, scoped to admin via `src/admin/common/`.

## NestJS Patterns Confirmed

### `class-validator` for "no duplicate ids" rule

`@ArrayUnique(o => o.id)` — `class-validator` ships this decorator out of the box. Confirmed available at the installed version (`class-validator@0.15.1`). Avoids writing a custom `@ValidatorConstraint`.

### Reading the matched route pattern in an interceptor

```ts
const req = context.switchToHttp().getRequest();
const routePattern = req.route?.path; // e.g. '/admin/users/:id'
```

Express attaches `req.route` after route resolution. In an interceptor, `req.route.path` is reliably set. (In classical NestJS middleware, it is `undefined` — confirming the rationale for Decision 3.)

### RxJS `tap` + `catchError` for both outcomes

```ts
return next.handle().pipe(
  tap({ next: () => emitAudit({ outcome: 'success' }), error: (e) => emitAudit({ outcome: 'error', status: e.status }) }),
);
```

`tap` with both `next` and `error` handlers (or alternatively `tap()` for success and `catchError(...)` re-throwing for failure) lets one interceptor cover both happy path and failure path with a single subscription. Standard Nest pattern.

### Logger structured fields

```ts
const logger = new Logger('AdminAudit');
logger.log({ userId, userEmail, role, action, route, timestamp, ip, userAgent });
```

`@nestjs/common` `Logger.log(message)` accepts an object as the first argument and serializes it via the registered logger transport. Existing filter at `src/common/filters/http-exception.filter.ts:14` uses the same `Logger` API. No JSON-formatting library needed.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `RolesGuard` runs but `req.user` is null (e.g., a route forgot to be protected by `JwtAuthGuard`). | `JwtAuthGuard` is registered as a global `APP_GUARD` in `src/app.module.ts:101`. By construction, every admin route has already gone through it (unless explicitly marked `@Public()`, which an admin route should never be). The new guard MUST defensively assert `req.user` exists and throw `UnauthorizedException` if not — covered by FR-001 and tests. |
| Module-scoped `APP_GUARD` does not actually scope the way we expect (NestJS edge case). | Phase 1 e2e test asserts: a non-admin route is unaffected by the new guard. The e2e suite already exercises non-admin routes (`auth.e2e-spec.ts`, `onboarding.e2e-spec.ts`); regressions there would surface immediately. |
| `req.route.path` returns the wrong value when the request 404s (no matching route). | A 404 is thrown before the audit interceptor's `next.handle()` resolves on a real route. The interceptor uses `tap`/`catchError` and skips the log emission when `req.route` is undefined — defensive null check. |
| `class-validator`'s `@ArrayUnique` does not produce a clear field-level error path. | Custom error message is set via `@ArrayUnique(o => o.id, { message: 'reorder items contain duplicate ids' })`. The existing global filter already serializes `class-validator` array messages into the `errors` field of the response (see `http-exception.filter.ts:46-49`). |
| Test admin route `/admin/__ping` is reachable in production. | The route is innocuous (returns no data) and is gated by `@Roles('admin')`. The endpoint is documented as a wiring test, not a production-meaningful endpoint. If concern arises later, a follow-up can put it behind `if (NODE_ENV !== 'production')` or remove it once enough real admin endpoints exist. |

## Out of Scope (Confirmed)

Per spec § Out of scope and per Clarifications session:

- Per-entity admin CRUD logic (Categories, Paths, Courses, Sections, Lessons, Content Blocks, Users, etc.) — KAN-82+
- Persisted audit log table — follow-up feature
- Admin user management endpoints — KAN-61, KAN-64
- Frontend admin app changes — KAN-80, KAN-81
- Auth-system changes (password reset, 2FA, session lifetime) — none

## Open Questions

None. All clarifications resolved before this document was produced.
