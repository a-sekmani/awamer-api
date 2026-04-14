# Tasks: Tags Module (KAN-71)

**Input**: Design documents from `/specs/009-tags-module/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Tests ARE required for this feature. KAN-71 §10 and §11 prescribe specific unit + e2e tests and lists them in the Definition of Done.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on in-progress tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are absolute repository paths rooted at `awamer-api/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the skeleton directories, jest config, and npm scripts that every story will land into.

- [X] T001 Create directories `src/content/` and `src/content/tags/dto/` and `src/content/tags/helpers/`.
- [X] T002 Create directories `test/content/` and `test/content/tags/`.
- [X] T003 [P] Create `test/content-e2e-jest.config.js` with `rootDir: '..'`, `testRegex: 'content/.*\\.e2e-spec\\.ts$'`, `globalSetup: '<rootDir>/schema/global-setup.ts'`, `maxWorkers: 1`, `testTimeout: 30000`, and `ts-jest` transform with `isolatedModules: true`. Model it on `test/schema/jest.config.js`.
- [X] T004 [P] Add two scripts to `package.json`: `"test:content:e2e": "jest --config test/content-e2e-jest.config.js"` and (if not already present) verify the existing `test:schema` entry is untouched.

**Checkpoint**: Directories exist and the new jest config is wired. No production code yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Stand up the `ContentModule` shell and register it in `AppModule` so that every subsequent story can land controllers and services into a known module.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 Create `src/content/content.module.ts` exporting an empty `@Module({ imports: [PrismaModule], controllers: [], providers: [], exports: [] })` named `ContentModule`. Copy the import style from `src/auth/auth.module.ts`.
- [X] T006 Register `ContentModule` in `src/app.module.ts` by adding it to the `imports` array alongside existing modules. Keep the rest of `app.module.ts` untouched.
- [X] T007 Run `npm run build` once — it must pass with zero TypeScript errors before any user story begins.

**Checkpoint**: `ContentModule` is registered and the app compiles. Stories US1/US2/US3 can now proceed independently.

---

## Phase 3: User Story 1 — Public visitors browse the active tag vocabulary (Priority: P1) 🎯 MVP

**Goal**: Ship `GET /api/v1/tags` returning only `ACTIVE` tags with live-computed `pathCount` and `courseCount` (restricted to `PUBLISHED` paths/courses), sorted alphabetically, empty array when none, with a `Cache-Control: public, max-age=60` header.

**Independent Test**: Seed three active tags and one hidden tag, request `GET /api/v1/tags`, verify exactly the three active tags return, alphabetically sorted, with correct counts based on seeded associations. Verify the header is present. Verify the hidden tag is absent.

### Tests (US1)

- [X] T008 [P] [US1] Create `src/content/tags/tags.service.spec.ts` with unit tests for the public list path (against mocked `PrismaService`): covers "returns only ACTIVE tags", "alphabetical sort", "path and course counts computed from fixture", "empty array when no active tags", and "Arabic names round-trip unchanged". Build the fixture with at least 3 paths and 3 courses across 4 tags with overlapping associations per KAN-71 §10.1.
- [X] T009 [P] [US1] Create `test/content/tags/tags.controller.e2e-spec.ts` covering every assertion in KAN-71 §10.3: public endpoint returns 200 with expected shape; hidden tags absent; counts match seeded fixtures; no auth required; `Cache-Control: public, max-age=60` header present; empty array when no active tags; Arabic name `"ذكاء صناعي"` round-trips byte-identically. Use the exported `prisma` client and `truncateAll` from `test/schema/setup.ts`. Bootstrap a NestJS testing module via `Test.createTestingModule({ imports: [ContentModule, PrismaModule] })`.

### Implementation for US1

