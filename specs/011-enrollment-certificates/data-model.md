# Phase 1 — Data Model: Enrollment + Certificates

**Feature**: 011-enrollment-certificates
**Date**: 2026-04-14

This feature does **not** introduce or modify any Prisma schema. Every table, enum, index, and check constraint referenced below already exists from KAN-70. This document maps each entity to the application-layer rules, state transitions, and validation that this feature enforces on top of the schema.

---

## Enums (already in schema)

| Enum | Values | Used by |
|---|---|---|
| `EnrollmentStatus` | `ACTIVE` · `COMPLETED` · `PAUSED` | `PathEnrollment.status` |
| `CourseEnrollmentStatus` | `ACTIVE` · `COMPLETED` · `DROPPED` | `CourseEnrollment.status` |
| `ProgressStatus` | `NOT_STARTED` · `IN_PROGRESS` · `COMPLETED` | `LessonProgress`, `SectionProgress`, `CourseProgress`, `PathProgress` |
| `CertificateType` | `PATH` · `COURSE` | `Certificate.type` |
| `AttemptStatus` | `IN_PROGRESS` · `PASSED` · `FAILED` | `QuizAttempt.status` (read-only in this feature) |

**Access rule (per FR-022 and clarification Q3)**: only `EnrollmentStatus.ACTIVE` / `CourseEnrollmentStatus.ACTIVE` grant access through `EnrollmentGuard`. All other values are treated as "not enrolled for access purposes" even though the row still exists for history.

---

## Entity: PathEnrollment

**Table**: `path_enrollments` · **Prisma model**: `PathEnrollment`

### Fields

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | PK |
| `userId` | UUID | no | FK → User |
| `pathId` | UUID | no | FK → Path |
| `status` | `EnrollmentStatus` | no | defaults to `ACTIVE` |
| `enrolledAt` | DateTime | no | `@default(now())` |
| `createdAt`, `updatedAt` | DateTime | no | |

**Uniqueness**: not declared via `@@unique` in the schema; duplicate prevention is enforced inside the `enrollInPath` transaction via an explicit `findFirst` before insert, then the transaction raises `ConflictException` on hit.

### Lifecycle
`ACTIVE` on creation → (future) may transition to `PAUSED` or `COMPLETED`. This feature only creates new `ACTIVE` rows; transitions are out of scope.

---

## Entity: CourseEnrollment

**Table**: `course_enrollments` · **Prisma model**: `CourseEnrollment`

### Fields

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | PK |
| `userId` | UUID | no | FK → User |
| `courseId` | UUID | no | FK → Course |
| `status` | `CourseEnrollmentStatus` | no | defaults to `ACTIVE` |
| `enrolledAt` | DateTime | no | `@default(now())` |

**Uniqueness**: `@@unique([userId, courseId])` is declared. The `enrollInCourse` service catches Prisma `P2002` and converts to `ConflictException`.

### Creation invariant
`enrollInCourse` MUST reject any `courseId` whose `course.pathId IS NOT NULL`. The rejection surfaces as `BadRequestException` carrying `{ parentPathId }` so the frontend can redirect to the path enrollment flow.

### Lifecycle
`ACTIVE` on creation. This feature does not implement transitions.

---

## Entity: LessonProgress

**Table**: `lesson_progress` · **Prisma model**: `LessonProgress`

### Fields

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | PK |
| `userId` | UUID | no | FK → User |
| `lessonId` | UUID | no | FK → Lesson |
| `status` | `ProgressStatus` | no | defaults to `NOT_STARTED` |
| `completedAt` | DateTime | yes | set on `COMPLETED` |

**Uniqueness**: `@@unique([userId, lessonId])`.

### Transitions in this feature
- `completeLesson` upserts the row to `status = COMPLETED`, `completedAt = now()`.
- Idempotency: if the row already exists in `COMPLETED`, the method returns the current aggregate state without writing (Decision 3).

---

## Entity: SectionProgress / CourseProgress / PathProgress

All three follow the same shape: a `{completed, total, percentage, status}` tuple per `(userId, scopeId)` pair. See `src/content/marketing/…/data-model.md` for the KAN-72 parallel.

### Key fields

