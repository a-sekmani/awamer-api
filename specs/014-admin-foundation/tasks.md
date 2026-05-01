---
description: "Task list for feature 014-admin-foundation (KAN-78)"
---

# Tasks: Admin Module Foundation — Backend (KAN-78)

**Input**: Design documents from `/specs/014-admin-foundation/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: Required. The spec mandates unit tests for `RolesGuard`, `@Roles()`, and `ReorderItemsDto` (FR-013 + acceptance criteria), and an e2e test for the test admin route (FR-008 + acceptance criteria).

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently. The 3 P1 stories (US1/US2/US3) share the same `RolesGuard` + `AdminHealthController` wiring — the implementation lands in US1, then US2 and US3 add their respective deny-path verification scenarios on top.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependencies on incomplete tasks
- **[Story]**: User story this task serves (US1..US5)
- File paths are absolute or relative to repo root

## Path Conventions

Single-project NestJS backend.
- Source: `src/`
- Tests: `test/` (e2e via `npm run test:e2e`) and co-located `*.spec.ts` files (unit via `npm test`)
- Docs: `docs/`

---

## Phase 1: Setup

**Purpose**: Confirm baseline state before changes — no tooling, build, or dependency changes are needed for this feature (per plan.md: "no new dependencies").

- [X] T001 [P] Verify baseline state: `src/admin/admin.module.ts` is the empty skeleton, `src/common/guards/roles.guard.ts` is a no-op stub returning `true`, `src/common/error-codes.enum.ts` does NOT yet contain `FORBIDDEN` or `INSUFFICIENT_ROLE` members. (Read-only sanity check; if any of these has drifted, raise it before proceeding.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared changes every user story depends on (`ErrorCode` extensions consumed by guard + e2e error-shape assertions; placeholder cleanup so the new wiring lands cleanly).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Add `FORBIDDEN` and `INSUFFICIENT_ROLE` members to the `ErrorCode` enum in `src/common/error-codes.enum.ts` under the existing `// Auth` group (per FR-017 and contracts/roles-decorator.contract.md). Do NOT remove or rename existing members.
- [X] T003 [P] Delete the placeholder `src/admin/admin.controller.ts` (the empty `getDashboard()` returning `{}` will be replaced by `AdminHealthController` in US1; leaving it would create a contradictory `GET /admin` returning `{}`).
- [X] T004 [P] Delete the empty placeholder service `src/admin/admin.service.ts`.
- [X] T005 Update `src/admin/admin.module.ts` to remove references to `AdminController` and `AdminService` deleted in T003/T004 — module ends this phase with `controllers: []`, `providers: []`, `exports: []`. Depends on T003 + T004.

**Checkpoint**: Foundation ready — admin tree is clean, `ErrorCode` carries admin codes. Proceed to user stories.

---

## Phase 3: User Story 1 — Admin user reaches an admin route (Priority: P1) 🎯 MVP

**Goal**: An authenticated admin user can call a registered route under `/admin/*`, pass `JwtAuthGuard` + `RolesGuard`, reach the controller body, and receive the documented success envelope `{ data, message: 'Success' }`.

**Independent Test**: With the existing global `JwtAuthGuard` and the new `RolesGuard`+`AdminHealthController` wired into `AdminModule`, `GET /api/v1/admin/__ping` with an admin JWT returns 200 with body `{ data: { ok: true }, message: 'Success' }`. Verified by an e2e scenario in `test/admin.e2e-spec.ts`.

### Tests for User Story 1

- [X] T006 [P] [US1] Replace contents of `src/common/guards/roles.guard.spec.ts` with the 7 unit-test cases from `specs/014-admin-foundation/contracts/roles-decorator.contract.md` § "Unit test coverage" (GUARD-T01 through GUARD-T07): admin allowed, learner denied with `INSUFFICIENT_ROLE`, missing metadata + admin user → allowed, missing metadata + learner → denied, multi-role intersection (admin OR editor), missing `req.user` → `UnauthorizedException`, empty `@Roles()` args → denied. Use Jest with Reflector mocking; do NOT spin up a full Nest TestingModule. Confirm tests FAIL against the current stub (which always returns `true`).
- [X] T007 [P] [US1] Create `src/common/decorators/roles.decorator.spec.ts` with the 3 cases from `specs/014-admin-foundation/contracts/roles-decorator.contract.md` § "Decorator unit test coverage" (DECO-T01 through DECO-T03): `@Roles('admin')` sets `['admin']`, `@Roles('admin', 'editor')` sets `['admin', 'editor']`, `@Roles()` sets `[]`. Use `Reflect.getMetadata(ROLES_KEY, target)` directly.

