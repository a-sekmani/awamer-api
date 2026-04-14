# Tasks: Course Enrollment + Dual-Level Certificates

**Feature**: 011-enrollment-certificates · **Branch**: `011-enrollment-certificates`
**Inputs**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
**Tests**: Explicitly requested by ticket §11 (unit + e2e are DoD items).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no unfinished dependency)
- **[Story]**: `[US1]` Course enroll · `[US2]` Path enroll · `[US3]` Course cert · `[US4]` Path cert · `[US5]` List enrollments · `[US6]` List certs · `[US7]` Verify cert · `[US8]` Guard rejection · `[US9]` Free cascade
- **All story labels P1**: US1–US4, US8 · **P2**: US5, US6, US7, US9
- Every task gives an exact file path under the repo root `/Users/ahmadsekmani/Desktop/Projects/awamer-api/`.

## Path Conventions (this feature)

- New modules: `src/enrollment/`, `src/learning/`
- Replace stubs: `src/progress/`, `src/certificates/`, `src/common/guards/enrollment.guard.ts`, `src/common/guards/content-access.guard.ts`
- Delete dead code: `src/progress/progress.controller.ts`
- E2E tests: `test/enrollment/`, `test/certificates/`

---

## Phase 1: Setup

**Purpose**: Verify baseline, create directory skeletons, widen the e2e jest config so new tests are picked up.

- [X] T001 Verify baseline: run `npm run build`, `npx prisma validate`, `npm run test:schema`, `npm run test:content:e2e`, `npm test`. All must be green before any code is written.
- [X] T002 [P] Create directory skeletons: `src/enrollment/dto/`, `src/learning/`, `test/enrollment/`, `test/certificates/`. Add a placeholder `.gitkeep` only where the directory would otherwise be empty at commit time.
- [X] T003 [P] Edit `test/content-e2e-jest.config.js` — widen `testRegex` from `'test/content/.*\\.e2e-spec\\.ts$'` to `'test/(content|enrollment|certificates)/.*\\.e2e-spec\\.ts$'`. Verify `npm run test:content:e2e` still runs the existing 59 content e2e tests (output pattern identical).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Response DTOs, stub-file deletion, and module skeletons that every user story depends on. Nothing in Phase 3+ can compile until this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until Phase 2 is complete.

### DTOs (parallel — pure data files)

- [X] T004 [P] Create `src/enrollment/dto/enrollment-response.dto.ts` — base class exposing `id`, `userId`, `status`, `enrolledAt` via `class-transformer @Expose()`.
- [X] T005 [P] Create `src/enrollment/dto/path-enrollment-response.dto.ts` — extends base with `pathId`, nested `path: { id, title, slug, thumbnail }`, nested `progress: { percentComplete, status }`. Static `fromEntity(row, progress)` mapper.
- [X] T006 [P] Create `src/enrollment/dto/course-enrollment-response.dto.ts` — extends base with `courseId`, nested `course: { id, title, slug, thumbnail }`, nested `progress`. `fromEntity` mapper.
- [X] T007 [P] Create `src/enrollment/dto/enrollment-list-response.dto.ts` — `{ paths: PathEnrollmentResponseDto[], courses: CourseEnrollmentResponseDto[] }`.
- [X] T008 [P] Create `src/enrollment/dto/course-enrollment-detail-response.dto.ts` — extends `CourseEnrollmentResponseDto` with `lastPosition: { sectionId, lessonId, accessedAt } | null`.
- [X] T009 [P] Create `src/certificates/dto/certificate-response.dto.ts` — exposes `id, type, pathId, courseId, certificateCode, issuedAt, path|null, course|null`. `fromEntity` mapper handles the PATH/COURSE branching (sets the unused side to `null`).
- [X] T010 [P] Create `src/certificates/dto/certificate-verification.dto.ts` — strict allow-list DTO exposing ONLY `{ valid: true, type, issuedAt, holder: { fullName }, subject: { type, title, slug } }`. Uses `@Expose()` to enforce the allow-list at serialization time. No email, no enrollment date, no user id (per clarification Q2 + FR-021).

### Module scaffolding and stub replacement

- [X] T011 Delete `src/progress/progress.controller.ts` per Decision 11 (dead code; no HTTP surface). Update `src/progress/progress.module.ts` to remove it from the `controllers` array — leave module shell with empty controllers array for now (providers updated in Phase 5).
- [X] T012 [P] Create `src/learning/learning.module.ts` skeleton — imports `ProgressModule` (forward-ref not needed; one-way dep). Empty controllers/providers arrays; populated in Phase 8.
- [X] T013 Register `LearningModule` in `src/app.module.ts` alongside the existing `ProgressModule`, `EnrollmentModule`, `CertificatesModule`. Verify `AppModule` still compiles (existing stubs should still build).

**Checkpoint**: DTO classes, module skeletons, and config widening compile. User story phases can now proceed.

---

## Phase 3: User Story 1 — Enroll in a standalone course (Priority: P1)

