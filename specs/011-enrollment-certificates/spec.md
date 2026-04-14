# Feature Specification: Course Enrollment + Dual-Level Certificates

**Feature Branch**: `011-enrollment-certificates`
**Created**: 2026-04-14
**Status**: Draft
**Input**: User description: "Use docs/tickets/KAN-73.md as the single source of truth for this feature. Read it in full and generate the spec from it. The audit step in §2 is mandatory — Claude Code must report its findings before any implementation begins, because the existing state of src/enrollment, src/progress, src/certificates is unknown and may contain pre-v6 code."
**Source of truth**: `docs/tickets/KAN-73.md` (KAN-73)

---

## Audit findings (ticket §2 — mandatory precondition)

The audit required by the ticket has been performed. Summary of the current repository state:

- **`src/enrollment/`** — does not exist. Must be created.
- **`src/progress/`** — stub-only: empty `ProgressService`, trivial `ProgressController`, empty `ProgressModule`. No pre-v6 logic to migrate; the stub is a placeholder planted by earlier scaffolding.
- **`src/certificates/`** — stub-only: empty `CertificatesService`, trivial `CertificatesController`, empty `CertificatesModule`.
- **`src/quizzes/`** — stub-only: empty `QuizzesService`. The ticket's §6.3 fallback applies: quiz-related eligibility is deferred with `TODO(KAN-quizzes)` markers.
- **`src/common/guards/enrollment.guard.ts`** — exists as a stub (`canActivate` always returns `true`). Must be replaced with a real implementation.
- **`src/common/guards/access.guard.ts`** — does **not** exist under that name; the equivalent stub is `src/common/guards/content-access.guard.ts` (`ContentAccessGuard`, always returns `true`). **Decision**: extend the existing `ContentAccessGuard` in place rather than creating a new `access.guard.ts`. This minimizes churn in `src/common/` and avoids a duplicate guard.
- **Prisma schema**: `PathEnrollment`, `CourseEnrollment`, `Certificate` (with nullable `pathId`/`courseId` and `type` enum), and `QuizAttempt` all exist from KAN-70. `QuizAttempt.status` uses the `AttemptStatus` enum (`IN_PROGRESS` / `PASSED` / `FAILED`); there is no `passed: boolean` field — a pass is represented by `status = PASSED`.
- **Enrollment status enums differ by type**: `EnrollmentStatus` for paths is `{ACTIVE, COMPLETED, PAUSED}`; `CourseEnrollmentStatus` for courses is `{ACTIVE, COMPLETED, DROPPED}`. Response shapes that surface both types will union these values.
- **No `SubscriptionsService` method exists for active-subscription checks.** Per ticket §13.3, the subscription branch in the access guard stubs to "allow" with a `TODO(subscriptions)` marker.

**Impact on scope**: because every affected module is either a trivial stub or missing entirely, this feature is effectively a greenfield implementation within the existing scaffolding. No pre-v6 refactoring is needed. No existing tests rely on stub behavior.

---

## Clarifications

### Session 2026-04-14

- Q: Does this feature ship the `POST /learning/lessons/:id/complete` HTTP endpoint, or only the service method? → A: Ship both — add a minimal `LearningModule` that exposes `POST /learning/lessons/:id/complete`, delegates to `ProgressService.completeLesson`, and is protected by the full guard chain (`JwtAuthGuard + EnrollmentGuard + ContentAccessGuard`). This gives the DoD guard-chain test something concrete to call end-to-end.
- Q: How should the verification response populate `holder.firstName` / `holder.lastName` when `User.name` is a single field? → A: Replace `holder.firstName` and `holder.lastName` with a single `holder.fullName` field populated from `User.name`. Arabic names don't split cleanly on whitespace, so a forced split would produce culturally wrong results for the target market. The verification response shape becomes `{ valid, type, issuedAt, holder: { fullName }, subject: { type, title, slug } }`.
- Q: Which enrollment statuses grant access through the enrollment guard? → A: Only `ACTIVE`. Enrollments in `COMPLETED`, `PAUSED`, or `DROPPED` states MUST return forbidden from protected learning operations. This matches the ticket's §11.1 unit-test assertion that `hasAccessToCourse` returns `false` when an enrollment exists but its status is not `ACTIVE`.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enroll in a standalone course (Priority: P1)

