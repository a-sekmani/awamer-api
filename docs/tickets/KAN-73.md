# KAN-73 — Course Enrollment + dual-level Certificates

> **Jira:** [KAN-73](https://awamer.atlassian.net/browse/KAN-73)
> **Parent epic:** KAN-4 (E3: Public Discovery)
> **Depends on:** KAN-70 (Prisma schema v6 — done)
> **Blocks:** KAN-26 (Public discovery endpoints)
>
> **References:**
> - [Data Model v6 §Enrollment and §Certificates](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/28835841/Data+Model)
> - [API Design v2 §6 Enrollment and §13 Certificates](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/27754532/API+Design)
> - [User Flows v9 §9.6, §10.3, §10.5](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/27656193/User+Flows)

---

## 1. Goal

Data Model v6 introduced two new capabilities that must be delivered together because their code paths are tightly coupled:

1. **CourseEnrollment** for standalone courses (courses where `pathId = null`)
2. **Dual-level Certificates** — certificates can now be issued at the course level as well as the path level

This ticket delivers all the NestJS code needed to make these features work end to end: the enrollment module, the certificates module, the progress cascade, and the guards that enforce access. The Prisma models already exist (delivered by KAN-70). This ticket builds the service layer and the HTTP endpoints on top of them.

This ticket also consolidates work across what would otherwise be three separate tickets (`EnrollmentModule`, `CertificatesModule`, `ProgressModule`) because the change surface is inherently cross-cutting: completing a lesson triggers a progress recalculation, which triggers a certificate eligibility check, which may issue a certificate. Splitting this across tickets would create artificial boundaries that duplicate code and tests.

---

## 2. Audit requirement (MANDATORY first step)

Before writing any code, Claude Code MUST perform an audit of the existing state and report findings. The following files and modules may or may not exist in the current repository — this spec makes no assumption about their existence:

- `src/enrollment/` (module, service, controller)
- `src/progress/` (module, service)
- `src/certificates/` (module, service, controller)
- `src/quizzes/` (module, service)
- `src/common/guards/enrollment.guard.ts`
- `src/common/guards/access.guard.ts`

For each of these, the audit must report:

1. **Does it exist?** If yes, report the files and their current exports. If no, mark as "to be created".
2. **If it exists, what entities does it reference?** Check which Prisma models are imported. This tells us whether the existing code is based on the pre-v6 schema or already partially v6-aware.
3. **Does `QuizAttempt` exist as a Prisma model?** Check `prisma/schema.prisma`. If no, flag it — certificate eligibility depends on quizzes.
4. **Is there any existing certificate code?** If yes, does it assume path-only certificates? The v6 schema makes `Certificate.pathId` nullable and adds `courseId` + `type` — existing code may break.
5. **Is there any existing enrollment code?** If yes, does it handle only `PathEnrollment`? The v6 schema adds `CourseEnrollment`.

**After completing the audit, stop and report the findings. Do not start implementation until the human operator has reviewed the audit and confirmed.** If the audit reveals that significant existing code is based on the pre-v6 schema, the operator may decide to adjust scope.

---

## 3. Scope

### In scope

- `EnrollmentModule` — service, controller, guard. Handles both path enrollments and course enrollments.
- `ProgressModule` — service that owns the progress cascade. Consumes enrollment data, produces progress updates + certificate issuance.
- `CertificatesModule` — service, controller. Handles eligibility checks and certificate issuance for both path and course.
- `EnrollmentGuard` — resolves a lesson to its owning course, then validates the appropriate enrollment (path or course).
- `AccessGuard` — handles the `isFree` cascade for both path-attached and standalone courses.
- DTOs for enrollment and certificate endpoints.
- Unit tests for every service method.
- Integration (e2e) tests for the two critical flows described in §11.
- Service interface documentation for KAN-26 consumers.

### Out of scope

- `QuizzesService` and `QuizAttempt` implementation. If `QuizAttempt` exists as a Prisma model but has no service, this ticket uses raw Prisma queries against it. If `QuizAttempt` does not exist at all in the schema, this ticket treats quiz eligibility as "always passing" with a `TODO(KAN-quizzes)` marker.
- Path and Course admin endpoints (create / update / delete paths and courses).
- Public discovery endpoints (KAN-26 will consume the services this ticket exposes).
- Frontend code of any kind.
- Caching layer wiring (KAN-74).
- Email notifications when a certificate is issued.
- Certificate PDF generation or certificate codes beyond the existing schema field.
- Any modification to `prisma/schema.prisma` or existing migrations.
- Any modification to `src/auth`, `src/users`, `src/onboarding`, `src/common` (except `guards/enrollment.guard.ts` and `guards/access.guard.ts` — see §8).
- Any modification to `src/content/tags/` or `src/content/marketing/`.

---

## 4. Domain rules

### 4.1 Enrollment rules

**A user can enroll in a path.** This creates a `PathEnrollment` row and, as a side effect, creates an empty `CourseProgress` row for each course in the path, and a `PathProgress` row for the path itself. All progress rows start at 0%.

**A user can enroll in a standalone course.** A standalone course is a course where `pathId = null`. Enrolling creates a `CourseEnrollment` row and a `CourseProgress` row (and empty `SectionProgress` rows for each section). No `PathProgress` is created.

**A user CANNOT enroll directly in a course that belongs to a path.** Attempting `POST /enrollments/courses/:courseId` on a course where `pathId != null` must return `400 Bad Request` with the message `"Course 'xyz' belongs to a path. Enroll in the parent path instead."`. The response must include the parent path ID so the frontend can redirect.

**A user cannot enroll in the same path twice.** Attempting a duplicate `PathEnrollment` returns `409 Conflict`.

**A user cannot enroll in the same course twice.** Attempting a duplicate `CourseEnrollment` returns `409 Conflict`.

**A user can have both enrollment types simultaneously.** Same user can be enrolled in path A and also in standalone course B — they are independent.

### 4.2 Certificate rules

**Certificates are issued automatically when eligibility is met.** There is no manual "claim certificate" action. When a user completes the last required item (lesson or quiz) that makes them eligible, the certificate is issued by the progress cascade (see §4.3).

**A course-level certificate requires:**
- A `CourseEnrollment` OR a `PathEnrollment` for the parent path — either is sufficient
- Every lesson in every section of the course has `LessonProgress.status = COMPLETED` for this user
- Every quiz in the course has at least one `QuizAttempt` with `passed = true` for this user
- If `QuizAttempt` does not exist in the schema, the quiz requirement is skipped with a TODO marker

**A path-level certificate requires:**
- A `PathEnrollment` for this user and path
- Every course in the path has a valid course-level certificate for this user
- (Recursively — this means every lesson and every quiz in every course in the path has been completed)

**Certificates are idempotent.** `checkCourseEligibility` and `checkPathEligibility` can be called any number of times. They only issue a certificate if the user is eligible AND no existing certificate of the same type exists for the same (user, owner) pair. If a certificate already exists, the method is a no-op and returns the existing certificate.

**Certificates have a unique code.** `Certificate.certificateCode` is a randomly-generated, URL-safe string. The generation strategy: `nanoid(12)` — if `nanoid` is not installed, use `crypto.randomUUID()` and take the first 12 characters of its hex representation. Collisions are rejected by the existing unique constraint on the column; retry up to 3 times on collision before throwing.

**Certificate code format:** The code is stored as-is in the database. The public verification endpoint uses this code as the URL parameter.

### 4.3 Progress cascade rules

When `ProgressService.completeLesson(userId, lessonId)` is called, the following sequence runs inside a single Prisma transaction:

1. Upsert `LessonProgress` for (userId, lessonId) with status `COMPLETED` and `completedAt = now()`
2. Recalculate `SectionProgress` for the section containing the lesson:
   - `percentComplete` = (completed lessons in section / total lessons in section) × 100
   - `status` = `COMPLETED` if percent is 100, else `IN_PROGRESS`
3. Recalculate `CourseProgress` for the course containing the section:
   - `percentComplete` = (completed lessons in course / total lessons in course) × 100
   - `status` = `COMPLETED` if percent is 100, else `IN_PROGRESS`
4. **If the course has a parent path** (`course.pathId != null`), recalculate `PathProgress` for that path:
   - `percentComplete` = average of `CourseProgress.percentComplete` for all courses in the path
   - `status` = `COMPLETED` if every course in the path has `CourseProgress.status = COMPLETED`, else `IN_PROGRESS`
5. Update `LastPosition`:
   - If the user is enrolled via `PathEnrollment` for the parent path, set `LastPosition.pathId = parentPathId`
   - Otherwise, set `LastPosition.courseId = course.id`
   - `sectionId` and `lessonId` always point to the lesson just completed
6. Call `CertificatesService.checkCourseEligibility(userId, courseId)` — this may issue a course certificate
7. **If the course has a parent path**, call `CertificatesService.checkPathEligibility(userId, course.pathId)` — this may issue a path certificate
8. Return the updated progress records and any newly-issued certificates:

```typescript
{
  lessonProgress: LessonProgress,
  sectionProgress: SectionProgress,
  courseProgress: CourseProgress,
  pathProgress: PathProgress | null,
  certificatesIssued: Certificate[],
}
```

The entire cascade is transactional — if any step fails, nothing is committed.

**Idempotency:** Calling `completeLesson` on an already-completed lesson is a no-op that returns the current state (does not throw, does not double-issue certificates, does not update `completedAt`).

### 4.4 Quiz submission cascade rules

When `QuizzesService.submitAttempt(userId, quizId, answers)` is called (assuming the service exists — see §2 audit):

1. Record the `QuizAttempt` with the pass/fail result
2. If the attempt passes, call `CertificatesService.checkCourseEligibility` for the course containing the quiz
3. If the course has a parent path, also call `checkPathEligibility`
4. Return the attempt + any newly-issued certificates

**If `QuizzesService` does not exist:** this ticket does NOT create it. Add a TODO marker in the progress cascade documentation noting that quiz-related certificate issuance is pending a future ticket.

---

## 5. Endpoints

All endpoints are under the `/api/v1` prefix. Learner endpoints require `JwtAuthGuard`. Admin endpoints (if any — this ticket has none) would require `RolesGuard` + `@Roles('admin')`.

### 5.1 POST /enrollments/courses/:courseId — Enroll in a standalone course

**Auth:** Authenticated user.

**Path parameter:** `courseId` — UUID of the course.

**Request body:** empty.

**Response 201:**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "courseId": "uuid",
  "status": "ACTIVE",
  "enrolledAt": "2026-04-14T12:00:00.000Z"
}
```

**Error 400** (course belongs to a path):
```json
{
  "statusCode": 400,
  "message": "Course 'xyz' belongs to a path. Enroll in the parent path instead.",
  "parentPathId": "uuid",
  "error": "Bad Request"
}
```

**Error 404** (course does not exist): standard NestJS `NotFoundException`.

**Error 409** (already enrolled): standard NestJS `ConflictException` with message `"Already enrolled in course 'xyz'"`.

**Side effects (in one transaction):**
- Create `CourseEnrollment` with `status = ACTIVE`
- Create `CourseProgress` for (userId, courseId) with `percentComplete = 0` and `status = NOT_STARTED`
- Create empty `SectionProgress` rows for every section in the course with `percentComplete = 0` and `status = NOT_STARTED`
- Do NOT create `PathProgress` — the course is standalone

### 5.2 GET /enrollments/me — List all enrollments for the current user

**Auth:** Authenticated user.

**Response 200:**
```json
{
  "paths": [
    {
      "id": "uuid",
      "pathId": "uuid",
      "status": "ACTIVE",
      "enrolledAt": "...",
      "path": {
        "id": "uuid",
        "title": "Arabic title",
        "slug": "ai-development",
        "thumbnail": "https://..."
      },
      "progress": {
        "percentComplete": 45,
        "status": "IN_PROGRESS"
      }
    }
  ],
  "courses": [
    {
      "id": "uuid",
      "courseId": "uuid",
      "status": "ACTIVE",
      "enrolledAt": "...",
      "course": {
        "id": "uuid",
        "title": "...",
        "slug": "git-basics",
        "thumbnail": "https://..."
      },
      "progress": {
        "percentComplete": 80,
        "status": "IN_PROGRESS"
      }
    }
  ]
}
```

Only courses with `pathId = null` appear under `courses`. Courses that belong to a path appear under their parent path, not here.

Sort: most recently enrolled first, within each array.

### 5.3 GET /enrollments/me/courses/:courseId — Course enrollment detail

**Auth:** Authenticated user.

**Path parameter:** `courseId` — UUID.

**Response 200:**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "courseId": "uuid",
  "status": "ACTIVE",
  "enrolledAt": "...",
  "progress": {
    "percentComplete": 80,
    "status": "IN_PROGRESS"
  },
  "lastPosition": {
    "sectionId": "uuid",
    "lessonId": "uuid",
    "updatedAt": "..."
  } | null
}
```