**Goal**: Authenticated learner can enroll in a standalone course; service creates course enrollment + course progress + per-section progress in one transaction; rejects path-attached courses and duplicates.

**Independent Test**: Seed a standalone course with 2 sections. POST `/enrollments/courses/:id` with a learner JWT — expect 201 + zeroed progress rows verifiable via direct Prisma query. POST same id again — expect 409. POST a path-attached course — expect 400 with `parentPathId`.

- [X] T014 [US1] Implement `EnrollmentService.enrollInCourse(userId, courseId)` at `src/enrollment/enrollment.service.ts`. Opens `prisma.$transaction`; resolves `course` with `pathId` + sections; throws `NotFoundException` if missing; throws `BadRequestException` (with `parentPathId` on the body) when `course.pathId != null`; catches Prisma `P2002` on `course_enrollments_userId_courseId_key` and converts to `ConflictException("Already enrolled in course '<id>'")`; inserts `CourseEnrollment` + `CourseProgress` + per-section `SectionProgress` rows with zeroed counters.
- [X] T015 [US1] Implement `EnrollmentController` at `src/enrollment/enrollment.controller.ts` with `@Controller('enrollments') @UseGuards(JwtAuthGuard)` and method `@Post('courses/:courseId') @HttpCode(201) enrollInCourse(@Param('courseId', ParseUUIDPipe) id, @Req() req)`. Delegates to the service.
- [X] T016 [US1] Create `src/enrollment/enrollment.module.ts` — providers `[EnrollmentService]`, controllers `[EnrollmentController]`, exports `[EnrollmentService]`. Register under `AppModule.imports` (replace any existing stub import).
- [X] T017 [P] [US1] Unit tests at `src/enrollment/enrollment.service.spec.ts` covering `enrollInCourse`: happy path creates all three row types, rejects path-attached course with BadRequestException (+ `parentPathId`), rejects duplicate with ConflictException (mock Prisma `P2002`), throws NotFoundException for missing course, runs inside `$transaction` (verifiable via mock).
- [X] T018 [P] [US1] E2E tests at `test/enrollment/enrollment.controller.e2e-spec.ts` for US1 cases: 201 happy path + verify rows via direct Prisma queries, 400 with `parentPathId` for path-attached course, 404 nonexistent, 409 duplicate, 401 unauthenticated, Arabic course title round-trip.

**Checkpoint**: US1 deployable. Standalone course enrollment works end-to-end.

---

## Phase 4: User Story 2 — Enroll in a learning path (Priority: P1)

**Goal**: Authenticated learner enrolls in a path; service creates path enrollment + path progress + one course progress per course, all in one transaction; rejects duplicate.

**Independent Test**: Seed a path with 2 courses. POST `/enrollments/paths/:id` with a learner JWT — expect 201 + one `PathProgress` + 2 `CourseProgress` rows verifiable via Prisma. POST same id again — expect 409.

- [X] T019 [US2] Extend `EnrollmentService` at `src/enrollment/enrollment.service.ts` with `enrollInPath(userId, pathId)`. Transaction: validate path exists (`NotFoundException`); `findFirst` on `PathEnrollment` with `{ userId, pathId }` → throw `ConflictException` on hit (per data-model note: no `@@unique` declared); create `PathEnrollment`, `PathProgress` (zeroed, `totalCourses = path.courses.length`), and one zeroed `CourseProgress` per course (with `totalSections` prefilled).
- [X] T020 [US2] Add method `@Post('paths/:pathId') @HttpCode(201) enrollInPath(...)` to `src/enrollment/enrollment.controller.ts`.
- [X] T021 [P] [US2] Unit tests in `src/enrollment/enrollment.service.spec.ts` (extend the US1 file): `enrollInPath` happy path creates all rows, ConflictException on duplicate, NotFoundException on missing path, runs in a single transaction.
- [X] T022 [P] [US2] E2E tests in `test/enrollment/enrollment.controller.e2e-spec.ts` (extend the US1 file) for US2: POST path enroll 201, verify rows, 409 duplicate, 404 missing, 401 unauthenticated, simultaneous path + standalone-course enrollment for the same user.

**Checkpoint**: US2 deployable. Path enrollment works independently of US1.

---

## Phase 5: User Story 3 + User Story 4 — Automatic course & path certificate issuance (Priority: P1)

**Goal**: Completing the last lesson of a course issues exactly one course certificate; finishing every course in a path additionally issues one path certificate. Full cascade: lesson → section → course → (path) → last position → course cert → (path cert). Fully atomic and idempotent.

**Independent Test**: Scenarios 1 and 2 from ticket §11.5 (see `test/enrollment/progress-cascade.e2e-spec.ts`). These are the canonical end-to-end proofs for US3 and US4 combined.

### CertificatesService (foundation for US3/US4)