A learner discovers a standalone course (one that is not part of any learning path) and chooses to enroll so they can track progress and earn a certificate on completion.

**Why this priority**: Standalone courses are the primary new capability delivered by Data Model v6. Without this flow, the v6 model adds a table no user can interact with.

**Independent Test**: Seed a standalone course with sections and lessons. As an authenticated learner, request enrollment. Observe that enrollment is recorded, progress rows are initialized at 0%, and the course now appears in the learner's enrollment list.

**Acceptance Scenarios**:

1. **Given** a standalone course (not attached to any path) and an authenticated learner, **When** they enroll in the course, **Then** the enrollment is recorded as active and progress for the course and each of its sections is initialized at 0% (not yet started).
2. **Given** a course that belongs to a path, **When** a learner attempts to enroll in that course directly, **Then** the request is rejected with a clear message indicating they must enroll in the parent path instead, and the response includes the parent path identifier so the client can redirect.
3. **Given** a learner already enrolled in a standalone course, **When** they attempt to enroll in it again, **Then** the request is rejected as a duplicate and no additional rows are created.
4. **Given** a course identifier that does not exist, **When** a learner attempts to enroll, **Then** the request is rejected as not found.

---

### User Story 2 - Enroll in a learning path (Priority: P1)

A learner enrolls in a full path and expects every course within it to be automatically tracked for progress.

**Why this priority**: Path enrollment is the primary discovery flow; most learners enter the platform through a path rather than a standalone course.

**Independent Test**: Seed a path with multiple courses. Enroll a learner in the path. Verify the path enrollment is recorded, a zeroed progress row exists for every course in the path, and the overall path progress starts at 0%.

**Acceptance Scenarios**:

1. **Given** a path with two or more courses and an authenticated learner, **When** the learner enrolls in the path, **Then** a path enrollment is recorded and an empty course progress row is created for every course in the path.
2. **Given** a learner already enrolled in a path, **When** they attempt to enroll in it again, **Then** the request is rejected as a duplicate.
3. **Given** the same learner enrolls in a path AND (separately) in an unrelated standalone course, **When** they view their enrollments, **Then** both enrollments appear and are independent of each other.

---

### User Story 3 - Earn a course-level certificate automatically (Priority: P1)

As a learner completes the last lesson of a course, the system automatically recognizes they have finished the course and issues a certificate for it — without the learner having to claim anything.

**Why this priority**: Automatic issuance is the core value proposition of the certificate system. A manual claim step would be a UX regression.

**Independent Test**: Seed a standalone course with N lessons. Enroll a learner, complete lessons one by one, and after the last lesson verify exactly one course certificate exists for this learner and course. Re-completing the last lesson must not issue a second certificate.

**Acceptance Scenarios**:

1. **Given** a learner enrolled in a standalone course with 6 lessons, **When** they complete all 6 lessons, **Then** exactly one course-level certificate is issued for this learner and course, the certificate's subject type is "course", and the course progress reaches 100%.
2. **Given** that same learner re-submits completion for an already-completed lesson, **When** the system processes the request, **Then** no new certificate is issued and no progress percentage changes.
3. **Given** the course contains at least one quiz, **When** the learner completes every lesson but has not passed a required quiz, **Then** no certificate is issued — **unless** the platform's quiz capability has not yet shipped, in which case the quiz requirement is treated as satisfied (documented fallback while the quiz workflow is incomplete).

---

### User Story 4 - Earn a path-level certificate automatically (Priority: P1)

A learner who finishes every course in a path is automatically awarded a path-level certificate — separate from (and in addition to) the course-level certificates they earned along the way.

**Why this priority**: Path certificates are the highest-value credential the platform issues. Learners pursuing a path expect the completion credential to arrive without friction.

**Independent Test**: Seed a path with 2 courses (each with lessons). Enroll a learner, complete every lesson across both courses, and verify the final state contains exactly 3 certificates: one for course A, one for course B, and one for the path. Reordering the completion sequence must not change the final certificate count.

**Acceptance Scenarios**:

1. **Given** a learner enrolled in a path with 2 courses, **When** they complete the last lesson of the first course, **Then** a course certificate for the first course is issued and the path certificate is NOT yet issued.
2. **Given** the same learner continues and completes the last lesson of the second course, **When** the completion is processed, **Then** a course certificate for the second course is issued AND a path certificate for the path is issued in the same transaction.
3. **Given** that the same cascade runs, **When** the dust settles, **Then** the total certificate count is exactly three, each with the correct subject type and identifiers.
4. **Given** a learner who has finished every lesson in every course of the path but never enrolled in the path, **When** the system evaluates eligibility, **Then** no path certificate is issued (enrollment is a prerequisite).

---

### User Story 5 - View my enrollments (Priority: P2)

A learner opens their dashboard and sees everything they are currently enrolled in, grouped by type (paths vs. standalone courses), each with a progress summary.

**Why this priority**: The dashboard is the learner's home screen; the enrollment list is its backbone.

**Independent Test**: Seed one path enrollment and one standalone-course enrollment for a learner. Fetch their enrollment list and confirm both appear in the right groups, with progress percentages, sorted with the most recent first.

**Acceptance Scenarios**:

1. **Given** a learner with one path enrollment and one standalone-course enrollment, **When** they fetch their enrollments, **Then** the response contains the path under "paths", the standalone course under "courses", each with a progress summary and ordered by enrollment date descending.
2. **Given** a learner who has enrolled in a path that contains courses, **When** they fetch their enrollments, **Then** the path appears under "paths" and its child courses do NOT appear under "courses".
3. **Given** a learner with no enrollments, **When** they fetch their enrollments, **Then** both groups are returned as empty lists (not an error).

---

### User Story 6 - View my certificates (Priority: P2)

A learner opens their achievements view and sees every certificate they have earned, most recent first, with enough data to link to the subject (course or path).

**Why this priority**: Learners want to showcase credentials; without a list view the certificates are invisible.

**Independent Test**: Issue several course and path certificates to a learner and fetch the list. Verify each entry carries the correct subject type, title, slug, and unique verification code.

**Acceptance Scenarios**:

1. **Given** a learner with multiple issued certificates, **When** they fetch their certificates, **Then** the response lists each certificate with its type (course or path), the subject's title and slug, the issuance timestamp, and the verification code.
2. **Given** the list, **When** sorted, **Then** the most recently issued certificate appears first.
3. **Given** a learner with no certificates, **When** they fetch the list, **Then** an empty list is returned.

---

### User Story 7 - Third-party certificate verification (Priority: P2)

An employer or third party wants to verify a certificate by its code, without requiring an account, to confirm authenticity.

**Why this priority**: Credentials lose value if they can't be verified externally. Verification must be public and unauthenticated.

**Independent Test**: Issue a certificate and then hit the public verification path with its code (unauthenticated). Confirm the response confirms authenticity, shows the subject and holder name, and contains no private learner data.

**Acceptance Scenarios**:

1. **Given** a valid certificate code, **When** any unauthenticated caller requests verification for that code, **Then** the response confirms the certificate is valid, identifies the subject (course or path title/slug), and shows the holder's full name as a single field (per 2026-04-14 clarification — no firstName/lastName split).
2. **Given** an unknown code, **When** verification is requested, **Then** the response is a not-found result (not a 200 with "invalid" — to avoid probing).
3. **Given** a verification response, **When** inspected for sensitive data, **Then** it contains no email, no enrollment date, and no progress information.

---

### User Story 8 - Learning endpoints reject non-enrolled users (Priority: P1)

A protected learning action (e.g. marking a lesson complete) must refuse to run for any learner who is not enrolled in the owning path or course.

**Why this priority**: Without this gate, any authenticated user could drive progress or harvest content they haven't paid for.

**Independent Test**: As an authenticated but non-enrolled user, call the lesson-completion endpoint on a lesson; expect a forbidden response. Then enroll the same user in the owning path or standalone course (with status `ACTIVE`) and retry; expect success. As a third check, mark the enrollment as `PAUSED` or `COMPLETED` and retry; expect forbidden again.

**Acceptance Scenarios**:

1. **Given** a learner authenticated but not enrolled in the course containing a lesson, **When** they attempt a protected learning action on that lesson, **Then** the request is rejected as forbidden.
2. **Given** the same learner now has an `ACTIVE` enrollment that grants access (either a course enrollment for a standalone course, or a path enrollment for the parent path), **When** they retry, **Then** the action proceeds.
3. **Given** a lesson whose course has no parent path (standalone) and a learner who holds only a path enrollment for an unrelated path, **When** they attempt the action, **Then** the request is forbidden.
4. **Given** a learner who has an enrollment for the correct course/path but whose enrollment status is `COMPLETED`, `PAUSED`, or `DROPPED`, **When** they attempt a protected learning action, **Then** the request is rejected as forbidden.

---

### User Story 9 - Free preview access (Priority: P2)

Free content (a lesson marked free, a course marked free, or a lesson inside a path marked free) is accessible without a paid subscription. All other content requires an active subscription.

**Why this priority**: Free previews drive conversion. Mis-gating them either breaks the funnel (under-gating) or walls off paid users (over-gating).

**Independent Test**: Seed lessons at each of the three free levels and one fully-paid lesson. As a user without a subscription, confirm the three free lessons are accessible and the paid lesson is rejected.

**Acceptance Scenarios**:

1. **Given** a lesson explicitly marked as free, **When** a user without a subscription accesses it, **Then** access is allowed.
2. **Given** a lesson that is not free but belongs to a course that is free, **When** a user without a subscription accesses it, **Then** access is allowed.
3. **Given** a lesson inside a path-attached course where the parent path is marked free, **When** a user without a subscription accesses it, **Then** access is allowed.
4. **Given** a fully paid lesson (no free flag at any level), **When** a user without an active subscription accesses it, **Then** access is rejected — **unless** subscription checking has not yet shipped, in which case access is temporarily allowed while the subscription workflow is incomplete (documented fallback).
5. **Given** a standalone course (no parent path), **When** the access rules run, **Then** the "parent path is free" check is skipped (there is no parent path).

---

### Edge Cases

- Completing a lesson triggers a cascade that may update several progress rows, may issue zero, one, or two certificates (course and path), and must be atomic: either every change is persisted or none is.
- Completing a lesson that is already marked complete must be a no-op — no new timestamps, no re-issued certificates, no error.
- A learner can hold a path enrollment and a standalone-course enrollment for unrelated content simultaneously; they must not affect each other.
- A learner can never be path-enrolled and course-enrolled for the same course at the same time (path-attached courses reject direct course enrollment).
- A path certificate is only issued when the learner has a path enrollment AND every course in the path has a course-level certificate for them.
- Last position must route to the correct scope: a completed lesson inside a path-enrolled course updates the path-scoped last position; a completed lesson in a standalone course updates the course-scoped last position.
- Certificate codes are globally unique and URL-safe; on the rare collision during generation, the system retries a small, bounded number of times before failing.
- Verification of an unknown certificate code returns a not-found response, not a 200-with-invalid, to avoid probing.
- When the quiz subsystem is not yet operational, course eligibility treats "all quizzes passed" as satisfied but leaves a clearly-marked TODO so it can be turned back on when quizzes ship.
- When the subscription subsystem is not yet operational, the paid-content branch of the access check temporarily allows access but leaves a clearly-marked TODO.

## Requirements *(mandatory)*

### Functional Requirements

**Enrollment core**

- **FR-001**: The system MUST allow an authenticated learner to enroll in a standalone course (one with no parent path) and MUST create, in a single atomic operation, the course enrollment, the course progress row (starting at 0%), and an empty section progress row for each section of the course.
- **FR-002**: The system MUST reject a direct course enrollment request for a course that belongs to a path, with a clear error that names the parent path identifier so the client can redirect the learner to the path enrollment flow.
- **FR-003**: The system MUST allow an authenticated learner to enroll in a path and MUST create, in a single atomic operation, the path enrollment, the path progress row, and an empty course progress row for every course in the path.
- **FR-004**: The system MUST reject a duplicate enrollment (same learner + same path, or same learner + same course) with a conflict result and no new rows written.
- **FR-005**: The system MUST reject an enrollment request for a non-existent path or course with a not-found result.
- **FR-006**: The system MUST support a learner holding a path enrollment and a standalone-course enrollment simultaneously, treating them as independent.
- **FR-007**: The system MUST provide an authenticated list operation that returns the current learner's enrollments grouped as `{ paths, courses }`, each with a progress summary, ordered by enrollment date descending; path-attached courses MUST NOT appear under `courses`.
- **FR-008**: The system MUST provide an authenticated detail operation that returns a specific course enrollment (with progress and last position) for the current learner; when the course does not exist OR the learner is not enrolled, the system MUST return the same not-found result to avoid leaking course existence.