**Error 404:** either the course does not exist OR the user is not enrolled in it. Do NOT differentiate the two cases (prevents information leakage about course existence).

### 5.4 GET /certificates/me — List user's certificates

**Auth:** Authenticated user.

**Response 200:**
```json
{
  "certificates": [
    {
      "id": "uuid",
      "type": "PATH",
      "pathId": "uuid",
      "courseId": null,
      "certificateCode": "abc123xyz",
      "issuedAt": "...",
      "path": {
        "id": "uuid",
        "title": "Arabic title",
        "slug": "ai-development"
      }
    },
    {
      "id": "uuid",
      "type": "COURSE",
      "pathId": null,
      "courseId": "uuid",
      "certificateCode": "def456uvw",
      "issuedAt": "...",
      "course": {
        "id": "uuid",
        "title": "...",
        "slug": "git-basics"
      }
    }
  ]
}
```

Sort: most recently issued first.

### 5.5 GET /certificates/verify/:code — Public certificate verification

**Auth:** NONE — this endpoint is public so employers and third parties can verify certificates without authentication.

**Path parameter:** `code` — the certificate's `certificateCode`.

**Response 200:**
```json
{
  "valid": true,
  "type": "COURSE",
  "issuedAt": "...",
  "holder": {
    "firstName": "Ahmed",
    "lastName": "Al-Khaledi"
  },
  "subject": {
    "type": "COURSE",
    "title": "Git Basics",
    "slug": "git-basics"
  }
}
```