### Implementation for User Story 1

- [X] T008 [P] [US1] Replace stub in `src/common/guards/roles.guard.ts` with the real implementation per `specs/014-admin-foundation/contracts/roles-decorator.contract.md` § "Behavioral contract": (a) read required roles via `Reflector.getAllAndOverride(ROLES_KEY, [handler, class])`, (b) read `req.user` from `context.switchToHttp().getRequest()`, (c) throw `UnauthorizedException({ errorCode: ErrorCode.UNAUTHORIZED, message: 'Authentication required.' })` if no `req.user`, (d) default to `['admin']` when metadata is undefined or empty, (e) throw `ForbiddenException({ errorCode: ErrorCode.INSUFFICIENT_ROLE, message: 'Insufficient role.' })` when user roles do not intersect required roles. Make T006 pass.
- [X] T009 [P] [US1] Create `src/admin/controllers/admin-health.controller.ts`: `@Controller('admin')` class-level + `@Roles('admin')` class-level, with `@Get('__ping') ping(): { ok: true } { return { ok: true }; }`. Imports: `@nestjs/common` (`Controller`, `Get`), `src/common/decorators/roles.decorator` (`Roles`).
- [X] T010 [US1] Update `src/admin/admin.module.ts` to: (a) import `APP_GUARD` from `@nestjs/core`, `RolesGuard` from `src/common/guards/roles.guard`, `AdminHealthController` from `./controllers/admin-health.controller`; (b) register `controllers: [AdminHealthController]`; (c) register `providers: [{ provide: APP_GUARD, useClass: RolesGuard }]`. Do NOT register globally in `AppModule`. Depends on T008 + T009.
- [X] T011 [US1] Create `test/admin.e2e-spec.ts` with the foundation Test Module bootstrap (mirroring `test/auth.e2e-spec.ts:1-50` for AppModule + cookie-parser + ValidationPipe + global prefix `api/v1`). Add the first scenario: an admin user (created directly in the DB with `UserRole(role='admin')`, JWT signed via `JwtService`) `GET /api/v1/admin/__ping` → expects HTTP 200 and exact body `{ data: { ok: true }, message: 'Success' }`. Use the same `createTestUser` + `uniqueEmail` helper pattern as `test/auth.e2e-spec.ts`. Depends on T010.

**Checkpoint**: US1 fully functional. `npm run test:e2e -- --testPathPattern=admin` passes the 200 scenario; `npm test src/common/guards/roles.guard.spec.ts src/common/decorators/roles.decorator.spec.ts` passes 10 unit tests.

---

## Phase 4: User Story 2 — Non-admin authenticated user is blocked with a clear 403 (Priority: P1)

**Goal**: An authenticated learner calling any `/admin/*` route receives HTTP 403 with the documented error shape and `errorCode: 'INSUFFICIENT_ROLE'`.

**Independent Test**: e2e scenario in `test/admin.e2e-spec.ts` — request `/api/v1/admin/__ping` with a learner JWT (no `admin` role) returns 403 with body containing `statusCode: 403`, `errorCode: 'INSUFFICIENT_ROLE'`, `message` is human-readable, and NO `stack` / `name` / `cause` fields surface from the exception.

> **Note**: implementation lands entirely in US1 — `RolesGuard` already throws `ForbiddenException` on intersection failure. US2 contributes only the verification scenario.

### Tests for User Story 2