**Progress cascade**

- **FR-009**: The system MUST expose a lesson-completion operation that, for a given learner and lesson, records the lesson as completed, recalculates section progress, course progress, and (if the course has a parent path) path progress, updates the learner's last position, evaluates course-level certificate eligibility, and (if applicable) evaluates path-level certificate eligibility — all within a single atomic transaction.
- **FR-010**: The system MUST return from the lesson-completion operation a single structured result containing the updated progress rows and any certificates newly issued by the call.
- **FR-011**: The lesson-completion operation MUST be idempotent: re-completing an already-completed lesson MUST NOT update the completed-at timestamp, MUST NOT re-issue certificates, and MUST return the current state.
- **FR-012**: On partial failure anywhere in the cascade, the system MUST roll back every change so the database is left in a consistent state.
- **FR-013**: The system MUST skip path-progress recalculation when the lesson's course has no parent path (standalone courses).
- **FR-014**: The system MUST route the learner's last position to the path scope when the learner holds a path enrollment for the lesson's parent path, and to the course scope otherwise (including all standalone-course cases).

**Certificates**

- **FR-015**: The system MUST issue a course-level certificate to a learner who has (a) either a course enrollment for the course or a path enrollment for its parent path, (b) completed every lesson in every section of the course, and (c) a passing attempt for every quiz in the course — with (c) treated as satisfied while the quiz subsystem is not yet shipped, marked with a traceable TODO. While the quiz subsystem is absent, the quiz requirement is treated as satisfied **regardless of how many quizzes the course defines** (i.e., the stub does not inspect the quiz count). When KAN-quizzes ships, this fallback is replaced by a real check that every `Quiz` belonging to the course has at least one `QuizAttempt` with `status = 'PASSED'` for the learner.
- **FR-016**: The system MUST issue a path-level certificate to a learner who has (a) a path enrollment for the path and (b) a valid course-level certificate for every course in the path.
- **FR-017**: Certificate issuance MUST be idempotent per subject: repeated eligibility checks MUST NOT create duplicate certificates, and when a certificate already exists the system returns the existing one.
- **FR-018**: Each certificate MUST carry a globally-unique, URL-safe verification code; on a collision during generation, the system MUST retry a small, bounded number of times before failing the operation.
- **FR-019**: The system MUST provide an authenticated list operation that returns every certificate for the current learner, most recent first, with enough subject data (title, slug) to link to the course or path.
- **FR-020**: The system MUST provide an unauthenticated verification operation that, given a certificate code, returns a response confirming validity and revealing only the subject's title/slug/type, the holder's full name as a single `fullName` field, and the issuance timestamp; unknown codes MUST return a not-found result.
- **FR-021**: The verification response MUST NOT contain the holder's email, enrollment date, progress information, or any other non-essential private data.

**Access control**