For `type = PATH`, `subject.type` is `"PATH"` and `subject.title`/`subject.slug` come from the path.

**Response 404** if the code does not exist. Do not return 200 with `valid: false` — the 404 is simpler and prevents probing.

Do NOT include the user's email, the exact enrollment date, or any progress information in the public response. Only what a third party needs to verify authenticity.

---

## 6. Services

### 6.1 EnrollmentService

Located at `src/enrollment/enrollment.service.ts`.

**Methods:**

```typescript
enrollInPath(userId: string, pathId: string): Promise<PathEnrollment>
```
- Creates `PathEnrollment`, `PathProgress`, and `CourseProgress` rows for every course in the path
- Throws `NotFoundException` if the path does not exist
- Throws `ConflictException` if already enrolled
- All inserts in a single transaction

```typescript
enrollInCourse(userId: string, courseId: string): Promise<CourseEnrollment>
```
- Validates `course.pathId === null`; throws `BadRequestException` with the parent path ID in the response if not
- Creates `CourseEnrollment`, `CourseProgress`, and `SectionProgress` rows for every section in the course
- Throws `NotFoundException` if the course does not exist
- Throws `ConflictException` if already enrolled
- All inserts in a single transaction

```typescript
getPathEnrollment(userId: string, pathId: string): Promise<PathEnrollment | null>
```
- Returns the enrollment with includes for path + progress, or `null` if not enrolled
- Does NOT throw