- [X] T012 [US2] Append a `describe('forbidden path', ...)` block to `test/admin.e2e-spec.ts` covering: (a) learner JWT (signed with `roles: ['learner']`) → `GET /api/v1/admin/__ping` returns 403 with `body.statusCode === 403`, `body.errorCode === 'INSUFFICIENT_ROLE'`, `body.message` is a string. (b) Assert `body.stack === undefined` and the response does NOT contain any internal exception class name. Same test file as T011; cannot run in parallel with T011/T013. Depends on T011 (file exists).

**Checkpoint**: 403 path verified. The same `RolesGuard` instance services US1 and US2 — no code change required for this story.

---

## Phase 5: User Story 3 — Unauthenticated user is blocked with a clear 401 (Priority: P1)

**Goal**: An anonymous client (no JWT, or invalid/expired JWT) calling any `/admin/*` route receives HTTP 401 with the documented error shape.

**Independent Test**: e2e scenarios in `test/admin.e2e-spec.ts` — (a) no `Authorization` header and no `access_token` cookie → 401; (b) malformed/invalid token → 401; (c) expired token → 401. All three return the platform error shape.

> **Note**: implementation lands in the existing global `JwtAuthGuard` + `JwtStrategy` (no changes by this feature). US3 contributes only the verification scenarios.

### Tests for User Story 3

- [X] T013 [US3] Append a `describe('unauthenticated path', ...)` block to `test/admin.e2e-spec.ts` covering: (a) no token → `GET /api/v1/admin/__ping` returns 401 with `body.statusCode === 401`; (b) syntactically invalid bearer token → 401; (c) expired token (sign with `expiresIn: '-1s'` and `noTimestamp: false` via `JwtService`) → 401. Confirm `body.stack === undefined` and no internal class names. Same test file as T011/T012. Depends on T011.

**Checkpoint**: All three P1 user stories verified end-to-end via `test/admin.e2e-spec.ts`. MVP complete.

---

## Phase 6: User Story 4 — Future developer adds a new admin entity with zero re-wiring (Priority: P2)

**Goal**: A future developer can add a per-entity admin sub-module by following one documented procedure and inherit the guard, response envelope, and audit interceptor automatically. Includes the shared `ReorderItemsDto` primitive that future sub-modules will reuse.

**Independent Test**: A reviewer (or scripted check) reads `docs/admin-foundation.md` and finds: (a) the sub-module registration walkthrough with a copy-paste template, (b) the response envelope shape with at least one example, (c) the error shape with at least one example each for 401/403/422, (d) explanation of `@Roles('admin')` + `RolesGuard`. Plus: `npm test src/admin/common/dto/reorder-items.dto.spec.ts` passes the 11 ReorderItemsDto cases.

### Tests for User Story 4

- [X] T014 [P] [US4] Create `src/admin/common/dto/reorder-items.dto.spec.ts` covering the 11 cases (DTO-T01 through DTO-T11) from `specs/014-admin-foundation/contracts/reorder-items.contract.md` § "Unit test coverage". Use `class-validator`'s `validate()` directly with `plainToInstance` from `class-transformer`; do NOT bootstrap a Nest TestingModule. Confirm tests FAIL until T015 lands.

### Implementation for User Story 4

- [X] T015 [P] [US4] Create `src/admin/common/dto/reorder-items.dto.ts` per `specs/014-admin-foundation/contracts/reorder-items.contract.md` § "TypeScript shape (target)": classes `ReorderItemDto` (`@IsUUID('4') id`, `@IsInt() @Min(0) sortOrder`) and `ReorderItemsDto` (`@IsArray() @ArrayMinSize(1) @ArrayUnique(o => o.id, { message: 'reorder items contain duplicate ids' }) @ValidateNested({ each: true }) @Type(() => ReorderItemDto) items`). Make T014 pass.
- [X] T016 [P] [US4] Create `docs/admin-foundation.md` with the four sections required by FR-026: (a) **Success envelope** — `{ data, message }` shape with an `/admin/__ping` example sourced verbatim from `specs/014-admin-foundation/contracts/admin-ping.openapi.yaml`; (b) **Error shape** — `{ statusCode, errorCode, message, errors? }` with concrete examples for 401 (no token), 403 (`INSUFFICIENT_ROLE`), and 422 (validation failure of `ReorderItemsDto`); (c) **`@Roles('admin')` + `RolesGuard`** — short explanation of decorator metadata, default-deny inside admin scope, decision matrix table from `specs/014-admin-foundation/contracts/roles-decorator.contract.md`; (d) **Sub-module registration** — copy-paste template (link to `specs/014-admin-foundation/quickstart.md` for the full walkthrough). Reserve a section header `## Audit Log` with placeholder text "Filled by US5 (KAN-78 §5)" — content lands in T021.
- [X] T017 [P] [US4] Update `README.md` to add a single-line reference under an "Admin" or "Documentation" section pointing to `docs/admin-foundation.md`. If `README.md` already has a docs index, append the link there; otherwise add a small "## Admin" section.