- **FR-022**: The system MUST reject protected learning operations for learners who are not enrolled in the owning course (either directly via a course enrollment or indirectly via a path enrollment for the course's parent path), with a forbidden result. An enrollment grants access only when its status is `ACTIVE`; `COMPLETED`, `PAUSED`, and `DROPPED` enrollments MUST be treated as not granting access.
- **FR-023**: The system MUST allow access to content that is free at any level of the hierarchy — a free lesson, a free course, or (for path-attached courses only) a free parent path — regardless of subscription state.
- **FR-024**: The system MUST require an active subscription for paid content (no free flag at any level); while the subscription subsystem is not yet shipped, the system temporarily allows paid access with a traceable TODO.
- **FR-025**: The system MUST apply enrollment enforcement strictly before paywall enforcement, so that a user who is not enrolled never reveals whether a lesson is free or paid.
- **FR-026**: For standalone courses, the access check MUST skip the "parent path is free" branch (there is no parent path).

**Learning endpoint**

- **FR-026a**: The system MUST expose an authenticated HTTP operation for a learner to mark a lesson as complete, which internally delegates to the lesson-completion cascade (FR-009 – FR-014). The operation MUST be protected by the full guard chain in the order authentication → enrollment → access, so that a non-enrolled learner is rejected before any paywall evaluation runs and a non-subscribed learner is rejected before any progress is recorded.

**Scope boundaries**

- **FR-027**: This feature MUST NOT modify the database schema or existing migrations.
- **FR-028**: This feature MUST NOT touch the frozen modules and files listed in ticket §14 (auth, users, onboarding, content/tags, content/marketing, the existing roles guard, the seed script, or CI configuration).
- **FR-029**: This feature MUST NOT add new external dependencies unless a new dependency is explicitly justified.

**Observability**

- **FR-030**: The system MUST emit a `certificate_issued` event via `AnalyticsService.capture()` exactly once at the moment a new `Certificate` row is inserted, containing the fields: `userId`, `certificateId`, `certificateType` (`'PATH' | 'COURSE'`), `pathId` OR `courseId` (whichever is non-null for the issued certificate), `certificateCode`, and `issuedAt` (ISO string). The event MUST NOT be emitted when `checkCourseEligibility` or `checkPathEligibility` returns a pre-existing certificate. The invariant the system MUST uphold is: **a failure in event emission MUST NOT cause the certificate issuance to be rolled back**. How this invariant is satisfied is an implementation concern — it may be satisfied today by `AnalyticsService.capture()` being synchronous and non-throwing (the current stub), or in the future by `AnalyticsService` internalizing `try/catch`, async buffering, or `setImmediate` when a real PostHog client is wired. Callers of `CertificatesService.issueCertificate` MUST NOT be expected to wrap the emission in defensive code.

  **Implementation rationale**: The `capture()` call is placed inside `CertificatesService.issueCertificate` immediately after `tx.certificate.create` resolves, still within the Prisma transaction callback. This is safe today because `AnalyticsService.capture()` is synchronous, returns `void`, and does not throw — the transaction cannot be aborted by it. This placement also provides a structural idempotency guarantee: `checkCourseEligibility` and `checkPathEligibility` short-circuit BEFORE reaching `issueCertificate` when an existing certificate is found, so the emission site is only reachable on the genuine new-issuance branch. When `AnalyticsService` eventually gains a real PostHog client, the FR-030 invariant ("emission failure must not roll back issuance") becomes the responsibility of `AnalyticsService` itself — via local `try/catch`, async capture buffering, or `setImmediate` — rather than being pushed up to every caller. The certificate domain owns the contract "issuing a certificate emits an event"; call sites must not be forced to remember this or to wrap it defensively.

### Key Entities *(include if feature involves data)*

- **Path Enrollment**: Represents a learner's enrollment in a learning path. Attributes include learner, path, enrollment status, and enrollment timestamp. One learner can have at most one path enrollment per path.
- **Course Enrollment**: Represents a learner's enrollment in a standalone course. Attributes include learner, course, enrollment status, and enrollment timestamp. One learner can have at most one course enrollment per standalone course; course enrollment is forbidden for courses that belong to a path.
- **Lesson Progress**: Tracks whether a learner has completed a specific lesson (not-started / in-progress / completed), with a completion timestamp.
- **Section Progress**: Aggregated progress across all lessons in a section for a given learner (percent and status).
- **Course Progress**: Aggregated progress across all sections in a course for a given learner (percent and status).
- **Path Progress**: Aggregated progress across all courses in a path for a given learner (percent and status). Only exists for path-enrolled learners.
- **Last Position**: The learner's most recent position within the content hierarchy, routed either to a path scope (for path-enrolled learners) or a course scope (for standalone-course learners).
- **Certificate**: A credential issued to a learner for a completed subject. Each certificate carries a subject type (course or path), the subject's identifier, a unique verification code, and the issuance timestamp. Path and course certificates are separate credentials; a learner can hold both for the same path when they finish it.
- **Quiz Attempt**: A learner's attempt at a quiz, with a status that indicates pass/fail. Used as an input to course-certificate eligibility (passing attempts required), with a documented fallback while the quiz subsystem is incomplete.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A learner can enroll in a standalone course, complete every lesson, and receive exactly one course certificate with the correct subject type and identifier, verified end-to-end against a real database.
- **SC-002**: A learner can enroll in a path of 2 or more courses, complete every lesson across all courses, and end up with exactly one path certificate plus one course certificate per course — no more, no fewer.
- **SC-003**: Re-completing an already-completed lesson never creates duplicate progress rows or duplicate certificates under any tested scenario.
- **SC-004**: A non-enrolled learner is always rejected from protected learning operations, regardless of whether the content is free or paid, verified across both standalone and path-attached courses.
- **SC-005**: The free-content cascade (free lesson, free course, free path) correctly allows access without a subscription, and paid content is protected once the subscription subsystem is in place; while the subscription subsystem is absent, the temporary allow-all behavior is traceable via a marker in the codebase.
- **SC-006**: Certificate verification returns only the permitted fields (subject, holder full name as a single `fullName` field, issued-at, type) and never leaks the holder's email, enrollment date, or progress data.
- **SC-007**: Every write path (enrollment creation, lesson completion cascade, certificate issuance) is atomic: a forced failure at any internal step leaves the database in exactly the state it had before the call.
- **SC-008**: KAN-26 (public discovery endpoints) can compose course- and path-level enrollment and certificate information by calling the services this feature exposes, with no additional direct database access required.
- **SC-009**: The feature ships without modifying the database schema, existing migrations, or the frozen modules listed in the ticket, verifiable by diff inspection.

## Assumptions

- Prisma models for `PathEnrollment`, `CourseEnrollment`, `LessonProgress`, `SectionProgress`, `CourseProgress`, `PathProgress`, `LastPosition`, `Certificate`, and `QuizAttempt` are already in place from KAN-70 and will not be modified.
- Existing stubs in `src/enrollment/` (absent), `src/progress/`, `src/certificates/`, `src/quizzes/`, `src/common/guards/enrollment.guard.ts`, and `src/common/guards/content-access.guard.ts` are empty placeholders and can be replaced wholesale without migrating any real logic.
- The ticket's reference to `src/common/guards/access.guard.ts` refers to the same concept as the existing `ContentAccessGuard` at `content-access.guard.ts`; this feature will extend the existing guard in place rather than add a duplicate file.
- `QuizAttempt` represents pass/fail via its `status` enum (value `PASSED`), not a `passed` boolean. Because `QuizzesService` itself is a stub with no submission flow, course eligibility treats the quiz requirement as satisfied with a `TODO(KAN-quizzes)` marker, per ticket §13.1.
- No `SubscriptionsService` method exposes an "active subscription" check yet; per ticket §13.3, the subscription branch of the access guard temporarily returns "allow" with a `TODO(subscriptions)` marker.
- E2E tests reuse the existing `awamer_test` database and the `test/content/tags/test-app.ts` bootstrap helper (real NestJS pipeline with a signed JWT).
- Certificate verification codes are short, URL-safe strings (the ticket specifies 12 characters); collisions are resolved by retry.
- Guard chain is `authentication → enrollment → access`; all three run in order for protected learning endpoints.
- A new minimal `LearningModule` will host the single `POST /learning/lessons/:id/complete` route that wires the guard chain and delegates to `ProgressService`. No other learning endpoints ship in this feature.
- `holder.fullName` in the verification response comes directly from `User.name` with no splitting or transformation.
- Arabic text in course and path titles round-trips through certificate responses without encoding issues.

## Dependencies

- **KAN-70** (Prisma schema v6) — delivers every entity and enum this feature needs. Done.
- **KAN-71** (Tags module) — established the test harness (`test-app.ts`) and admin guard conventions this feature reuses. Done.
- **KAN-72** (Marketing Content) — frozen, out of scope; this feature must not touch it.
- **KAN-26** (Public discovery endpoints) — downstream consumer of the services this feature exposes; not delivered here.
- **Future quiz subsystem** — when shipped, removes the `TODO(KAN-quizzes)` fallback.
- **Future subscription-check capability** — when shipped, removes the `TODO(subscriptions)` fallback in the access guard.