- [X] T010 [US1] Create `src/content/tags/dto/tag-response.dto.ts` exporting `TagResponseDto` with exactly `id: string`, `name: string`, `slug: string`, `pathCount: number`, `courseCount: number` — matches `data-model.md` § Response shapes.
- [X] T011 [US1] Create `src/content/tags/tags.service.ts` with an injectable `TagsService` class that takes `PrismaService` in its constructor. Implement `listPublic(): Promise<TagResponseDto[]>` using the three-query strategy from `research.md` R4: (1) `prisma.tag.findMany({ where: { status: TagStatus.ACTIVE }, orderBy: { name: 'asc' } })`, (2) `prisma.pathTag.groupBy({ by: ['tagId'], where: { path: { status: PathStatus.PUBLISHED } }, _count: { _all: true } })`, (3) `prisma.courseTag.groupBy({ by: ['tagId'], where: { course: { status: CourseStatus.PUBLISHED } }, _count: { _all: true } })`. Zip the two aggregate maps into the tag list, defaulting missing entries to `0`. Add `// TODO(KAN-74): wire CacheService here` above the method body.
- [X] T012 [US1] Create `src/content/tags/tags.controller.ts` exporting `TagsController` with `@Controller('tags')`. Implement `@Get() @Header('Cache-Control', 'public, max-age=60') list(): Promise<TagResponseDto[]>` delegating to `tagsService.listPublic()`. The endpoint MUST NOT be guarded by `JwtAuthGuard`; rely on the existing `@Public()` decorator if the global guard is applied, otherwise no decorator is needed — follow whatever pattern `AuthController`'s `login` uses.
- [X] T013 [US1] Register `TagsService` under `providers` and `TagsController` under `controllers` in `src/content/content.module.ts`.
- [X] T014 [US1] Run `npm test -- tags.service` — the unit tests from T008 must pass.
- [X] T015 [US1] Run `npm run test:content:e2e` — the e2e tests from T009 must pass.

**Checkpoint**: US1 is independently deployable. Visitors can list active tags with correct counts. The module compiles, both test suites pass, the existing `npm test` and `npm run test:schema` still pass.

---

## Phase 4: User Story 2 — Administrators manage the tag vocabulary (Priority: P2)

**Goal**: Ship the four admin endpoints (`GET`, `POST`, `PATCH`, `DELETE` on `/api/v1/admin/tags`) guarded by `JwtAuthGuard` + `RolesGuard` + `@Roles(Role.ADMIN)`. Validation errors return 400, duplicate slug returns 409, not-found returns 404, delete returns 204 and cascades pivot rows.

**Independent Test**: Authenticated as admin, create a new tag, verify it appears in the full admin list with `status: ACTIVE` and zero counts, update it, hide it, then delete it. Verify the hidden-then-deleted tag disappears from both public and admin lists, and its `PathTag`/`CourseTag` rows are gone.

### Tests (US2)