**Checkpoint**: `ReorderItemsDto` is shipped and tested. Documentation covers everything except audit log details. Future per-entity admin features (KAN-82+) can begin parallel implementation against this foundation.

---

## Phase 7: User Story 5 — Audit trail captures every admin mutation (Priority: P3)

**Goal**: Every admin mutation request (POST, PATCH, PUT, DELETE) emits exactly one structured log entry containing `userId`, `userEmail`, `roles`, `action`, `route` (matched pattern, not raw URL), `method`, `timestamp`, `ip`, `userAgent`, and `outcome`. GET requests emit no entry. Logger failures do not break the request.

**Independent Test**: e2e scenarios using a Jest spy on `Logger.prototype.log` (or equivalent) — POST emits one entry with the correct fields; GET emits zero entries; a synthetic logger throw still returns the normal response.

### Tests for User Story 5

- [X] T018 [P] [US5] Create `src/admin/interceptors/audit-log.interceptor.spec.ts` covering AUDIT-T01 through AUDIT-T06 from `specs/014-admin-foundation/contracts/audit-log.contract.md` § "Test cases". Mock `ExecutionContext` with `switchToHttp().getRequest()` returning `{ method, route: { path }, user, ip, headers: { 'user-agent' } }`. Spy on `Logger.prototype.log`. Use `lastValueFrom(interceptor.intercept(ctx, { handle: () => of(value) }).pipe(...))` for success and `throwError` for error path. Confirm tests FAIL until T019 lands.

### Implementation for User Story 5

- [X] T019 [US5] Create `src/admin/interceptors/audit-log.interceptor.ts` per `specs/014-admin-foundation/contracts/audit-log.contract.md`: `@Injectable()` class implementing `NestInterceptor`. In `intercept(ctx, next)`: (a) read `req = ctx.switchToHttp().getRequest()`; (b) skip emission and return `next.handle()` if `req.method ∉ {POST, PATCH, PUT, DELETE}` or if `req.route?.path` is undefined; (c) capture metadata `{ userId, userEmail, roles, action, route, method, timestamp, ip, userAgent }`; (d) return `next.handle().pipe(tap({ next: () => safelyLog({ ...meta, outcome: 'success' }), error: (e) => { safelyLog({ ...meta, outcome: 'error', statusCode: e?.status }); throw e; } }))`. The `safelyLog` helper wraps `this.logger.log(...)` in try/catch so logger failures are swallowed (FR-024). Use `private readonly logger = new Logger('AdminAudit')`. Make T018 pass.
- [X] T020 [US5] Update `src/admin/admin.module.ts` to add `{ provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor }` to the `providers` array (alongside the existing `RolesGuard` provider from T010), and import `APP_INTERCEPTOR` from `@nestjs/core` and `AuditLogInterceptor` from `./interceptors/audit-log.interceptor`. Depends on T019.
- [X] T021 [US5] Add a `@Post('__ping') postPing(): { ok: true } { return { ok: true }; }` method to `src/admin/controllers/admin-health.controller.ts` so the e2e suite has a mutation to exercise the audit interceptor against. Keep the existing `@Get('__ping')` handler for US1's read scenario. (This adds zero product surface — the route is gated by `@Roles('admin')` already at the class level.) Depends on T009.
- [X] T022 [US5] Append a `describe('audit log', ...)` block to `test/admin.e2e-spec.ts` covering: (a) admin `POST /api/v1/admin/__ping` → exactly one log entry whose payload contains `userId`, `userEmail`, `roles`, `action: 'POST /admin/__ping'`, `route: '/admin/__ping'`, `method: 'POST'`, ISO `timestamp`, `ip`, `userAgent`, `outcome: 'success'`; (b) admin `GET /api/v1/admin/__ping` → zero log entries; (c) admin `POST /api/v1/admin/__ping` with a synthetic `Logger.log` throw → response is still 200 (mutation succeeds despite logger failure). Use `jest.spyOn(Logger.prototype, 'log')` set up before the test and restored after. Depends on T020 + T021.
- [X] T023 [US5] Replace the placeholder "## Audit Log" section in `docs/admin-foundation.md` (created in T016) with the actual content per FR-026: when entries are emitted (POST/PATCH/PUT/DELETE only), full field list with sources (taken from `specs/014-admin-foundation/contracts/audit-log.contract.md` § "Field schema"), one example success entry and one example error entry, the failure-isolation guarantee. Cross-link to `specs/014-admin-foundation/contracts/audit-log.contract.md`.