- [X] T023 [US3] Implement `CertificatesService.issueCertificate(tx, data)` private helper at `src/certificates/certificates.service.ts` per Decision 5: generates 12-char URL-safe code from `crypto.randomUUID().replace(/-/g, '').slice(0, 12)`, attempts `tx.certificate.create`, retries up to 3 times on Prisma `P2002`, throws `InternalServerErrorException('Failed to generate unique certificate code')` after 3 failures.
- [X] T023a [US3] Emit `certificate_issued` event from `issueCertificate` per FR-030. Add `imports: [AnalyticsModule]` to `src/certificates/certificates.module.ts`. Inject `private readonly analytics: AnalyticsService` in `CertificatesService`'s constructor (import from `src/analytics/analytics.service.ts`). Immediately after `tx.certificate.create` resolves (still inside the transaction callback), call `this.analytics.capture(created.userId, 'certificate_issued', { certificateId: created.id, certificateType: created.type, pathId: created.pathId, courseId: created.courseId, certificateCode: created.certificateCode, issuedAt: created.issuedAt.toISOString() })`. Per FR-030 rationale, placement inside `issueCertificate` (not in the `check*Eligibility` callers) is a structural idempotency guarantee: the callers short-circuit before reaching this line when an existing cert is found. `AnalyticsService.capture` is synchronous and returns void, so no transaction-rollback interaction is possible today.
- [X] T024 [US3] Implement `CertificatesService.checkCourseEligibility(tx, userId, courseId): Promise<Certificate | null>`. Steps: (a) `findFirst` existing cert where `type=COURSE, userId, courseId` → return existing if found; (b) load course with sections + lessons count; (c) count `LessonProgress` with `userId, lesson.sectionId IN (...), status=COMPLETED`; if not all complete return `null`; (d) call private `allCourseQuizzesPassed(tx, userId, courseId)` which currently returns `true` with `TODO(KAN-quizzes)` comment (Decision 6); (e) call `issueCertificate` with `{ userId, courseId, pathId: null, type: 'COURSE' }`; return the new cert.
- [X] T025 [US4] Implement `CertificatesService.checkPathEligibility(tx, userId, pathId): Promise<Certificate | null>`. Steps: (a) `findFirst` existing where `type=PATH, userId, pathId` → return existing; (b) verify learner has `PathEnrollment` with `status=ACTIVE` (spec FR-016 requires path enrollment as prereq); (c) load path with its courses; (d) for each course, check that a `Certificate` with `type=COURSE, userId, courseId` exists — if any missing, return `null`; (e) `issueCertificate` with `{ userId, pathId, courseId: null, type: 'PATH' }`.
- [X] T026 [US3] Replace `src/certificates/certificates.module.ts` providers to include real `CertificatesService`; exports `[CertificatesService]`. Ensure no circular dependency flag from NestJS yet (it will be fine because Certificates doesn't import Progress).
- [X] T027 [P] [US3] Unit tests at `src/certificates/certificates.service.spec.ts` covering `checkCourseEligibility`: returns existing, returns null if not all lessons complete, issues with correct shape when eligible, quiz-check stub returns true; `checkPathEligibility`: returns existing, returns null on missing course cert, returns null when no path enrollment, issues with correct shape; `issueCertificate`: generates unique 12-char code, retries on P2002 (mocked), throws after 3 retries. Mocked `PrismaService`. **FR-030 assertions (per T023a)**: provide a mock `AnalyticsService = { capture: jest.fn() }` via DI following the `UsersService` spec pattern (`src/users/users.service.spec.ts:108-128`). Assert (a) `capture` is called exactly once with `(userId, 'certificate_issued', { certificateId, certificateType, pathId, courseId, certificateCode, issuedAt })` on every successful new-cert issuance path (course cert, path cert, and the retry-then-succeed branch); (b) `capture` is NOT called when `checkCourseEligibility` returns an existing course certificate; (c) `capture` is NOT called when `checkPathEligibility` returns an existing path certificate.

### ProgressService cascade (US3 + US4 drive this together)

- [X] T028 [US3] Implement `ProgressService.completeLesson(userId, lessonId): Promise<CompleteLessonResult>` at `src/progress/progress.service.ts`. Steps: (1) **pre-check idempotency** (Decision 3) — `findUnique` on `LessonProgress` by `(userId, lessonId)`; if `status === COMPLETED`, return current aggregate state without opening a transaction and with `certificatesIssued: []`; (2) load lesson with section → course → pathId; (3) throw `NotFoundException` if lesson missing; (4) open `prisma.$transaction(async tx => ...)`; (5) upsert `LessonProgress` → COMPLETED, `completedAt = now()`; (6) `recalculateSectionProgress(tx, userId, sectionId)`; (7) `recalculateCourseProgress(tx, userId, courseId)`; (8) if `course.pathId`: `recalculatePathProgress(tx, userId, pathId)` else `pathProgressRow = null`; (9) `updateLastPosition(tx, userId, lesson)`; (10) `courseCert = certificatesService.checkCourseEligibility(tx, userId, courseId)`; (11) if `course.pathId`: `pathCert = certificatesService.checkPathEligibility(tx, userId, course.pathId)` else null; (12) return the shape `{ lessonProgress, sectionProgress, courseProgress, pathProgress, certificatesIssued: [courseCert, pathCert].filter(Boolean) }`. **Return-shape decision (U2 resolution)**: `CompleteLessonResult` returns **raw Prisma entities** (`LessonProgress`, `SectionProgress`, `CourseProgress`, `PathProgress`). These are serialized to JSON via the global `ClassSerializerInterceptor` — `Date` fields become ISO strings automatically. No response DTOs are created for the progress rows; the top-level `CompleteLessonResult` type alias is the only typed contract for this shape. `certificatesIssued` carries raw `Certificate` rows (same serialization path).
- [X] T029 [US3] Implement `ProgressService.recalculateSectionProgress(tx, userId, sectionId)` per data-model: counts total lessons via `tx.lesson.count({ where: { sectionId } })`, counts completed via `tx.lessonProgress.count({ where: { userId, lesson: { sectionId }, status: 'COMPLETED' } })`, upserts `SectionProgress` by `(userId, sectionId)` with updated counters, percentage, and status (COMPLETED/IN_PROGRESS/NOT_STARTED).
- [X] T030 [US3] Implement `ProgressService.recalculateCourseProgress(tx, userId, courseId)`: counts total sections in course, counts sections whose `SectionProgress.status = COMPLETED` for this user, upserts `CourseProgress` by `(userId, courseId)`.
- [X] T031 [US4] Implement `ProgressService.recalculatePathProgress(tx, userId, pathId)`: loads all courses in the path, counts those with `CourseProgress.status = COMPLETED` for this user, computes `percentage` as the average of `CourseProgress.percentage` across the path's courses, upserts `PathProgress` by `(userId, pathId)`.
- [X] T032 [US3] Implement `ProgressService.updateLastPosition(tx, userId, lesson)` per Decision 4: computes scope (PATH if course.pathId AND user has ACTIVE PathEnrollment for that path; COURSE otherwise); does `findFirst` on `last_positions` with the scope filter; calls `create` or `update` accordingly. Always writes exactly one of `pathId`/`courseId` to satisfy the `last_positions_exactly_one_scope` CHECK.
- [X] T033 [US3] Wire `ProgressService` into `src/progress/progress.module.ts`: providers `[ProgressService]`, imports `[forwardRef(() => CertificatesModule)]` (forward-ref in case NestJS flags a cycle — see research Decision 2). Exports `[ProgressService]`. **Do NOT import `EnrollmentModule`** — `ProgressService.updateLastPosition` queries `PathEnrollment` directly via `PrismaService` (already global via `AppModule`), so no dependency on `EnrollmentService` exists (I1 fix).
- [X] T034 [P] [US3] Unit tests at `src/progress/progress.service.spec.ts` with mocked Prisma: `completeLesson` upserts LessonProgress, recalculates Section/Course/Path correctly, skips Path for standalone courses, routes LastPosition via `pathId` for path-enrolled courses and via `courseId` for standalone, calls `checkCourseEligibility` and conditionally `checkPathEligibility`, populates `certificatesIssued` only with non-null results, idempotent pre-check on already-completed lesson returns current state and does NOT open a transaction, runs everything in one `$transaction` (verifiable by asserting `$transaction` is called exactly once on the non-idempotent branch). **Forced-failure rollback test (U1 resolution — FR-012)**: add an additional `it('rolls back the entire cascade when certificate issuance fails mid-transaction')` case — mock `CertificatesService.checkCourseEligibility` to `throw new Error('forced')` after `LessonProgress` mock writes resolve; call `completeLesson` and `expect(...).rejects.toThrow('forced')`; then assert via the mock transaction that the inner `tx.lessonProgress.upsert`, `tx.sectionProgress.upsert`, and the `updateLastPosition` mock calls all took place **inside the transaction callback** but the overall `$transaction` promise rejected — verifiable by asserting the `$transaction` mock was configured to reject when its callback threw, and that the outer service call surfaces the error without writing anything observable outside the mocked transaction scope.
- [X] T035 [US3] E2E test suite `test/enrollment/progress-cascade.e2e-spec.ts` — **THE CRITICAL FILE (ticket §11.5)**. Implements all four scenarios from §11.5:
  - **Scenario 1 (standalone course happy path)**: seed standalone course 2×3 lessons; enrollInCourse; completeLesson × 6; assert progress milestones (16% → 83% → 100%) and exactly 1 COURSE certificate at the end with `courseId` set and `pathId=null`. Re-complete lesson 6: no new cert, no row changes.
  - **Scenario 2 (path happy path)**: seed path 2 courses × 1 section × 2 lessons; enrollInPath; complete 4 lessons; assert 1 course cert after course 1's last lesson, 2 course certs + 1 PATH cert after course 2's last lesson, final count = 3 certs, `PathProgress = 100%`, both `CourseProgress = 100%`.
  - **Scenario 3 (idempotency)**: seed course + 2 lessons; enroll; complete both (1 cert); re-complete both → still exactly 1 cert, no errors.
  - **Scenario 4 (last position routing)**: seed a path with 1 course AND a separate standalone course; enroll user in both; complete a lesson in the path's course → `LastPosition.pathId` set; complete a lesson in the standalone → `LastPosition.courseId` set; verify both rows exist with the correct scope.
  - **Scenario 5 (real-database rollback proof — U1 resolution, FR-012 / SC-007)**: seed a standalone course with 2 sections × 2 lessons each; enroll a user; override the Nest app's `CertificatesService` provider via `moduleRef.overrideProvider(CertificatesService).useValue({ checkCourseEligibility: jest.fn().mockRejectedValue(new Error('forced rollback')), checkPathEligibility: jest.fn() })`; call `POST /learning/lessons/:id/complete` on the LAST remaining lesson (the one that would trigger eligibility); expect the HTTP response to be 500 (or whatever error status the global filter maps the thrown `Error` to); then query Prisma directly and assert: (a) `LessonProgress.count({ where: { userId, lessonId } })` returns 0 — the upsert was rolled back; (b) `SectionProgress.findUnique({ where: { userId_sectionId: { userId, sectionId } } })` returns the PREVIOUS state (still showing the prior completed count, not the would-be-new count); (c) no new `LastPosition` row was created, or the existing one still points at the PREVIOUS lesson. This is the definitive proof of transactional atomicity against a real Postgres.
  - Reuses `createTestApp` from `test/content/tags/test-app.ts`; per-test user UUID signed ad-hoc via `app.get(JwtService)`; truncates relevant tables in `beforeEach`.

**Checkpoint**: US3 + US4 complete. The DoD's critical path is provable against a real Postgres.

---

## Phase 6: User Story 5 — List my enrollments (Priority: P2)

**Goal**: `GET /enrollments/me` returns `{ paths, courses }` with progress summaries, sorted by `enrolledAt DESC`; standalone courses only under `courses`.

**Independent Test**: Seed 1 path enrollment + 1 standalone-course enrollment; fetch `/enrollments/me`; assert both groups populated, correct shape, correct sort, path-attached courses absent from `courses`.

- [X] T036 [US5] Implement `EnrollmentService.listAllForUser(userId)` and `getCourseEnrollment(userId, courseId)` at `src/enrollment/enrollment.service.ts`. `listAllForUser`: loads `PathEnrollment[]` with `include: { path }` and a joined `PathProgress` subquery; loads `CourseEnrollment[]` with `include: { course }` and `CourseProgress`; maps via DTO `fromEntity` helpers; sorts both by `enrolledAt DESC`. `getCourseEnrollment`: loads course enrollment for `(userId, courseId)` with `CourseProgress` and `LastPosition` join (same-scope `courseId`); returns `null` if absent — the **controller** then throws `NotFoundException` (404 identical for "course missing" and "not enrolled" to prevent information leakage per FR-008).
- [X] T037 [US5] Add controller methods `@Get('me') listAllForUser(@Req() req)` and `@Get('me/courses/:courseId') getCourseEnrollment(@Param('courseId', ParseUUIDPipe), @Req() req)` to `src/enrollment/enrollment.controller.ts`. The `getCourseEnrollment` handler throws `NotFoundException("Enrollment not found")` when the service returns `null`.
- [X] T038 [P] [US5] Unit tests in `src/enrollment/enrollment.service.spec.ts` (extend): `listAllForUser` returns both arrays sorted correctly, path-attached courses not under `courses`, empty arrays when user has no enrollments; `getCourseEnrollment` returns the detail with `lastPosition`, returns null when not enrolled (caller's responsibility to 404).
- [X] T039 [P] [US5] E2E tests in `test/enrollment/enrollment.controller.e2e-spec.ts` (extend) for US5: GET `/enrollments/me` with mixed enrollments, GET empty, GET `/enrollments/me/courses/:id` happy + 404 on missing, + 404 on non-enrolled, 401 unauthenticated.

**Checkpoint**: Dashboard listing works.

---

## Phase 7: User Story 6 + User Story 7 — List + verify certificates (Priority: P2)

**Goal**: `GET /certificates/me` returns the user's certificates sorted newest first. `GET /certificates/verify/:code` is unauthenticated and returns only the allow-listed fields.

**Independent Test**: Issue 2 certs (1 course, 1 path) for a user. Fetch `/certificates/me` authenticated → both certs. Fetch `/certificates/verify/:code` unauthenticated → confirmation + `holder.fullName` only. Unknown code → 404.

- [X] T040 [US6] Implement `CertificatesService.listForUser(userId)` at `src/certificates/certificates.service.ts`. Loads all certificates for user, `include: { path: { select: { id, title, slug } }, course: { select: { id, title, slug } } }`, sorts by `issuedAt DESC`, maps each via `CertificateResponseDto.fromEntity`.
- [X] T041 [US7] Implement `CertificatesService.verifyByCode(code)` at `src/certificates/certificates.service.ts`. Loads certificate by `certificateCode` with minimal selects: `user: { select: { name: true } }`, `path: { select: { title, slug } }`, `course: { select: { title, slug } }`. Throws `NotFoundException` if not found (NOT a 200 with valid:false, per FR-020). Returns a `CertificateVerificationDto` with `valid: true, type, issuedAt (ISO), holder: { fullName: user.name }, subject: { type, title, slug }` — picking path or course based on cert type.
- [X] T042 [US6] Implement `CertificatesController` at `src/certificates/certificates.controller.ts` replacing the stub. Routes: `@Get('me') @UseGuards(JwtAuthGuard) listForUser(@Req() req)`, `@Get('verify/:code') @Public() @Throttle({ default: { limit: 30, ttl: 60000 } }) verifyByCode(@Param('code') code)`. Class has NO class-level guard — per-route auth decisions per ticket §7.2. **C2 resolution**: the per-route `@Throttle` decorator tightens the public verification endpoint from the global 100/60s default to 30/60s, which is sufficient for legitimate employer verification traffic and hostile enough to slow credential-scanning bots. Import `Throttle` from `@nestjs/throttler`.
- [X] T043 [P] [US6] Unit tests in `src/certificates/certificates.service.spec.ts` (extend): `listForUser` sorts by `issuedAt DESC`, includes correct relation based on type (path for PATH, course for COURSE), empty array when none.
- [X] T044 [P] [US7] Unit tests in `src/certificates/certificates.service.spec.ts` (extend): `verifyByCode` throws NotFoundException on unknown code, returns the minimal allow-listed shape with `holder.fullName` populated from `User.name` (no split), no email/enrollment date/progress in output.
- [X] T045 [P] [US6] [US7] E2E tests at `test/certificates/certificates.controller.e2e-spec.ts`: seed certs for a user; GET `/certificates/me` authenticated returns correct shape and sort; GET empty array when user has no certs; 401 unauthenticated; GET `/certificates/verify/:code` without auth returns the allow-listed DTO; verify response has NO `email`, NO `enrolledAt`, NO progress fields (assert explicitly); 404 on unknown code; certificate code is URL-safe (no escaping needed in the URL). **C2 throttle test**: add a dedicated `describe('rate limiting', () => { ... })` block — fire 30 sequential unauthenticated GETs to `/api/v1/certificates/verify/nonexistent-code-xyz` and assert every response is 404; fire the 31st request within the same 60s window and assert the response is 429 Too Many Requests; after the throttle window resets (either `jest.useFakeTimers()` + `jest.advanceTimersByTime(61000)` or a real wait — prefer the faked timer approach if the Throttler module supports it, otherwise accept the real wait and mark the test as slow), fire another request and assert 404 again. If the Throttler does not expose its internal clock to Jest fakes, document a `skip` with a `TODO(throttle-test-timing)` marker rather than waiting 60s of wall-clock time in CI.

**Checkpoint**: Certificate surface complete.

---

## Phase 8: User Story 8 + User Story 9 — Guards and learning endpoint (Priority: P1 + P2)

**Goal**: `EnrollmentGuard` rejects non-`ACTIVE` enrollments. `ContentAccessGuard` enforces the `isFree` cascade and defers to (stubbed) subscription check. `LearningModule` exposes `POST /learning/lessons/:lessonId/complete` protected by the full guard chain.

**Independent Test (US8)**: Non-enrolled learner calls the endpoint → 403. Enroll learner (ACTIVE) → retry succeeds. Mark enrollment PAUSED → 403 again. **Independent Test (US9)**: seed free lesson / free course / free path / fully paid lesson; as a subscription-less learner, confirm first three succeed and the fourth succeeds-with-TODO (current behavior per Decision 7).

- [X] T046 [US8] Implement `EnrollmentService.hasAccessToCourse(userId, courseId): Promise<boolean>` at `src/enrollment/enrollment.service.ts` per Decision 8. Resolves course to get `pathId`; if `pathId`: `findFirst` on `PathEnrollment` where `{ userId, pathId, status: 'ACTIVE' }`; else: `findFirst` on `CourseEnrollment` where `{ userId, courseId, status: 'ACTIVE' }`. Returns boolean. Non-ACTIVE enrollments return `false`.
- [X] T047 [US8] Rewrite `src/common/guards/enrollment.guard.ts` replacing the stub. `@Injectable() EnrollmentGuard implements CanActivate`. Constructor injects `EnrollmentService` and `PrismaService`. `canActivate` reads `lessonId` from `request.params`, resolves `lesson → section.courseId` (single Prisma query), calls `enrollmentService.hasAccessToCourse(request.user.id, courseId)`, throws `ForbiddenException('Not enrolled')` on false, returns `true` on success. Throws `NotFoundException` if the lesson does not exist. The guard must be registered as a provider in whichever module uses it (`LearningModule` imports `EnrollmentModule` so the service is available).
- [X] T048 [US9] Rewrite `src/common/guards/content-access.guard.ts` replacing the stub. `@Injectable() ContentAccessGuard implements CanActivate`. Constructor injects `PrismaService` (and eventually `SubscriptionsService`, stubbed for now). `canActivate` reads `lessonId`, resolves `lesson → section → course (+ optional path)`, runs the cascade: lesson.isFree? → course.isFree? → (course.pathId && path.isFree)? → `hasActiveSubscription(userId)` (private stub returning `true` with `TODO(subscriptions)` comment per Decision 7) → throw `ForbiddenException({ reason: 'subscription_required', upgradeUrl: '/plus' })`. For standalone courses, skip the `path.isFree` branch (FR-026).
- [X] T049 [P] [US8] Unit tests at `src/common/guards/enrollment.guard.spec.ts`: allows when `hasAccessToCourse` true; throws `ForbiddenException` when false; throws `NotFoundException` for missing lesson; mocks `EnrollmentService` + `PrismaService`.
- [X] T050 [P] [US9] Unit tests at `src/common/guards/content-access.guard.spec.ts`: allows for free lesson regardless of subscription, allows for free course, allows for free path-attached course when path is free, SKIPS "parent path is free" check for standalone courses, allows for paid content via the stubbed subscription (documents the current TODO behavior), throws ForbiddenException when the final stubbed check is toggled off in a test override.
- [X] T051 [US8] Implement `LearningController` at `src/learning/learning.controller.ts`: `@Controller('learning')` with single method `@Post('lessons/:lessonId/complete') @HttpCode(200) @UseGuards(JwtAuthGuard, EnrollmentGuard, ContentAccessGuard) complete(@Param('lessonId', ParseUUIDPipe) id, @Req() req)` — delegates to `progressService.completeLesson(req.user.id, id)`. Guard order matters per Decision 9.
- [X] T052 [US8] Wire `LearningModule` at `src/learning/learning.module.ts`: imports `[ProgressModule, EnrollmentModule]` (EnrollmentModule needed for the EnrollmentGuard's injected `EnrollmentService`); controllers `[LearningController]`; providers `[EnrollmentGuard, ContentAccessGuard]` (A1 resolution: no alternative registration path — the guards live under `src/common/guards/` but are registered here because `LearningModule` is the only consumer in this feature).
- [X] T053 [P] [US8] E2E tests in `test/enrollment/enrollment.controller.e2e-spec.ts` (or a new `test/enrollment/learning.controller.e2e-spec.ts`) covering the guard chain: POST `/learning/lessons/:id/complete` as (a) unauthenticated → 401, (b) authenticated but not enrolled → 403, (c) authenticated and ACTIVE enrollment → 200 with the CompleteLessonResult shape, (d) authenticated with `PAUSED` enrollment → 403, (e) authenticated with `COMPLETED` enrollment → 403, (f) authenticated with `DROPPED` course enrollment → 403, (g) standalone course with learner holding only an unrelated path enrollment → 403.

**Checkpoint**: Full guard chain is enforced. Scenarios 1 and 2 of the cascade test now run through the real HTTP route as well (not just service-level calls).

---

## Phase 9: Polish & Cross-Cutting

- [X] T054 Update root `README.md` — add a short "Enrollment + Certificates (KAN-73)" section under the existing Content note. List the new endpoints (4 enrollment, 2 certificate, 1 learning) and the services exported by each module. Mention the two `TODO(...)` markers (KAN-quizzes, subscriptions) and link to the spec for rationale. **Note on analytics**: mention that `certificate_issued` now flows through `AnalyticsService.capture()` per FR-030; the underlying PostHog client wiring inside `AnalyticsService` itself remains a pre-existing TODO owned by a future analytics ticket (not KAN-73). This feature is compliant with the constitution's observability principle at the contract level — the event fires — and will automatically reach PostHog the moment `AnalyticsService` gets its real client with zero changes to certificate code.
- [X] T055 Grep audit: confirm exactly one `TODO(KAN-quizzes)` marker exists (inside `CertificatesService.allCourseQuizzesPassed`), exactly one `TODO(subscriptions)` marker exists (inside `ContentAccessGuard.hasActiveSubscription`), and exactly one `this.analytics.capture(` call with the literal event name `'certificate_issued'` exists in `src/certificates/` (inside `issueCertificate`). Commands: `grep -rn 'TODO(KAN-quizzes)\|TODO(subscriptions)' src/` and `grep -rn "analytics.capture.*certificate_issued" src/certificates/`.
- [X] T056 Diff audit: `git diff --stat prisma/schema.prisma prisma/migrations/ src/auth src/users src/content/tags src/content/marketing src/common/guards/roles.guard.ts` — every entry must be empty. Fix any unintended edit.
- [X] T057 Run full DoD suite: `npm run build`, `npx prisma validate`, `npm run test:schema`, `npm test`, `npm run test:content:e2e`. All green. Document the output in the PR.
- [X] T058 Manual smoke test from `quickstart.md` §5: seed a path with 2 courses, enroll, POST 4 lesson completions, confirm exactly 3 certificates exist in the database (2 course + 1 path).

---

## Dependencies

```
Setup (T001–T003)
        │
        ▼
Foundational (T004–T013)  ─── blocks everything below
        │
        ├──▶ US1 Course enroll   (T014–T018)
        │                              │
        ├──▶ US2 Path enroll     (T019–T022)   depends on T014/T016 (shared EnrollmentService, Module)
        │                              │
        │                              ▼
        ├──▶ US3+US4 Cascade    (T023–T035)   depends on T014+T019 (needs enrollInCourse + enrollInPath to seed scenarios)
        │                              │
        ├──▶ US5 List           (T036–T039)   depends on T016 (EnrollmentController)
        │                              │
        ├──▶ US6+US7 Certs HTTP (T040–T045)   depends on T026 (CertificatesModule) and T023–T025 (issuance)
        │                              │
        └──▶ US8+US9 Guards     (T046–T053)   depends on T014 (enrollInCourse for seeding), T028 (ProgressService.completeLesson), T016, T033
                                       │
                                       ▼
                              Polish (T054–T058)
```

**Strict order**: Foundational → US1 → US2 → US3+US4 → US5 → US6+US7 → US8+US9 → Polish.

**Why not more parallelism**: US3/US4 depend on both enroll flows (to seed the e2e test), and US8/US9 depend on the full cascade (to run the guard-chain e2e). Attempting to fan out earlier would create false parallelism: the e2e tests in each phase need the prior phase's services to exist.

**Intra-phase parallelism**: Unit specs ([P] tasks) can be written alongside their service/controller siblings. DTOs in Phase 2 are fully parallel. See the execution examples below.

## Parallel Execution Examples

**Phase 2 DTOs** — all seven DTO files in parallel:
```
T004 EnrollmentResponseDto ║ T005 PathEnrollmentResponseDto ║ T006 CourseEnrollmentResponseDto
T007 EnrollmentListResponseDto ║ T008 CourseEnrollmentDetailResponseDto
T009 CertificateResponseDto ║ T010 CertificateVerificationDto
→ then T011 delete progress controller → T012 LearningModule skeleton → T013 AppModule wiring
```

**Phase 5 (US3/US4)** — unit tests for Certificates and Progress can land in parallel with their implementations once the services compile:
```
T023 → T024 → T025 → T026 CertificatesModule wiring
                              ║ T027 CertificatesService spec [P]
T028 → T029 → T030 → T031 → T032 → T033 ProgressModule wiring
                              ║ T034 ProgressService spec [P]
→ T035 critical e2e
```

**Phase 8 (Guards)** — guard unit tests parallel to their implementations:
```
T046 hasAccessToCourse → T047 EnrollmentGuard rewrite
                              ║ T049 EnrollmentGuard spec [P]
T048 ContentAccessGuard rewrite
                              ║ T050 ContentAccessGuard spec [P]
→ T051 LearningController → T052 LearningModule → T053 guard-chain e2e [P]
```

## Implementation Strategy

- **MVP = US1 + US2 + US3 + US4** (all P1). After Phase 5 the feature already delivers the core promise — learners can enroll and earn certificates. Phases 6–8 add read surfaces and guard enforcement; Phase 9 is cleanup.
- **Guard chain lands last** (Phase 8). This is intentional: the stub guards already `return true`, so the earlier phases can use them as pass-throughs without adding fake security. Replacing them at the end avoids accidentally blocking in-progress e2e seeding.
- **Idempotency checked twice**: once in the Decision 3 fast path (T028 inline pre-check) and once in the Scenario 3 e2e test (T035). Both are required; the unit spec (T034) covers the third layer.
- **`forwardRef` only if needed**: T033 writes `forwardRef(() => CertificatesModule)` defensively per Decision 2. If NestJS does not flag a circular dependency at startup, we can drop the `forwardRef` before merging (cleaner imports). Decide during T033 implementation.
- **Cache wiring not addressed here**: KAN-74 is not a dependency for this feature. No `TODO(KAN-74)` markers added.

---

## Summary

- **Total tasks**: 59 (T023a added during analyze-phase remediation for FR-030)
- **By phase**: Setup 3 · Foundational 10 · US1 5 · US2 4 · US3+US4 14 · US5 4 · US6+US7 6 · US8+US9 8 · Polish 5
- **Parallelizable tasks** (marked `[P]`): 17
- **MVP scope**: T001–T035 (Setup + Foundational + US1 + US2 + US3 + US4) = 36 tasks
- **Critical test**: T035 (`test/enrollment/progress-cascade.e2e-spec.ts` scenarios 1–5) — Scenarios 1–2 prove the happy path, Scenario 3 proves idempotency, Scenario 4 proves LastPosition routing, Scenario 5 proves transactional rollback against a real Postgres. Its passage is the feature's headline DoD item.
- **Format validation**: Every task begins with `- [ ]`, carries a `T###` id, uses `[P]` where applicable and `[US#]` for story-phase tasks, and names an exact file path