- [X] T016 [P] [US2] Extend `src/content/tags/tags.service.spec.ts` with unit tests for the admin path: `listAdmin` returns all statuses, `create` maps Prisma `P2002` to `ConflictException`, `update` on nonexistent id throws `NotFoundException` (map `P2025`), `delete` on nonexistent id throws `NotFoundException`, status transitions `ACTIVE → HIDDEN → ACTIVE` work, `update` with empty DTO throws `BadRequestException`. Response shape for admin paths matches `AdminTagResponseDto`.
- [X] T017 [P] [US2] Create `test/content/tags/admin-tags.controller.e2e-spec.ts` covering every assertion in KAN-71 §10.4. Inside the test file, manufacture an admin user + JWT cookie using the same helpers `src/auth/auth.service.spec.ts` uses (or a minimal signing of a JWT with the ADMIN role if that's simpler). Verify: GET returns all tags; POST creates and appears in subsequent GET; POST 409 on duplicate slug; POST 400 on invalid slug format (uppercase, special chars); POST 400 on whitespace-only name; POST accepts Arabic names; PATCH updates and returns new shape; PATCH 404 on nonexistent id; PATCH 409 on slug collision; PATCH status ACTIVE ↔ HIDDEN; DELETE 204 and tag disappears; DELETE cascades — verify no `PathTag`/`CourseTag` rows remain via direct Prisma queries; DELETE 404 on nonexistent id; all admin endpoints reject unauthenticated requests.

### Implementation for US2

- [X] T018 [P] [US2] Create `src/content/tags/dto/admin-tag-response.dto.ts` exporting `AdminTagResponseDto` that extends the shape of `TagResponseDto` with `status: TagStatus` and `createdAt: string` (ISO 8601). Use the `TagStatus` enum imported from `@prisma/client`.
- [X] T019 [P] [US2] Create `src/content/tags/dto/create-tag.dto.ts` exporting `CreateTagDto`. Fields: `name` (`@IsString`, `@Length(1, 100)`, `@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)`, plus a `@Matches(/\S/)` to reject whitespace-only); `slug` (`@IsString`, `@Length(1, 60)`, `@Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)`); `status` (`@IsOptional @IsEnum(TagStatus)`). Match the DTO style in `src/auth/dto/register.dto.ts`.
- [X] T020 [P] [US2] Create `src/content/tags/dto/update-tag.dto.ts` exporting `UpdateTagDto` as `PartialType(CreateTagDto)` from `@nestjs/mapped-types`. The "at least one field" rule is enforced in the service, not here.
- [X] T021 [US2] Extend `src/content/tags/tags.service.ts` with `listAdmin(): Promise<AdminTagResponseDto[]>`, `create(dto: CreateTagDto): Promise<AdminTagResponseDto>`, `update(id: string, dto: UpdateTagDto): Promise<AdminTagResponseDto>`, `remove(id: string): Promise<void>`. `listAdmin` uses the same count strategy as `listPublic` but without the status filter on tags and adds `status` + `createdAt` to each row. `create` catches Prisma `P2002` and throws `new ConflictException(\`Tag with slug '${dto.slug}' already exists\`)`. `update` throws `BadRequestException` if `Object.keys(dto).length === 0`; catches `P2025` → `NotFoundException(\`Tag '${id}' not found\`)`; catches `P2002` → `ConflictException(...)`. `remove` catches `P2025` → `NotFoundException(...)`. Add `// TODO(KAN-74): invalidate CacheService key 'tags:public:list' here` in `create`, `update`, and `remove`.
- [X] T022 [US2] Create `src/content/tags/admin-tags.controller.ts` exporting `AdminTagsController` with `@Controller('admin/tags')` and `@UseGuards(JwtAuthGuard, RolesGuard)` at the class level. Apply `@Roles(Role.ADMIN)` at the class level too (reuse `Role` from `@prisma/client`, `JwtAuthGuard` from `src/auth/guards/jwt-auth.guard.ts`, `RolesGuard` from `src/common/guards/roles.guard.ts`, `@Roles(...)` from `src/common/decorators/roles.decorator.ts`). Endpoints: `@Get() list()`, `@Post() @HttpCode(201) create(@Body() dto: CreateTagDto)`, `@Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateTagDto)`, `@Delete(':id') @HttpCode(204) remove(@Param('id') id: string)`. All four methods are one-liners delegating to the service.
- [X] T023 [US2] Register `AdminTagsController` under `controllers` in `src/content/content.module.ts` (alongside `TagsController`).
- [X] T024 [US2] Run `npm test -- tags.service` — unit tests from T016 must pass.
- [X] T025 [US2] Run `npm run test:content:e2e` — e2e tests from T017 must pass. Existing US1 e2e specs must continue passing.

**Checkpoint**: US2 is independently deployable on top of US1. Admins can fully manage the tag vocabulary. The CRUD lifecycle works end-to-end.

---

## Phase 5: User Story 3 — Atomic tag-set replacement capability (Priority: P3)

**Goal**: Ship `ReplaceTagAssociationsHelper.replaceForPath(pathId, tagIds)` and `.replaceForCourse(courseId, tagIds)` that dedup input, validate every ID exists and is `ACTIVE`, then run a single interactive transaction that deletes the prior associations and inserts the new set. The helper is exported from `ContentModule`; no endpoint calls it in this ticket.

**Independent Test**: Seed a path with a known set of tag associations, call `replaceForPath` with a new list, verify associations match exactly; call again with the same list, verify no change; call with an unknown tag id, verify it throws and prior state is intact; call with a hidden tag id, verify it throws and prior state is intact.

### Tests (US3)

- [X] T026 [P] [US3] Create `src/content/tags/helpers/replace-tag-associations.helper.spec.ts` with unit tests (mocked `PrismaService`) covering every case in KAN-71 §10.2: dedup input `[t1, t2, t1] → [t1, t2]`; rejects nonexistent id with `NotFoundException` whose message identifies the missing id; rejects hidden id with `BadRequestException` whose message identifies the hidden id; calls `prisma.$transaction` (assertable via mock `$transaction.mock.calls`); deletes existing associations before inserting new ones (assert call order); idempotent — two consecutive calls produce identical mock state; works symmetrically for path and course.
- [X] T027 [P] [US3] Create `test/content/tags/replace-tag-associations.helper.e2e-spec.ts` against the real test database covering every case in KAN-71 §10.5: `replaceForPath` replaces atomically; empty array removes all associations; duplicates in input produce no duplicate rows; nonexistent tag id throws and prior state intact (verify with a direct `prisma.pathTag.findMany`); hidden tag id throws and prior state intact; `replaceForCourse` behaves identically; two consecutive calls with the same input produce identical database state.

### Implementation for US3

- [X] T028 [US3] Create `src/content/tags/helpers/replace-tag-associations.helper.ts` exporting an injectable `ReplaceTagAssociationsHelper` class with `PrismaService` in its constructor. Implement a private `#validateAndDedupe(tagIds: string[], tx: Prisma.TransactionClient): Promise<string[]>` that dedupes via `Array.from(new Set(tagIds))`, reads `tx.tag.findMany({ where: { id: { in: unique } }, select: { id: true, status: true } })`, and throws `NotFoundException("Tag '${id}' does not exist")` or `BadRequestException("Tag '${id}' is hidden and cannot be attached")` as applicable (preserve input order in the error message). Return the unique list.
- [X] T029 [US3] In the same file, implement `replaceForPath(pathId: string, tagIds: string[]): Promise<void>` using `prisma.$transaction(async (tx) => { const unique = await this.#validateAndDedupe(tagIds, tx); await tx.pathTag.deleteMany({ where: { pathId } }); if (unique.length > 0) await tx.pathTag.createMany({ data: unique.map((tagId) => ({ pathId, tagId })) }); })`. Follow the interactive-transaction pattern from `research.md` R10.
- [X] T030 [US3] In the same file, implement `replaceForCourse(courseId: string, tagIds: string[]): Promise<void>` symmetrically with `tx.courseTag` and `{ courseId }`.
- [X] T031 [US3] Register `ReplaceTagAssociationsHelper` in `src/content/content.module.ts`: add to `providers` AND to `exports` so downstream modules (KAN-72/73) can import `ContentModule` and inject the helper.
- [X] T032 [US3] Run `npm test -- replace-tag-associations.helper` — unit tests from T026 must pass.
- [X] T033 [US3] Run `npm run test:content:e2e` — e2e tests from T027 must pass. Existing US1 and US2 e2e specs must continue passing.

**Checkpoint**: US3 is independently deployable. The helper is exported and reusable by future tickets. All three stories are done.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, final verification, and PR.

- [X] T034 Update `README.md` under the modules section with a short paragraph describing what `ContentModule` currently exposes: the public `GET /api/v1/tags` endpoint, the admin CRUD under `/api/v1/admin/tags`, and the exported `ReplaceTagAssociationsHelper` for future Path/Course edit flows.
- [X] T035 Run the full verification suite: `npm run build && npm test && npm run test:schema && npm run test:content:e2e && npx prisma validate`. All must be green.
- [X] T036 Verify scope constraints are intact: `git diff prisma/schema.prisma` empty, `git diff prisma/migrations/` empty, `git diff src/auth src/users src/common` empty. Any non-empty diff indicates a scope violation and must be rolled back.
- [X] T037 Manual smoke test against a local dev server: `npm run start:dev`, then curl `GET /api/v1/tags` and confirm the response shape and `Cache-Control` header. Log in as an admin and exercise POST/PATCH/DELETE on `/api/v1/admin/tags` per the commands in `specs/009-tags-module/quickstart.md` §5.
- [X] T038 Create a new branch (or reuse `009-tags-module`) and commit in logical chunks: (1) setup + module shell, (2) US1, (3) US2, (4) US3, (5) polish. Push and open a PR titled `feat(content): KAN-71 — Tags module` referencing the KAN-71 Jira ticket.

**Checkpoint**: Definition of Done from KAN-71 §11 is fully green (all 13 items).

---

## Dependencies

```text
Phase 1 (Setup: T001–T004)
    ↓
Phase 2 (Foundational: T005–T007)
    ↓
    ├──→ Phase 3 (US1: T008–T015) ──┐
    ├──→ Phase 4 (US2: T016–T025) ──┤   (Each story may start as soon as Phase 2
    └──→ Phase 5 (US3: T026–T033) ──┤    ends; they share only tags.service.ts
                                    │    and content.module.ts, which sequence
                                    ↓    serially inside each phase.)
                              Phase 6 (Polish: T034–T038)
```

**Hard ordering constraints**:
- T006 (register `ContentModule`) depends on T005 (create `ContentModule`).
- T007 (build check) depends on T006.
- T011 (service `listPublic`) depends on T010 (DTO).
- T013 (module wiring) depends on T011 and T012.
- T014/T015 (run tests) depend on T013.
- T021 (extend service) depends on T018/T019/T020 (admin DTOs).
- T022 (admin controller) depends on T021.
- T023 depends on T022.
- T024/T025 depend on T023.
- T028/T029/T030 live in the same file — write them in order, don't parallelize.
- T031 depends on T030.
- T032/T033 depend on T031.

**Story independence**: US1, US2, US3 touch three disjoint slices of `tags.service.ts` / `content.module.ts` / new files. Assuming sequential writes to `tags.service.ts` (US1 first, US2 second) and `content.module.ts` (each story adds its own providers/controllers), they can be worked by separate developers in parallel as long as the developers rebase on each other's module updates. In single-agent execution, do them in priority order.

## Parallel execution opportunities

Within a single story, the `[P]` tasks are independent files and can be written in a single batch:

**Phase 3 (US1)** — T008 and T009 are unit vs e2e test scaffolds in different directories and can be written in parallel before any implementation lands. T010 (DTO) and the early scaffold of T011 (service) can also be started in parallel.

**Phase 4 (US2)** — T018, T019, T020 are three separate DTO files; write them in parallel. T016 (unit test scaffold) and T017 (e2e test scaffold) are independent files and can be written in parallel.

**Phase 5 (US3)** — T026 (unit test file) and T027 (e2e test file) are independent and can be written in parallel.

## Implementation strategy

- **MVP**: Ship Phases 1 + 2 + 3 (US1 only). That's `GET /api/v1/tags` with live counts, the single highest-value slice of the ticket. If KAN-26 (public discovery) is ready to start before US2 lands, this is enough for it to unblock.
- **Iteration 2**: Phase 4 (US2) — admin CRUD. Gates all internal taxonomy curation.
- **Iteration 3**: Phase 5 (US3) — the reusable helper. Has no user-visible effect until KAN-72/73 wire it up, so it is last.
- **Iteration 4**: Phase 6 — documentation + final verification + PR.

Every checkpoint between phases leaves the codebase in a shippable state. The build, the existing `npm test` suite, the KAN-70 schema tests, and all already-delivered KAN-71 stories must remain green at every checkpoint.

## Independent test criteria (restated from spec)

- **US1** (MVP): Seed three active tags and one hidden tag against `awamer_test`, request `GET /api/v1/tags`, verify exactly the three active tags return, alphabetically sorted, with correct counts, `Cache-Control: public, max-age=60` present, hidden tag absent, Arabic names byte-identical.
- **US2**: As admin, create a tag, list and confirm it appears, update its name + status (ACTIVE→HIDDEN→ACTIVE), confirm the public list reflects the status changes, delete it, confirm it is gone from both lists and all pivot rows are gone.
- **US3**: Seed a path with 2 tag associations, call `replaceForPath` with 3 tags (including 1 from the prior set), confirm the path has exactly 3 associations; call again with the same 3, confirm no change; call with an unknown id, confirm throw and prior 3 still intact; call with a hidden id, confirm throw and prior 3 still intact; repeat for `replaceForCourse`.