| Model | Unique | Counters | Percent derivation |
|---|---|---|---|
| `SectionProgress` | `(userId, sectionId)` | `completedLessons`, `totalLessons` | `completedLessons / totalLessons × 100` |
| `CourseProgress` | `(userId, courseId)` | `completedSections`, `totalSections` | `completedSections / totalSections × 100` |
| `PathProgress` | `(userId, pathId)` | `completedCourses`, `totalCourses` | average of this user's `CourseProgress.percentage` across the path's courses |

### Recalculation rules

- `recalculateSectionProgress(tx, userId, sectionId)`:
  1. `total = prisma.lesson.count({ where: { sectionId } })`
  2. `completed = prisma.lessonProgress.count({ where: { userId, lesson: { sectionId }, status: 'COMPLETED' } })`
  3. Upsert `SectionProgress` by `(userId, sectionId)`.
  4. `status = completed === total && total > 0 ? 'COMPLETED' : completed > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'`.
- `recalculateCourseProgress`: same pattern, counts sections whose `SectionProgress.status = 'COMPLETED'`.
- `recalculatePathProgress`: same pattern, counts courses whose `CourseProgress.status = 'COMPLETED'`; `percentage` is the average across courses in the path.

### Prefill on enrollment

- `enrollInPath` creates a zeroed `PathProgress` row and a zeroed `CourseProgress` row per course in the path (status `NOT_STARTED`, counters 0, percentage 0).
- `enrollInCourse` creates a zeroed `CourseProgress` row and a zeroed `SectionProgress` row per section of the course.

---

## Entity: LastPosition

**Table**: `last_positions` · **Prisma model**: `LastPosition`

### Fields

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | PK |
| `userId` | UUID | no | FK → User |
| `pathId` | UUID | yes | exclusive with `courseId` |
| `courseId` | UUID | yes | exclusive with `pathId` |
| `sectionId` | UUID | no | FK → Section |
| `lessonId` | UUID | no | FK → Lesson |
| `accessedAt` | DateTime | no | `@default(now())` |

### Constraints (from migration `20260414145648_v6_path_course_pages_alignment`, not `@@unique` in schema)

- `CHECK last_positions_exactly_one_scope` — exactly one of `pathId` / `courseId` is non-null.
- Partial unique index `last_positions_user_path_unique ON (userId, pathId) WHERE pathId IS NOT NULL`.
- Partial unique index `last_positions_user_course_unique ON (userId, courseId) WHERE courseId IS NOT NULL`.

### Write strategy (Decision 4)

Because Prisma is unaware of the partial unique indexes, `ProgressService.updateLastPosition` uses `findFirst → create | update`:

1. Determine scope: if the lesson's course has a parent path AND the user holds an ACTIVE `PathEnrollment` for that path (already guaranteed by `EnrollmentGuard` at the HTTP entry point; the service-level check is defensive), the scope is `PATH` (`pathId = parentPathId, courseId = null`); otherwise scope is `COURSE` (`pathId = null, courseId = course.id`).
2. `findFirst({ where: { userId, pathId, courseId } })` with the exact scope values (null or ID).
3. If found → `update` the `sectionId`/`lessonId`/`accessedAt`; if not → `create`.
4. The `exactly_one_scope` CHECK is respected by construction because we always write one field and null the other.

---

## Entity: Certificate

**Table**: `certificates` · **Prisma model**: `Certificate`

### Fields

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | PK |
| `userId` | UUID | no | FK → User |
| `pathId` | UUID | yes | set only for `type = PATH` |
| `courseId` | UUID | yes | set only for `type = COURSE` |
| `type` | `CertificateType` | no | `PATH` or `COURSE` |
| `certificateCode` | String | no | **unique** — the public verification token |
| `certificateUrl` | String | yes | PDF URL — out of scope for this ticket |
| `issuedAt` | DateTime | no | `@default(now())` |

### Uniqueness model

The ONLY declared unique is `certificateCode`. There is **no** composite unique on `(userId, courseId, type)` or `(userId, pathId, type)`. Per-subject idempotency is therefore enforced in the application layer:

- `checkCourseEligibility` runs a `findFirst({ where: { userId, courseId, type: 'COURSE' } })` BEFORE issuing. On hit, returns the existing cert.
- `checkPathEligibility` does the same with `pathId, type: 'PATH'`.

