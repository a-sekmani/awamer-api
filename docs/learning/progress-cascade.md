# Progress Cascade — Flow Reference (awamer-api)

> **Service:** `ProgressService.completeLesson(userId, lessonId)`
> **Source:** `src/progress/progress.service.ts`
> **Triggered by:** `POST /api/v1/learning/lessons/:lessonId/complete`

When a user completes a lesson, several things must happen as a
single atomic unit: the lesson is marked complete, every parent
aggregate (section → course → optionally path) is recalculated,
the user's last position is updated, and — if the work crossed a
certification threshold — course-level and/or path-level
certificates are issued. This document is the full map of that
cascade.

---

## 1. Entry point

`ProgressService.completeLesson(userId, lessonId)` is called once,
from the controller of the `POST /learning/lessons/:lessonId/complete`
endpoint. The controller does nothing else. Every side effect
described below happens inside this method.

---

## 2. Step 0 — idempotent short-circuit

```ts
const existing = await this.prisma.lessonProgress.findUnique({
  where: { userId_lessonId: { userId, lessonId } },
});
if (existing && existing.status === ProgressStatus.COMPLETED) {
  return this.loadCurrentState(userId, existing);
}
```

If the lesson is already marked `COMPLETED` for this user, the
service returns the current aggregate state without opening a
transaction and without calling certificate eligibility. The
returned `certificatesIssued` list is always empty on this branch.

Rationale: the endpoint is idempotent. A repeat call from a
double-submit or a retry must not double-count the lesson in the
parent aggregates or re-fire the `certificate_issued` analytics
event.

---

## 3. Step 1 — resolve lesson chain

```ts
const lesson = await this.prisma.lesson.findUnique({
  where: { id: lessonId },
  include: { section: { include: { course: true } } },
});
```

Throws `NotFoundException(\`Lesson '${lessonId}' not found\`)`
when missing. The load runs **outside** the transaction so the
transaction body is as small as possible.

---

## 4. Step 2 — capture pre-existing certificates

Before opening the transaction, the service queries for the two
certificates that the cascade could issue:

```ts
const [preCourseCert, prePathCert] = await Promise.all([
  prisma.certificate.findFirst({ where: { userId, courseId: course.id, type: 'COURSE' } }),
  course.pathId
    ? prisma.certificate.findFirst({ where: { userId, pathId: course.pathId, type: 'PATH' } })
    : null,
]);
```

This is the "pre-existing snapshot" that lets the service later
classify a returned certificate as "newly issued by this call" vs.
"already existed". The two queries are cheap and deliberately run
outside the transaction.

---

## 5. Step 3 — the transaction

`prisma.$transaction(async (tx) => { ... })`. Inside the
transaction, in order:

### 5.1 Upsert `LessonProgress`

```ts
tx.lessonProgress.upsert({
  where: { userId_lessonId: { userId, lessonId } },
  create: { userId, lessonId, status: 'COMPLETED', completedAt: new Date() },
  update: { status: 'COMPLETED', completedAt: new Date() },
});
```

### 5.2 Recalculate `SectionProgress`

`recalculateSectionProgress(tx, userId, sectionId)` counts the
lessons under the section, counts the user's COMPLETED
`LessonProgress` rows within the section, and upserts
`SectionProgress` with the fresh totals, percentage, and
`deriveStatus(completed, total)`.

### 5.3 Recalculate `CourseProgress`

`recalculateCourseProgress(tx, userId, courseId)` counts sections
under the course, counts the user's COMPLETED `SectionProgress`
rows within the course, and upserts `CourseProgress`.

### 5.4 Recalculate `PathProgress` (conditional)

```ts
const pathProgress = course.pathId
  ? await this.recalculatePathProgress(tx, userId, course.pathId)
  : null;
```

`recalculatePathProgress` counts courses under the path, loads the
user's `CourseProgress` rows for those courses, and computes:

- `completedCourses` — count where `courseProgress.status === 'COMPLETED'`.
- `percentage` — **average of the per-course percentages**, not a
  simple "completed / total" ratio. Partial progress on one
  course moves the path percentage forward.

For standalone courses, `pathProgress` is `null`.

### 5.5 Update `LastPosition`

`updateLastPosition(tx, userId, lesson)` handles the last-position
bookkeeping with a scope-routing quirk:

- **Path scope** when the course has a parent path **and** the
  user holds an ACTIVE `PathEnrollment` for it. Then
  `{ userId, pathId, courseId: null }`.
- **Course scope** otherwise. Then
  `{ userId, pathId: null, courseId }`.

The service uses `findFirst + update-or-create` rather than
`upsert` because "one position per (user, scope)" is enforced by
a partial unique index (where `courseId IS NULL` or `pathId IS
NULL`), which Prisma's upsert cannot target. Decision 4 in the
source comment.

### 5.6 Course certificate eligibility

`this.certificates.checkCourseEligibility(tx, userId, course.id)`.
See [../certificates/dual-level-issuance.md](../certificates/dual-level-issuance.md).
Returns an existing certificate, a newly issued certificate, or
`null`.

### 5.7 Path certificate eligibility (conditional)

```ts
const pathCert = course.pathId
  ? await this.certificates.checkPathEligibility(tx, userId, course.pathId)
  : null;
```

Skipped for standalone courses.

### 5.8 Classify "newly issued by this call"

```ts
const certificatesIssued: Certificate[] = [];
if (courseCert && courseCert.id !== preCourseCert?.id) certificatesIssued.push(courseCert);
if (pathCert && pathCert.id !== prePathCert?.id)   certificatesIssued.push(pathCert);
```

If the cert returned by the eligibility check has a different id
from the one captured in Step 2 (or if Step 2 captured nothing),
it is new. Otherwise it already existed.

### 5.9 Return

```ts
return {
  lessonProgress,
  sectionProgress,
  courseProgress,
  pathProgress,
  certificatesIssued,
};
```

All five fields are returned to the controller as raw Prisma
entities. See [complete-lesson.md §5](./complete-lesson.md).

---

## 6. `deriveStatus(completed, total)`

Helper used by every recalculate step:

```ts
if (total > 0 && completed === total) return 'COMPLETED';
if (completed > 0)                    return 'IN_PROGRESS';
return 'NOT_STARTED';
```

---

## 7. Transaction scope

The entire cascade — from Step 5.1 through Step 5.7 — runs inside
a single `prisma.$transaction`. If any step throws, the whole
transaction rolls back and **no certificate is issued, no
analytics event is emitted, no aggregate row is written, and no
last position is updated**. The pre-capture snapshot (Step 4) is
the only work that is not rolled back, and it has no side effects
to undo.

The pre-load (Step 3) and the pre-capture (Step 4) are outside
the transaction deliberately. They are cheap read-only queries,
and keeping them outside minimizes the lock footprint.

---

## 8. Analytics emission

`certificate_issued` is emitted from inside
`CertificatesService.issueCertificate`, which is called from both
`checkCourseEligibility` and `checkPathEligibility`. Because
issuance is the only place a certificate can be created, and
issuance short-circuits when a pre-existing certificate is
found, the emission is structurally idempotent: the cascade will
never fire `certificate_issued` twice for the same
(user, course/path) pair.

See [../certificates/dual-level-issuance.md §4](../certificates/dual-level-issuance.md).

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/progress/progress.service.spec.ts` | Idempotent short-circuit, full cascade for a path-owned course, cascade for a standalone course (`pathProgress: null`), recalculate helpers produce correct totals + status transitions, `LastPosition` scope routing (path vs course), certificate pre-capture classification. |
| `src/certificates/certificates.service.spec.ts` | Course- and path-level eligibility checks (both paths from the cascade), the `allCourseQuizzesPassed` stub fallback, `P2002` retry loop in `generateCode`. |
| `test/content/learning/*.e2e-spec.ts` | End-to-end: enroll, walk a sequence of `complete` calls, assert the cascade response shape + certificate issuance on the final lesson. |

---

## 10. Things NOT to change without coordination

- The single-transaction scope. See §7.
- The idempotent short-circuit. See §2.
- The `deriveStatus` thresholds (`completed === total` =
  `COMPLETED`, `completed > 0` = `IN_PROGRESS`). The UI hinges on
  these exact boundaries.
- The averaging strategy for `PathProgress.percentage`. A simple
  "completed / total" would lose partial progress information
  that the dashboard displays.
- The pre-capture + diff mechanism for `certificatesIssued`.
  Without it, the frontend cannot show a "you just earned this"
  toast.
- The last-position scope router. See Decision 4.