**Checkpoint**: Audit logging fully wired. All five user stories verified end-to-end. `docs/admin-foundation.md` is complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T024 [P] Run the existing e2e suites to confirm zero regression on non-admin response shapes (FR-017, SC-009): `npm run test:e2e -- --testPathPattern='auth|onboarding|content|certificates|enrollment|app'`. Investigate any new failure that would indicate the new module-scoped `APP_GUARD`/`APP_INTERCEPTOR` providers leaked outside admin scope.
- [X] T025 [P] Confirm no public modules import from `src/admin/**`: run `git grep -l "from 'src/admin\\|from \"src/admin\\|from '../admin\\|from '../../admin'" src/ | grep -v '^src/admin/' | grep -v '^src/app.module.ts$'` — output MUST be empty (only `src/admin/**` files and `src/app.module.ts` may reference `src/admin`). Document any exception found.
- [X] T026 [P] Run `npm run lint` and `npm run build` to confirm clean lint and TypeScript strict-mode compilation across all new and modified files.
- [X] T027 [P] Run the full unit test suite `npm test` and confirm at least the new specs pass: `roles.guard.spec.ts` (7 cases), `roles.decorator.spec.ts` (3 cases), `reorder-items.dto.spec.ts` (11 cases), `audit-log.interceptor.spec.ts` (6 cases) — 27 new unit-test cases total.
- [X] T028 Final review of `docs/admin-foundation.md` for completeness against FR-026 (sub-module wiring procedure, success envelope example, error shape examples for 401/403/422, `@Roles`+`RolesGuard` explanation, audit log fields and example output). Cross-check that every FR-026 sub-bullet has a corresponding section.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T001 only — read-only sanity check. Can start immediately.
- **Phase 2 (Foundational)**: depends on Phase 1. Blocks all user stories. T002/T003/T004 parallel; T005 depends on T003+T004.
- **Phase 3 (US1, P1) MVP**: depends on Phase 2. Story can be implemented and verified independently.
- **Phase 4 (US2, P1)**: depends on Phase 3 (T011 must exist — same test file).
- **Phase 5 (US3, P1)**: depends on Phase 3 (T011 must exist). Independent of Phase 4.
- **Phase 6 (US4, P2)**: depends on Phase 3 (US4 docs reference the live envelope at `/admin/__ping`). Otherwise independent of US2/US3.
- **Phase 7 (US5, P3)**: depends on Phase 3 (interceptor mounts in same `AdminModule` and exercises against `AdminHealthController`). T021 modifies the controller built in T009. T023 modifies the doc created in T016 (US4) — so T023 sequences after T016. Otherwise independent of US2/US3/US4 implementation.
- **Phase 8 (Polish)**: depends on all desired user stories being complete. T024–T027 are parallel; T028 sequences after T023 (which lands the audit log doc section).

### Parallel Opportunities

