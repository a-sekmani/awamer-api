# Implementation Plan: Course Enrollment + Dual-Level Certificates

**Branch**: `011-enrollment-certificates` | **Date**: 2026-04-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-enrollment-certificates/spec.md`
**Source ticket**: `docs/tickets/KAN-73.md` (KAN-73)

## Summary

Deliver the three tightly-coupled modules that complete the learner loop introduced by Data Model v6: `EnrollmentModule` (path + standalone-course enrollment), `ProgressModule` (the transactional lesson-completion cascade), and `CertificatesModule` (dual-level course/path certificates with automatic issuance and public verification). Plus `LearningModule` (a single route wiring the full guard chain for `POST /learning/lessons/:id/complete`) and real implementations of `EnrollmentGuard` and `ContentAccessGuard` replacing the current always-allow stubs. No schema changes; no new npm dependencies.

Per the audit captured in `spec.md`, all affected modules are either missing or trivial stubs, so this is a greenfield implementation within the existing scaffolding. Three explicit fallbacks are in play: (1) quiz-pass check deferred with `TODO(KAN-quizzes)` until `QuizzesService` ships; (2) active-subscription check deferred with `TODO(subscriptions)` until that service exists; (3) `ContentAccessGuard` is extended in place rather than creating a duplicate `access.guard.ts` file.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS
**Primary Dependencies**: NestJS 11, Prisma 6.19, Passport JWT, class-validator 0.15, class-transformer 0.5, @nestjs/throttler 6.5, @nestjs/jwt, cookie-parser (all already in project — **no new deps**)
**Storage**: PostgreSQL via Prisma (shared `PrismaService` at `src/prisma/prisma.service.ts`). All required tables and enums are in place from KAN-70: `PathEnrollment`, `CourseEnrollment`, `LessonProgress`, `SectionProgress`, `CourseProgress`, `PathProgress`, `LastPosition` (dual-scope with partial unique indexes `last_positions_user_path_unique` and `last_positions_user_course_unique` plus a `last_positions_exactly_one_scope` CHECK), `Certificate` (nullable `pathId`/`courseId` + `type: CertificateType`), and `QuizAttempt` (uses `status: AttemptStatus = PASSED` for a pass).
**Testing**: Jest + ts-jest. Unit specs colocated with services (`*.service.spec.ts`). E2E specs under `test/enrollment/` and `test/certificates/`, reusing the existing `test/content/tags/test-app.ts` bootstrap (real NestJS pipeline with a signed JWT).
**Target Platform**: Linux server (NestJS HTTP, port 3001). Single-project NestJS monolith.
**Performance Goals**: The lesson-completion cascade completes within one Prisma transaction with a bounded number of round-trips (~6 queries + 2 conditional cert checks) for a typical course. Target p95 < 200ms for cascade; enrollment CRUD ≤ 50ms.
**Constraints**: Frozen files per ticket §14 — `prisma/schema.prisma`, `prisma/migrations/`, `src/auth`, `src/users`, `src/content/tags`, `src/content/marketing`, `src/common/guards/roles.guard.ts`, `prisma/seed.ts`. Arabic text must round-trip through certificate responses without encoding loss.
**Scale/Scope**: 4 new modules (Enrollment, Progress, Certificates, Learning), 2 guards rewritten in place, ~10 DTOs, 6 unit test suites, 3 e2e test suites, ~3 wire-up edits in `AppModule`. Net roughly 30 new files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|-----------|
| **I. Module Isolation** | PASS. Four new modules, each self-contained with its own controller + service + DTOs. Cross-module wiring is via NestJS module imports: `ProgressModule` imports `EnrollmentModule` and `CertificatesModule`; `LearningModule` imports `ProgressModule`. No direct service instantiation. DTOs are not shared across modules. Circular dep risk between Progress↔Certificates is handled with `forwardRef()` if NestJS flags it (per ticket §13.5). |
| **II. Security-First** | PASS. `passwordHash` never referenced. Certificate verification response is a dedicated DTO with only the permitted fields (type, issuedAt, holder.fullName, subject.title/slug/type) — no email, no enrollment date, no progress. `JwtAuthGuard` protects every learner endpoint; the single public endpoint (`GET /certificates/verify/:code`) is explicitly marked `@Public()`. Helmet + throttler remain globally active. `EnrollmentGuard` and `ContentAccessGuard` enforce the access chain for protected learning operations. |
| **III. Standard Response Contract** | PASS. All success responses go through the existing `ResponseTransformInterceptor` → `{ data, message }`. URLs use kebab-case: `/api/v1/enrollments/courses/:courseId`, `/api/v1/enrollments/paths/:pathId`, `/api/v1/enrollments/me`, `/api/v1/enrollments/me/courses/:courseId`, `/api/v1/certificates/me`, `/api/v1/certificates/verify/:code`, `/api/v1/learning/lessons/:lessonId/complete`. Request/response bodies camelCase. No pagination added (per-user lists are small). |
| **IV. Transactional Integrity** | PASS. Every multi-step write runs inside `prisma.$transaction(async (tx) => { ... })`: (1) `enrollInPath` creates PathEnrollment + PathProgress + per-course CourseProgress; (2) `enrollInCourse` creates CourseEnrollment + CourseProgress + per-section SectionProgress; (3) `completeLesson` runs the full cascade including certificate issuance. The DoD's Scenario 1 and Scenario 2 e2e tests validate atomicity against a real Postgres. |
| **V. Data Validation & Type Safety** | PASS. All PKs remain UUIDs. All request params use `ParseUUIDPipe`. The enrollment POSTs have empty bodies (no body DTOs needed). Response DTOs are TypeScript classes with `@Expose()`/`@Exclude()` per ticket §9. Dates returned as ISO strings via the existing serialization. No `any` types. Global `ValidationPipe` already enabled. |
| **VI. Access Control Hierarchy** | PASS. This is the ticket that finally implements the principle. `ContentAccessGuard` enforces the exact constitutional order: `Path.isFree → Course.isFree → Lesson.isFree → active subscription → deny`. For standalone courses (no parent path) the `Path.isFree` step is skipped — which is the only legitimate divergence and is documented in FR-026. `EnrollmentGuard` runs BEFORE `ContentAccessGuard` per FR-025, so non-enrolled users are rejected before any paywall evaluation leaks free/paid state. The two guards remain distinct (not merged). While `SubscriptionsService` is absent, the final "active subscription" step stubs to allow with `TODO(subscriptions)` — documented in research.md and spec.md. |

**Result**: All six gates pass. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/011-enrollment-certificates/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── enrollment.md
│   ├── certificates.md
│   └── learning.md
├── checklists/
│   └── requirements.md  # from /speckit.specify
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/enrollment/                            # NEW
├── enrollment.module.ts
├── enrollment.service.ts
├── enrollment.service.spec.ts
├── enrollment.controller.ts
└── dto/
    ├── enrollment-response.dto.ts
    ├── path-enrollment-response.dto.ts
    ├── course-enrollment-response.dto.ts
    ├── enrollment-list-response.dto.ts
    └── course-enrollment-detail-response.dto.ts

src/progress/                              # REPLACE STUBS
├── progress.module.ts                     # MODIFIED — imports forwardRef(CertificatesModule), imports EnrollmentModule
├── progress.service.ts                    # REPLACED — real cascade
├── progress.service.spec.ts               # NEW
└── progress.controller.ts                 # DELETED — no HTTP surface, service is internal

src/certificates/                          # REPLACE STUBS
├── certificates.module.ts                 # MODIFIED
├── certificates.service.ts                # REPLACED
├── certificates.service.spec.ts           # NEW
├── certificates.controller.ts             # REPLACED
└── dto/
    ├── certificate-response.dto.ts
    └── certificate-verification.dto.ts

src/learning/                              # NEW single-route module
├── learning.module.ts
└── learning.controller.ts                 # thin — calls ProgressService

src/common/guards/
├── enrollment.guard.ts                    # REPLACED (was stub) — delegates to EnrollmentService.hasAccessToCourse
├── enrollment.guard.spec.ts               # NEW
├── content-access.guard.ts                # REPLACED (was stub) — kept at existing filename; NOT renamed to access.guard.ts
└── content-access.guard.spec.ts           # NEW

src/app.module.ts                          # MODIFIED — register LearningModule (Enrollment/Progress/Certificates already registered)

test/enrollment/
├── enrollment.controller.e2e-spec.ts
└── progress-cascade.e2e-spec.ts           # CRITICAL — ticket §11.5 scenarios 1–4

test/certificates/
└── certificates.controller.e2e-spec.ts

test/content-e2e-jest.config.js            # MODIFIED — extend testRegex to cover test/enrollment/ and test/certificates/
```

**Structure Decision**: Single-project NestJS layout with four new submodules. Per ticket §14 the `roles.guard.ts` stub is frozen but the other stub guards (`enrollment.guard.ts`, `content-access.guard.ts`) are explicitly NOT frozen; they are rewritten in place at the same filenames. The `progress.controller.ts` stub is deleted because this feature exposes lesson completion via `LearningModule` instead (per clarification Q1); keeping an empty progress controller would be dead code. The existing `test/content/tags/test-app.ts` bootstrap is reused directly by the new e2e specs (imported via relative path). The existing `test/content-e2e-jest.config.js` regex is widened from `test/content/.*\.e2e-spec\.ts$` to `test/(content|enrollment|certificates)/.*\.e2e-spec\.ts$` so `npm run test:content:e2e` picks up the new suites without introducing a new script (simpler than adding `test:learning:e2e` per ticket §11.6).

## Complexity Tracking

*No constitution violations. Table intentionally empty.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