### Issuance procedure (private `issueCertificate` helper)

1. Generate a candidate code via `crypto.randomUUID().replace(/-/g, '').slice(0, 12)` (Decision 5).
2. Attempt `tx.certificate.create`.
3. On Prisma `P2002` (unique-constraint collision on `certificateCode`), retry up to 3 times total.
4. On the 4th failure, throw `InternalServerErrorException('Failed to generate unique certificate code')`.

### Verification response shape (per clarification Q2)

```
{
  valid: true,
  type: 'PATH' | 'COURSE',
  issuedAt: ISO string,
  holder: { fullName: User.name },
  subject: { type: 'PATH' | 'COURSE', title: string, slug: string },
}
```

Fields explicitly **not** in the response: `holder.email`, `holder.id`, `enrolledAt`, any progress percentages. Unknown code → `NotFoundException` (not a 200 with `valid: false`).

---

## Entity: QuizAttempt (read-only in this feature)

**Table**: `quiz_attempts` · **Prisma model**: `QuizAttempt`

This feature does NOT create or update `QuizAttempt` rows. The read use-case (course-cert eligibility's "all quizzes passed" check) is deferred with `TODO(KAN-quizzes)` per Decision 6, so even the read is stubbed to `return true` until the quiz subsystem ships.

Status values (for documentation): `IN_PROGRESS`, `PASSED`, `FAILED` (from `AttemptStatus`). When the helper is eventually replaced, a "passing attempt" is `status = 'PASSED'`.

---

## State machines

### Lesson completion flow (happy path for User Story 4)

```
LessonProgress:    NOT_STARTED ──completeLesson──▶ COMPLETED
                                                     │
                                                     ▼
SectionProgress:   NOT_STARTED ──recalculate──▶ IN_PROGRESS ──(last lesson)──▶ COMPLETED
                                                                                │
                                                                                ▼
CourseProgress:    NOT_STARTED ──recalculate──▶ IN_PROGRESS ──(last section)──▶ COMPLETED
                                                                                │
                                                                                ├──▶ Certificate (type=COURSE) issued
                                                                                │
                                                                                ▼
PathProgress:      NOT_STARTED ──recalculate──▶ IN_PROGRESS ──(last course)───▶ COMPLETED
                                                                                │
                                                                                └──▶ Certificate (type=PATH) issued
```

Re-completing an already-`COMPLETED` lesson short-circuits before any of these transitions fire (Decision 3).

### Enrollment access grant

```
No enrollment ──────── EnrollmentGuard.false ──▶ 403
PathEnrollment.PAUSED ── EnrollmentGuard.false ──▶ 403
PathEnrollment.COMPLETED ── EnrollmentGuard.false ──▶ 403
PathEnrollment.ACTIVE ── EnrollmentGuard.true ──▶ proceed
CourseEnrollment.DROPPED ── EnrollmentGuard.false ──▶ 403
CourseEnrollment.COMPLETED ── EnrollmentGuard.false ──▶ 403
CourseEnrollment.ACTIVE ── EnrollmentGuard.true ──▶ proceed
```

### Certificate issuance eligibility

```
Course-level:
  has enrollment (path or course, ACTIVE) ── AND
  every lesson in course has LessonProgress.COMPLETED for user ── AND
  [quiz check — currently stub-true per TODO(KAN-quizzes)]
    ──▶ issue Certificate(type=COURSE) if no existing one

Path-level:
  has PathEnrollment for path (status ACTIVE) ── AND
  every course in path has an existing Certificate(type=COURSE, userId, courseId)
    ──▶ issue Certificate(type=PATH) if no existing one
```

---

## Shared invariants

- **UUIDs** for all primary keys (enforced by schema).
- **DateTime** values are serialized as ISO 8601 strings in HTTP responses.
- **Arabic text** round-trips through all text columns and response DTOs.
- **Response shape** follows the constitutional `{ data, message }` envelope via the existing global response interceptor.
- **Transactional integrity**: every service method that writes more than one row runs inside `prisma.$transaction` (ticket §4.3, Constitution IV).
- **Sensitive fields** never appear in responses: `User.passwordHash`, `User.email` (in verification endpoint), raw enrollment timestamps on verification, `Option.isCorrect`, refresh token values.