| Group | Tasks | Reason |
|---|---|---|
| Foundational fan-out | T002, T003, T004 | Three independent files |
| US1 tests + impl can be authored together | T006, T007 (test files) and T008, T009 (impl files) | All distinct files; T010 then sequences after T008+T009 |
| US4 fan-out | T014, T015, T016, T017 | Distinct files (DTO test, DTO impl, doc, README) |
| US5 test + impl | T018, T019, T021 | T018 (test) and T019 (impl) different files; T021 (controller edit) different file from T020 (module edit) |
| Polish fan-out | T024, T025, T026, T027 | Independent verification commands |

### Within-story sequencing

- **US1**: T006 || T007 (tests) → T008 (impl, makes T006 pass) || T009 (controller) → T010 (module wiring) → T011 (e2e)
- **US2**: T012 (single append, sequential after T011)
- **US3**: T013 (single append, sequential after T011)
- **US4**: (T014 || T015 || T016 || T017) — all parallel
- **US5**: (T018 || T019) → T020 (module) || T021 (controller edit) → T022 (e2e) → T023 (doc fill-in)

---

## Parallel Example: User Story 1 kickoff

```bash
# After Phase 2 completes, kick off US1's parallel batch:
Task T006: Replace src/common/guards/roles.guard.spec.ts with 7 unit tests
Task T007: Create src/common/decorators/roles.decorator.spec.ts with 3 tests
Task T008: Replace src/common/guards/roles.guard.ts stub with real implementation
Task T009: Create src/admin/controllers/admin-health.controller.ts

# After T008 + T009 land, sequentially:
Task T010: Wire AdminModule
Task T011: First e2e scenario in test/admin.e2e-spec.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) — sanity check.
2. Phase 2 (T002–T005) — foundational cleanup and `ErrorCode` extensions.
3. Phase 3 (T006–T011) — US1: real `RolesGuard`, `AdminHealthController`, module wiring, unit tests, 200-path e2e.
4. **STOP and validate**: `curl /api/v1/admin/__ping` with admin JWT returns 200 with envelope. Run `npm run test:e2e -- --testPathPattern=admin` and `npm test src/common/guards src/common/decorators`.
5. Demo / merge if ready. The MVP unblocks every per-entity admin feature (KAN-82+) since the foundation contract is now real.

### Incremental Delivery

1. Setup + Foundational + US1 → MVP merge. Parallel admin features can begin (their PRs add to `AdminModule.imports` per the quickstart).
2. US2 + US3 — verification-only PRs adding deny-path e2e scenarios.
3. US4 — `ReorderItemsDto` + docs PR. Other admin features can now reuse the DTO.
4. US5 — audit logging PR. Surfaces structured log lines on every admin mutation across all features merged so far.
5. Polish — regression check + final doc pass.

### Parallel Team Strategy

After Phase 2, three streams can run simultaneously:

- **Stream A (security)**: US1 → US2 → US3 (same engineer; all touch the e2e file)
- **Stream B (DX/docs)**: US4 (T014–T017 all parallel internally)
- **Stream C (observability)**: US5 (depends on US1 controller existing — wait for T010 then go)

---

## Notes

- All checkbox tasks follow the strict `- [ ] T### [P?] [Story?] description with file path` format.
- `[P]` is applied conservatively — if two tasks touch the same file (e.g., `test/admin.e2e-spec.ts`, `src/admin/admin.module.ts`, `docs/admin-foundation.md`) they are NOT marked parallel even when they belong to different stories.
- 28 tasks total: 1 setup, 4 foundational, 6 US1, 1 US2, 1 US3, 4 US4, 6 US5, 5 polish.
- 27 new unit-test cases: 7 (RolesGuard) + 3 (Roles decorator) + 11 (ReorderItemsDto) + 6 (AuditLogInterceptor).
- E2E test file (`test/admin.e2e-spec.ts`) gains 6+ scenarios across US1/US2/US3/US5.
- No new dependencies. No Prisma schema changes. No changes to `src/auth/`, `src/main.ts`, `src/app.module.ts`, `src/common/interceptors/response-transform.interceptor.ts`, or `src/common/filters/http-exception.filter.ts`.
- Stop at any phase checkpoint and validate before proceeding.