```typescript
getCourseEnrollment(userId: string, courseId: string): Promise<CourseEnrollment | null>
```
- Returns the enrollment with includes for course + progress + last position, or `null` if not enrolled
- Does NOT throw

```typescript
listAllForUser(userId: string): Promise<{ paths: PathEnrollmentSummary[], courses: CourseEnrollmentSummary[] }>
```
- Returns both enrollment types in one call
- Includes progress summary for each
- Sorted by `enrolledAt DESC`

```typescript
hasAccessToCourse(userId: string, courseId: string): Promise<boolean>
```
- Used by `EnrollmentGuard`. Returns `true` if the user has either:
  - A `CourseEnrollment` for this course, OR
  - A `PathEnrollment` for the parent path (if the course has one)
- Used internally by the guard, not exposed as an endpoint

### 6.2 ProgressService

Located at `src/progress/progress.service.ts`.

**Methods:**

```typescript
completeLesson(userId: string, lessonId: string): Promise<CompleteLessonResult>
```
Where `CompleteLessonResult` is:
```typescript
{
  lessonProgress: LessonProgress;
  sectionProgress: SectionProgress;
  courseProgress: CourseProgress;
  pathProgress: PathProgress | null;
  certificatesIssued: Certificate[];
}
```

Implements the full cascade described in §4.3. The entire method runs inside `prisma.$transaction(async (tx) => { ... })`.

**Note on EnrollmentGuard integration:** this method does NOT re-check enrollment — the guard already did that at the HTTP layer. If called directly from tests without the guard, it assumes the caller has verified access.

```typescript
recalculateSectionProgress(tx, userId, sectionId): Promise<SectionProgress>
recalculateCourseProgress(tx, userId, courseId): Promise<CourseProgress>
recalculatePathProgress(tx, userId, pathId): Promise<PathProgress>
```
- Internal helpers
- Each queries the relevant "total" and "completed" counts and upserts the progress row
- All take the transaction client as the first parameter

```typescript
updateLastPosition(tx, userId, lesson): Promise<LastPosition>
```
- Decides whether to set `pathId` or `courseId` based on whether the user has a `PathEnrollment` for the course's parent path
- If the course has no parent path (standalone), always sets `courseId`
- If the course has a parent path AND the user has a `PathEnrollment` for it, sets `pathId`
- If the course has a parent path AND the user does NOT have a `PathEnrollment` (enrolled via CourseEnrollment instead — which is impossible for path-attached courses, but defensive code), sets `courseId`

### 6.3 CertificatesService

Located at `src/certificates/certificates.service.ts`.

**Methods:**

```typescript
checkCourseEligibility(tx, userId: string, courseId: string): Promise<Certificate | null>
```
- Returns the existing certificate if one already exists for (userId, courseId, type=COURSE)
- Otherwise checks:
  - All lessons in the course have `LessonProgress.status = COMPLETED` for this user
  - All quizzes in the course have at least one passing `QuizAttempt` for this user — SKIP this check if `QuizAttempt` does not exist in the schema, with a `TODO(KAN-quizzes)` log
