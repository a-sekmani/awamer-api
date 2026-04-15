# ProgressService — Backend Reference (awamer-api)

> **Class:** `ProgressService`
> **Source:** `src/progress/progress.service.ts`
> **Module:** `ProgressModule`
> **Note:** ProgressService has **no HTTP surface**. It is a
> helper consumed by `LearningController`. There are no
> `/api/v1/progress/*` routes in the current codebase.

This class owns the lesson-completion cascade. It is imported by
`LearningController` (see [../learning/complete-lesson.md](../learning/complete-lesson.md))
to drive every progress recalculation and every certificate
eligibility check.

The step-by-step flow is documented in
[../learning/progress-cascade.md](../learning/progress-cascade.md).
This document is the class-level reference.

---

## 1. Public API

```ts
class ProgressService {
  async completeLesson(userId: string, lessonId: string): Promise<CompleteLessonResult>

  // transactional helpers (exported for testing + reuse)
  async recalculateSectionProgress(tx, userId, sectionId): Promise<SectionProgress>
  async recalculateCourseProgress(tx, userId, courseId): Promise<CourseProgress>
  async recalculatePathProgress(tx, userId, pathId): Promise<PathProgress>
  async updateLastPosition(tx, userId, lesson): Promise<LastPosition>
}
```

The three recalculate helpers are public (not private) so tests and
future features can invoke them directly inside their own
transactions without going through `completeLesson`.

---

## 2. `CompleteLessonResult`

```ts
export type CompleteLessonResult = {
  lessonProgress: LessonProgress;
  sectionProgress: SectionProgress;
  courseProgress: CourseProgress;
  pathProgress: PathProgress | null;
  certificatesIssued: Certificate[];
};
```

Raw Prisma entities, not DTOs. Date fields become ISO strings at
serialization time via the global class-serializer. The comment
on the service class calls this out explicitly (U2 resolution):

> Serialization note (U2 resolution): `CompleteLessonResult` returns
> RAW Prisma entities. Date fields become ISO strings via the
> global `ClassSerializerInterceptor`. No response DTOs are created
> for the progress rows; `CompleteLessonResult` is the only typed
> contract for this shape.

---

## 3. Dependencies

```ts
constructor(
  private readonly prisma: PrismaService,
  @Inject(forwardRef(() => CertificatesService))
  private readonly certificates: CertificatesService,
) {}
```

The `forwardRef` is because `ProgressService` and
`CertificatesService` import each other: `ProgressService` calls
`CertificatesService.checkCourseEligibility` / `checkPathEligibility`
inside the cascade, and `CertificatesService` is conceptually a
part of the progress domain. The circular import is resolved at
Nest's module-resolution time via the `forwardRef`.

---

## 4. Related documents

| Topic | File |
|-------|------|
| The full cascade step-by-step | [../learning/progress-cascade.md](../learning/progress-cascade.md) |
| The HTTP entry point and guards | [../learning/complete-lesson.md](../learning/complete-lesson.md) |
| Certificate eligibility + issuance | [../certificates/dual-level-issuance.md](../certificates/dual-level-issuance.md) |
| Schema shapes | [../schema/course-enrollment.md](../schema/course-enrollment.md), [../schema/certificate-polymorphic.md](../schema/certificate-polymorphic.md) |

---

## 5. Why no HTTP surface

The original data model defined a `ProgressModule` with its own
`/progress/*` endpoints for reading per-user aggregates. The
current implementation folds the writes into the learning endpoint
(via the cascade) and exposes the read surface through
`/enrollments/me` and `/enrollments/me/courses/:courseId` (which
embed progress rows). `ProgressService` is therefore a
helper-only class today.

If a dedicated progress read endpoint is added later, it should
live in a new `ProgressController` inside `ProgressModule` and
call `ProgressService` for the aggregate queries — not reach
into `EnrollmentService`.

---

## 6. Tests

| File | Covers |
|------|--------|
| `src/progress/progress.service.spec.ts` | Every branch described in [../learning/progress-cascade.md](../learning/progress-cascade.md). |

---

## 7. Files involved

| File | Role |
|------|------|
| `src/progress/progress.service.ts` | The class |
| `src/progress/progress.module.ts` | Module wiring with `forwardRef` to `CertificatesModule` |
| `src/learning/learning.controller.ts` | The one HTTP caller |
| `src/certificates/certificates.service.ts` | Eligibility checks consumed by the cascade |

---

## 8. Things NOT to change without coordination

- The "no HTTP surface" decision. Adding an ad-hoc progress
  endpoint without designing the read contract first would
  proliferate near-duplicate aggregate shapes.
- The `forwardRef` wiring. Flat-importing `CertificatesService`
  will crash Nest module resolution.
- The public visibility of the recalculate helpers. Tests depend
  on it.
- The "raw Prisma entities in the response" choice. See
  [../learning/complete-lesson.md §10](../learning/complete-lesson.md).