- If eligible, issues a new certificate with `type = COURSE`, `courseId = courseId`, `pathId = null`
- Returns the new certificate
- Returns `null` if not yet eligible (not an error — the user just hasn't finished yet)
- Takes the Prisma transaction client as the first parameter (so callers can run it inside a larger transaction)

```typescript
checkPathEligibility(tx, userId: string, pathId: string): Promise<Certificate | null>
```
- Returns the existing certificate if one already exists for (userId, pathId, type=PATH)
- Otherwise checks: every course in the path has a valid course-level certificate for this user
- If eligible, issues a new certificate with `type = PATH`, `pathId = pathId`, `courseId = null`
- Returns the new certificate or `null`

```typescript
issueCertificate(tx, data: IssueCertificateData): Promise<Certificate>
```
- Private helper
- Generates a unique certificate code (see §4.2)
- Inserts the row
- Retries up to 3 times on unique-constraint collision before throwing

```typescript
listForUser(userId: string): Promise<Certificate[]>
```
- Returns all certificates for the user, sorted by `issuedAt DESC`
- Includes `path` relation for PATH certs and `course` relation for COURSE certs

```typescript
verifyByCode(code: string): Promise<CertificateVerification>
```
- Public verification — used by the `/certificates/verify/:code` endpoint
- Throws `NotFoundException` if code not found
- Returns the minimal verification shape described in §5.5
- Does NOT include sensitive fields (email, enrollment date, progress)

---

## 7. Controllers

### 7.1 EnrollmentController

Located at `src/enrollment/enrollment.controller.ts`.

**Class-level guards:** `@UseGuards(JwtAuthGuard)`.

Endpoints:
- `POST /enrollments/courses/:courseId` → `enrollmentService.enrollInCourse(req.user.id, courseId)`
- `GET /enrollments/me` → `enrollmentService.listAllForUser(req.user.id)`
- `GET /enrollments/me/courses/:courseId` → `enrollmentService.getCourseEnrollment(req.user.id, courseId)`; if `null`, throws `NotFoundException`

`POST /enrollments/paths/:pathId` (enrolling in a path) should also exist for completeness. If it already exists in some form, DO NOT modify it — just make sure the new `enrollInPath` method is compatible. If it does not exist, add it:
- `POST /enrollments/paths/:pathId` → `enrollmentService.enrollInPath(req.user.id, pathId)`

### 7.2 CertificatesController

Located at `src/certificates/certificates.controller.ts`.

**Class-level guards:** none at the class level — each endpoint decides its own auth requirements.

Endpoints:
- `GET /certificates/me` → `@UseGuards(JwtAuthGuard)` → `certificatesService.listForUser(req.user.id)`
- `GET /certificates/verify/:code` → `@Public()` (no auth) → `certificatesService.verifyByCode(code)`

---

## 8. Guards

### 8.1 EnrollmentGuard

Located at `src/common/guards/enrollment.guard.ts`.

**Purpose:** Protect learning endpoints (like `POST /learning/lessons/:id/complete`) so that only users enrolled in the content can access them.

**Algorithm:**

```
1. Extract lessonId (or courseId) from the request params
2. Fetch: lesson → section → course (include course.pathId)
3. If course.pathId is null (standalone course):
     - require CourseEnrollment for (userId, course.id)
     - return true if found, throw ForbiddenException otherwise
4. Else (course belongs to a path):
     - require PathEnrollment for (userId, course.pathId)
     - return true if found, throw ForbiddenException otherwise
```

**Delegates the check to `EnrollmentService.hasAccessToCourse(userId, courseId)`** — the guard is thin; the business logic lives in the service.

**If the guard already exists in the codebase:** extend it to handle both enrollment types. Preserve the existing interface as much as possible. Document any breaking changes in the PR.

**If the guard does NOT exist:** create it fresh, following the standard NestJS guard pattern matching `AuthModule` conventions.

### 8.2 AccessGuard

Located at `src/common/guards/access.guard.ts`.

**Purpose:** Enforces the `isFree` cascade and subscription checks for content access.

**Algorithm:**

```
1. Fetch lesson → section → course → (optional path)
2. If lesson.isFree is true, allow
3. If course.isFree is true, allow
4. If course.pathId is set AND path.isFree is true, allow
5. Otherwise, check that the user has an active Subscription
6. If no active subscription, throw ForbiddenException
```

**Rule for this ticket:** step 4 is conditional on `course.pathId` being set. For standalone courses (`pathId = null`), skip step 4 entirely.

**If the guard already exists:** adjust the cascade to handle standalone courses. Preserve the existing interface.

**If the guard does NOT exist:** create a minimal implementation that follows the algorithm above. The `Subscription` check may need its own service — if `SubscriptionsService` does not exist, stub the check with `TODO(subscriptions)` and return `true` for the subscription branch (allow access). This keeps the access layer functional even though the subscription enforcement is incomplete.

### 8.3 Guard interaction

`EnrollmentGuard` runs BEFORE `AccessGuard` in the guard chain. The logic is:
1. EnrollmentGuard checks: "is the user enrolled at all?"
2. AccessGuard checks: "is the user allowed to see this specific lesson based on paywall rules?"

Both must pass for a learning endpoint to respond. Apply them together via `@UseGuards(JwtAuthGuard, EnrollmentGuard, AccessGuard)`.

---

## 9. DTOs

Located at `src/enrollment/dto/` and `src/certificates/dto/`.

### 9.1 Enrollment DTOs

**`EnrollmentResponseDto`** — base shape used by both path and course responses:
```typescript
{
  id: string;
  userId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'DROPPED' | 'PAUSED';
  enrolledAt: string;
}
```

**`PathEnrollmentResponseDto`** — extends with `pathId`, nested `path` summary, nested `progress` summary.

**`CourseEnrollmentResponseDto`** — extends with `courseId`, nested `course` summary, nested `progress` summary.

**`EnrollmentListResponseDto`** — `{ paths: PathEnrollmentResponseDto[], courses: CourseEnrollmentResponseDto[] }`.

**`CourseEnrollmentDetailResponseDto`** — extends `CourseEnrollmentResponseDto` with `lastPosition`.

### 9.2 Certificate DTOs

**`CertificateResponseDto`** (for `/certificates/me`):
```typescript
{
  id: string;
  type: 'PATH' | 'COURSE';
  pathId: string | null;
  courseId: string | null;
  certificateCode: string;
  issuedAt: string;
  path: { id, title, slug } | null;
  course: { id, title, slug } | null;
}
```

**`CertificateVerificationDto`** (for `/certificates/verify/:code`):
```typescript
{
  valid: true;
  type: 'PATH' | 'COURSE';
  issuedAt: string;
  holder: { firstName: string; lastName: string };
  subject: { type: 'PATH' | 'COURSE'; title: string; slug: string };
}
```

No request DTOs for these endpoints (they are all GETs or empty POSTs).

All response DTOs should be actual TypeScript classes (not plain types), because they serve as documentation for the shape of the API response. Use `class-transformer` `@Expose()` and `@Exclude()` to ensure sensitive fields never leak.

---

## 10. Module structure

New files created (assuming none of the modules exist yet — adjust based on audit):

```
src/enrollment/
├── enrollment.module.ts
├── enrollment.service.ts
├── enrollment.controller.ts
├── dto/
│   ├── enrollment-response.dto.ts
│   ├── path-enrollment-response.dto.ts
│   ├── course-enrollment-response.dto.ts
│   ├── enrollment-list-response.dto.ts
│   └── course-enrollment-detail-response.dto.ts
└── __tests__/
    └── enrollment.service.spec.ts

src/progress/
├── progress.module.ts
├── progress.service.ts
└── __tests__/
    └── progress.service.spec.ts

src/certificates/
├── certificates.module.ts
├── certificates.service.ts
├── certificates.controller.ts
├── dto/
│   ├── certificate-response.dto.ts
│   └── certificate-verification.dto.ts
└── __tests__/
    └── certificates.service.spec.ts

src/common/guards/
├── enrollment.guard.ts
└── access.guard.ts

test/enrollment/
├── enrollment.controller.e2e-spec.ts
└── progress-cascade.e2e-spec.ts

test/certificates/
└── certificates.controller.e2e-spec.ts
```

**Module registration in AppModule:**
- Register `EnrollmentModule`, `ProgressModule`, `CertificatesModule`
- These three modules depend on each other in a specific order: `EnrollmentModule` is standalone; `ProgressModule` imports `EnrollmentModule` (to check enrollment during cascade) and `CertificatesModule` (to issue certificates); `CertificatesModule` is standalone but is imported by `ProgressModule`

**Circular dependency risk:** `ProgressModule` → `CertificatesModule` is one-directional. If NestJS flags a circular dependency, use `forwardRef()`.

---

## 11. Tests

### 11.1 Unit tests — `enrollment.service.spec.ts`

Against mocked `PrismaService`:

- `enrollInPath` creates PathEnrollment + PathProgress + CourseProgress for every course in the path
- `enrollInPath` rejects duplicate enrollment with ConflictException
- `enrollInPath` throws NotFoundException for nonexistent path
- `enrollInPath` runs all inserts in a single transaction (verifiable via mock)
- `enrollInCourse` creates CourseEnrollment + CourseProgress + SectionProgress
- `enrollInCourse` rejects courses with a parent path with BadRequestException (message includes parent path ID)
- `enrollInCourse` rejects duplicate enrollment with ConflictException
- `enrollInCourse` throws NotFoundException for nonexistent course
- `getPathEnrollment` returns null instead of throwing when not enrolled
- `getCourseEnrollment` returns null instead of throwing when not enrolled
- `listAllForUser` returns both arrays, sorted by enrolledAt DESC
- `hasAccessToCourse` returns true for course with valid CourseEnrollment
- `hasAccessToCourse` returns true for path-attached course with valid PathEnrollment
- `hasAccessToCourse` returns false when neither enrollment exists
- `hasAccessToCourse` returns false when enrollment exists but status is not ACTIVE

### 11.2 Unit tests — `progress.service.spec.ts`

Against mocked `PrismaService`:

- `completeLesson` upserts LessonProgress with COMPLETED
- `completeLesson` recalculates SectionProgress correctly (completed / total)
- `completeLesson` recalculates CourseProgress correctly
- `completeLesson` recalculates PathProgress only when course has parent path
- `completeLesson` skips PathProgress for standalone courses
- `completeLesson` updates LastPosition with pathId for path-attached courses
- `completeLesson` updates LastPosition with courseId for standalone courses
- `completeLesson` calls checkCourseEligibility and includes result in certificatesIssued
- `completeLesson` calls checkPathEligibility only when course has parent path
- `completeLesson` returns cert array empty when nothing newly issued
- `completeLesson` on already-completed lesson is idempotent (no-op, no new certs)
- `completeLesson` runs everything in one transaction (verifiable via mock)
- Error handling: if any step fails, the transaction is rolled back (verifiable)

### 11.3 Unit tests — `certificates.service.spec.ts`

Against mocked `PrismaService`:

- `checkCourseEligibility` returns existing cert if one already exists
- `checkCourseEligibility` returns null if not all lessons completed
- `checkCourseEligibility` returns null if not all quizzes passed (when QuizAttempt exists)
- `checkCourseEligibility` issues a new cert when all lessons and quizzes done
- `checkCourseEligibility` issues a cert with type=COURSE, courseId set, pathId null
- `checkPathEligibility` returns existing cert if one already exists
- `checkPathEligibility` returns null if any course in path has no course-level cert
- `checkPathEligibility` issues a new cert when all courses have certs
- `checkPathEligibility` issues a cert with type=PATH, pathId set, courseId null
- `issueCertificate` generates a unique code
- `issueCertificate` retries on unique-constraint collision (max 3 retries)
- `issueCertificate` throws after 3 collisions in a row
- `listForUser` sorts by issuedAt DESC
- `listForUser` includes path relation for PATH certs and course relation for COURSE certs
- `verifyByCode` throws NotFoundException for unknown code
- `verifyByCode` returns minimal shape (no sensitive fields)

### 11.4 Unit tests — `enrollment.guard.spec.ts` and `access.guard.spec.ts`

If the guards are being created fresh (not extended), add unit tests that:
- `EnrollmentGuard` allows access when `hasAccessToCourse` returns true
- `EnrollmentGuard` throws ForbiddenException when `hasAccessToCourse` returns false
- `AccessGuard` allows access for free lesson regardless of subscription
- `AccessGuard` allows access for free course regardless of subscription
- `AccessGuard` allows access for free path-attached course when path is free
- `AccessGuard` skips the "path is free" check for standalone courses
- `AccessGuard` requires active subscription for paid content

### 11.5 E2E tests

#### `enrollment.controller.e2e-spec.ts`

Against the real `awamer_test` database, reusing the test harness from `test/content/test-app.ts`:

- `POST /enrollments/courses/:courseId` enrolls successfully for a standalone course
- `POST /enrollments/courses/:courseId` returns 400 with parent path ID for path-attached course
- `POST /enrollments/courses/:courseId` returns 404 for nonexistent course
- `POST /enrollments/courses/:courseId` returns 409 on duplicate
- `POST /enrollments/courses/:courseId` creates CourseEnrollment + CourseProgress + SectionProgress rows (verify via direct Prisma query)
- `POST /enrollments/courses/:courseId` returns 401 unauthenticated
- `GET /enrollments/me` returns both paths and courses after seeding both types
- `GET /enrollments/me` returns empty arrays when user has no enrollments
- `GET /enrollments/me/courses/:courseId` returns the enrollment detail
- `GET /enrollments/me/courses/:courseId` returns 404 for nonexistent course
- `GET /enrollments/me/courses/:courseId` returns 404 when user is not enrolled

#### `progress-cascade.e2e-spec.ts` — THE CRITICAL TEST

This is the single most important test file in this ticket. It exercises the full cascade against a real database.

**Scenario 1: "Standalone course happy path"**

1. Seed: one standalone course with 2 sections, 3 lessons each (6 lessons total), 0 quizzes
2. Create a test user and enroll them via `enrollInCourse`
3. Call `completeLesson` on each of the 6 lessons one by one
4. After lesson 1: CourseProgress at 16%, no cert
5. After lesson 5: CourseProgress at 83%, no cert
6. After lesson 6: CourseProgress at 100%, **one course-level certificate issued**
7. Calling `completeLesson` on lesson 6 again: idempotent, no new cert
8. Verify `Certificate.type = COURSE`, `courseId` set, `pathId = null`

**Scenario 2: "Path happy path with auto-issued certificates"**

1. Seed: one path with 2 courses, each with 1 section and 2 lessons (4 lessons total)
2. Create a test user and enroll them via `enrollInPath`
3. Complete all 4 lessons one by one
4. After completing the last lesson of course 1: **one course certificate issued for course 1**
5. After completing the first lesson of course 2: still only one cert (course 1)
6. After completing the last lesson of course 2: **course certificate for course 2 issued** + **path certificate issued**
7. Final state: 3 certificates total (1 path + 2 course)
8. Verify `PathProgress = 100%`, both `CourseProgress = 100%`

**Scenario 3: "Idempotency"**

1. Seed a course with 2 lessons
2. Enroll a user
3. Complete both lessons (issues a course cert)
4. Call `completeLesson` on both lessons again
5. Verify: exactly 1 certificate in the database, no errors thrown

**Scenario 4: "LastPosition routing"**

1. Seed a path with a course, and a standalone course
2. Enroll the same user in the path AND in the standalone course
3. Complete a lesson in the path's course → `LastPosition.pathId` is set
4. Complete a lesson in the standalone course → `LastPosition.courseId` is set
5. Verify both LastPosition rows exist and point to the right scope

#### `certificates.controller.e2e-spec.ts`

- `GET /certificates/me` returns all user certs with correct `type` field
- `GET /certificates/me` returns empty array when user has no certs
- `GET /certificates/me` returns 401 unauthenticated
- `GET /certificates/verify/:code` returns valid cert details without auth
- `GET /certificates/verify/:code` returns 404 for unknown code
- `GET /certificates/verify/:code` does NOT include email or enrollment date
- Certificate codes are URL-safe (can be used directly in URLs without encoding)

### 11.6 Test infrastructure

- Reuses `awamer_test` database from KAN-70
- Reuses `test/content/test-app.ts` bootstrap helper from KAN-71 (signed JWT)
- If additional test fixtures are needed beyond what the seed provides, add them inside the test file itself (do not modify `prisma/seed.ts`)
- Each test file truncates relevant tables in `beforeEach` for isolation

Add a new npm script: `test:learning:e2e` that runs tests under `test/enrollment/` and `test/certificates/`. Or extend the existing `test:content:e2e` to cover these folders too — use the simpler option.

---

## 12. Definition of Done

The ticket is not closed until all of the following are true:

1. `npm run build` succeeds with zero TypeScript errors
2. `npx prisma validate` still passes (schema is unchanged)
3. `npm run test:schema` is still green (KAN-70's tests untouched)
4. `npm run test:content:e2e` is still green (KAN-71 and KAN-72 tests untouched)
5. `npm test` runs every test in the project — all green
6. All unit tests in §11.1 – §11.4 pass
7. All e2e tests in §11.5 pass
8. Scenario 1 (standalone course) and Scenario 2 (path with auto-issued certs) from §11.5 both pass end-to-end against a real Postgres
9. `git diff prisma/schema.prisma` is empty
10. `git diff prisma/migrations/` is empty
11. `git diff src/auth src/users src/onboarding src/content/tags src/content/marketing` is empty
12. `EnrollmentModule`, `ProgressModule`, `CertificatesModule` are registered in `AppModule`
13. `EnrollmentGuard` and `AccessGuard` are wired correctly — a protected endpoint (e.g. `POST /learning/lessons/:id/complete`) rejects requests from non-enrolled users
14. README has a short note added describing the new modules and their exported services
15. No new npm dependencies added (unless explicitly justified in the PR)

---

## 13. Known ambiguities and how to resolve them

### 13.1 QuizAttempt model may not exist

If the audit in §2 reveals that `QuizAttempt` is not in the Prisma schema:
- `checkCourseEligibility` skips the quiz check entirely
- Log a `TODO(KAN-quizzes)` marker at the quiz check site
- Document this decision in the PR description
- Do NOT create `QuizAttempt` — that is a separate ticket

### 13.2 Existing ProgressService / CertificatesService / EnrollmentService

If any of these services already exist with partial functionality:
- Do NOT throw them away
- Extend them to match the contract in §6
- Preserve existing method signatures where possible, add new methods alongside
- If the existing code assumes pre-v6 schema (path-only certificates, path-only enrollments), the extension must migrate it to the v6 model. This may involve non-trivial refactoring.
- Document every pre-existing method that was modified in the PR description

### 13.3 Subscription check in AccessGuard

If `SubscriptionsService` does not exist:
- Stub the subscription check to return `true` (allow access)
- Add `TODO(subscriptions)` marker
- Document the decision in the PR description

### 13.4 Guard creation vs extension

If `EnrollmentGuard` and/or `AccessGuard` do not exist in `src/common/guards/`:
- Create them fresh
- Follow the pattern established by `JwtAuthGuard` (also in `src/common/guards/` or `src/auth/guards/`)
- Apply to `src/common/guards/` specifically (not under a feature module)

If they exist but only handle the pre-v6 model:
- Extend in place
- Keep backward compatibility where possible
- If backward compatibility is impossible, call it out in the PR description

### 13.5 Circular dependency between ProgressModule and CertificatesModule

If NestJS flags a circular dependency:
- Use `forwardRef()` in the module definitions
- This is a known pattern and should be resolved within the ticket, not deferred

### 13.6 Any other ambiguity

If the file leaves something genuinely underspecified, prefer:
1. Whatever pattern is already used in `src/content/tags/` and `src/content/marketing/` (KAN-71 and KAN-72)
2. NestJS conventions from `src/auth` and `src/onboarding`
3. Data Model v6 on Confluence

If ambiguity remains after consulting those, STOP and ask the human operator. Do not guess.

---

## 14. Out of scope — not to be touched

- `prisma/schema.prisma` — frozen since KAN-70
- Any file under `prisma/migrations/`
- `src/auth`, `src/users`, `src/onboarding`
- `src/content/tags/` — frozen since KAN-71
- `src/content/marketing/` — frozen since KAN-72
- `src/common/guards/roles.guard.ts` — the stub from KAN-71 remains untouched (this ticket adds new guards, does not modify existing ones)
- The existing `prisma/seed.ts`
- `package.json` dependencies — no new deps unless absolutely necessary and explicitly justified in the PR
- CI/CD configuration files

---

## 15. Rules for resolving ambiguity

See §13 above for a comprehensive list of specific ambiguities. The general rule:

1. If the spec addresses the question, follow the spec literally
2. If the spec is silent, prefer patterns already established in `src/content/tags/` and `src/content/marketing/`
3. If those don't cover it, fall back to `src/auth` and `src/onboarding` conventions
4. For data shape questions, consult the Confluence references at the top of this file
5. If ambiguity remains after all the above, STOP and ask — do not guess

The audit in §2 is the primary mechanism for surfacing ambiguity before any code is written. Use it.
