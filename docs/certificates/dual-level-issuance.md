# Dual-Level Certificate Issuance — Flow Reference (awamer-api)

> **Service:** `CertificatesService.checkCourseEligibility` / `checkPathEligibility` / `issueCertificate`
> **Source:** `src/certificates/certificates.service.ts`
> **Triggered by:** the progress cascade — see [../learning/progress-cascade.md](../learning/progress-cascade.md)

This document describes when and how certificates are awarded.
Certificates are issued by the `CertificatesService` and only
from inside the progress cascade's transaction. There is no
admin or manual issuance endpoint today.

Two types exist:

- **Course certificate** — awarded when every lesson under the
  course is `COMPLETED` and every quiz is passed.
- **Path certificate** — awarded when every course under the
  path has its own course certificate.

Both are stored in the same polymorphic `Certificate` table with
the `type` discriminator — see
[../schema/certificate-polymorphic.md](../schema/certificate-polymorphic.md).

---

## 1. Entry points

```ts
async checkCourseEligibility(tx, userId, courseId): Promise<Certificate | null>
async checkPathEligibility  (tx, userId, pathId):   Promise<Certificate | null>
```

Both are called by `ProgressService.completeLesson` from inside the
cascade transaction, in this order:

1. `checkCourseEligibility(tx, userId, course.id)`.
2. If the course has a parent path,
   `checkPathEligibility(tx, userId, course.pathId)`.

Each returns either a `Certificate` row (existing or newly issued)
or `null` (not eligible). `ProgressService` then classifies the
returned rows as "newly issued by this call" vs "already existed"
using the pre-transaction snapshot — see
[../learning/progress-cascade.md §5.8](../learning/progress-cascade.md).

---

## 2. `checkCourseEligibility`

```ts
async checkCourseEligibility(tx, userId, courseId) {
  const existing = await tx.certificate.findFirst({
    where: { userId, courseId, type: 'COURSE' },
  });
  if (existing) return existing;                                 // (1)

  const course = await tx.course.findUnique({
    where: { id: courseId },
    include: { sections: { include: { lessons: { select: { id: true } } } } },
  });
  if (!course) return null;                                      // (2)

  const allLessonIds = course.sections.flatMap((s) => s.lessons.map((l) => l.id));
  if (allLessonIds.length === 0) return null;                    // (3)

  const completed = await tx.lessonProgress.count({
    where: {
      userId,
      lessonId: { in: allLessonIds },
      status: 'COMPLETED',
    },
  });
  if (completed !== allLessonIds.length) return null;            // (4)

  if (!(await this.allCourseQuizzesPassed(tx, userId, courseId))) {
    return null;                                                 // (5)
  }

  return this.issueCertificate(tx, {
    userId, type: 'COURSE', pathId: null, courseId,
  });
}
```

The five exit conditions:

1. **Already issued** — return existing, no work.
2. **Course deleted mid-cascade** — fail closed.
3. **No lessons at all** — a course with zero lessons does not
   qualify. The cascade does not issue a certificate for "you
   completed zero lessons perfectly".
4. **Not every lesson completed** — count must match
   `allLessonIds.length` exactly.
5. **Quiz gate** — `allCourseQuizzesPassed` must return `true`.
   See §4.

---

## 3. `checkPathEligibility`

```ts
async checkPathEligibility(tx, userId, pathId) {
  const existing = await tx.certificate.findFirst({
    where: { userId, pathId, type: 'PATH' },
  });
  if (existing) return existing;                                 // (1)

  const enrollment = await tx.pathEnrollment.findFirst({
    where: { userId, pathId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!enrollment) return null;                                  // (2)

  const path = await tx.path.findUnique({
    where: { id: pathId },
    include: { courses: { select: { id: true } } },
  });
  if (!path || path.courses.length === 0) return null;           // (3)

  const courseCertCount = await tx.certificate.count({
    where: {
      userId,
      type: 'COURSE',
      courseId: { in: path.courses.map((c) => c.id) },
    },
  });
  if (courseCertCount !== path.courses.length) return null;      // (4)

  return this.issueCertificate(tx, {
    userId, type: 'PATH', pathId, courseId: null,
  });
}
```

Exit conditions:

1. **Already issued** — return existing.
2. **No ACTIVE `PathEnrollment`** — a user who dropped their
   enrollment cannot earn the path certificate even if all their
   course certs exist.
3. **Path has no courses** — fail closed.
4. **Missing at least one course certificate** — the "all courses
   complete" check is expressed as "one course certificate per
   course under the path".

The path-level check therefore depends on course-level
certificates having been issued first. Because
`ProgressService.completeLesson` calls `checkCourseEligibility`
before `checkPathEligibility` in the same transaction, the
cascade naturally satisfies this ordering: if a lesson completion
crosses both thresholds at once, both certificates are issued in
the right order inside a single transaction.

---

## 4. `allCourseQuizzesPassed(tx, userId, courseId)` — the stub

```ts
private async allCourseQuizzesPassed(_tx, _userId, _courseId): Promise<boolean> {
  // TODO(KAN-quizzes)
  return true;
}
```

**Currently returns `true` unconditionally.** The comment flags
this: the quiz subsystem has no submission flow yet, so no
`QuizAttempt` rows with `PASSED` status exist. Treating the check
as satisfied lets the cascade actually issue course certificates.
The fallback is documented as intentional and satisfied
*regardless of how many quizzes the course defines* — per FR-015.

When the quiz submission flow lands, this method is the single
swap point. Do not add the quiz check elsewhere.

---

## 5. `issueCertificate` — generation, persistence, analytics

```ts
private async issueCertificate(tx, data: IssueCertificateData): Promise<Certificate> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = this.generateCode();  // randomUUID, 12-char hex
    try {
      const created = await tx.certificate.create({
        data: {
          userId: data.userId,
          type: data.type,
          pathId: data.pathId,
          courseId: data.courseId,
          certificateCode: code,
        },
      });

      this.analytics.capture(created.userId, 'certificate_issued', {
        certificateId: created.id,
        certificateType: created.type,
        pathId: created.pathId,
        courseId: created.courseId,
        certificateCode: created.certificateCode,
        issuedAt: created.issuedAt.toISOString(),
      });

      return created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        continue;   // code collision — retry with a fresh code
      }
      throw err;
    }
  }
  throw new InternalServerErrorException('Failed to generate unique certificate code');
}
```

Three properties of interest:

### 5.1 The 12-character code

`generateCode()` returns `randomUUID().replace(/-/g, '').slice(0, 12)`.
A 12-char hex prefix is `16^12 ≈ 3 × 10^14` values — collisions
are statistically improbable, and the retry loop handles any
that do occur.

### 5.2 The retry loop

On a `P2002` unique-constraint violation (collision on
`certificateCode`), the loop runs up to **3 times** with a fresh
code each iteration. Beyond the third attempt it throws
`InternalServerErrorException('Failed to generate unique
certificate code')`. In practice this should never fire.

### 5.3 Analytics emission — structural idempotency

`analytics.capture(userId, 'certificate_issued', ...)` is called
synchronously immediately after the successful `create`.
Crucially, the analytics call is placed **inside
`issueCertificate`**, not in the eligibility checks. Because
`checkCourseEligibility` and `checkPathEligibility` short-circuit
on `findFirst(existing)` **before** ever reaching
`issueCertificate`, the analytics event fires exactly once per
(user, scope) across the lifetime of the DB. This is a structural
invariant, not a runtime check.

The comment in the source elaborates (FR-030):

> FR-030 — emit `certificate_issued` exactly at the point of
> genuine new-issuance. Placement inside issueCertificate is a
> structural idempotency guarantee. ... AnalyticsService.capture
> is synchronous and returns void — it cannot abort the Prisma
> transaction today. The FR-030 invariant ("emission failure
> must not roll back issuance") is satisfied by those properties
> now, and in the future will be the responsibility of
> AnalyticsService itself when it gains a real PostHog client.

If `AnalyticsService.capture` ever becomes async or throws, the
code comment has to be revisited — and likely the call has to be
wrapped in a try/catch to preserve the "no rollback on emission
failure" guarantee.

---

## 6. Why checks live on `CertificatesService`, not `ProgressService`

The eligibility logic could have been split differently — put it
in `ProgressService` and keep `CertificatesService` purely as a
writer. The chosen split places it on `CertificatesService`
because:

1. The eligibility rules are **certificate concerns**, not
   progress concerns. "Has this user earned this credential?" is
   a different question from "what is this user's progress?".
2. The `findFirst(existing)` short-circuit lives at the start of
   each eligibility check. Placing it on `CertificatesService`
   keeps the "issued exactly once" invariant inside a single
   class.
3. Tests can exercise eligibility without having to stub the full
   progress cascade.

---

## 7. Tests

| File | Covers |
|------|--------|
| `src/certificates/certificates.service.spec.ts` | Course eligibility happy path; "already issued" short-circuit returning the existing row; zero-lessons → null; incomplete lessons → null; quiz stub returning `true`; path eligibility happy path; missing `PathEnrollment` → null; zero-courses → null; `courseCertCount` mismatch → null; `P2002` retry loop; fallback `InternalServerErrorException` after 3 collisions; analytics emission fires with the expected payload on successful issuance. |

---

## 8. Files involved

| File | Role |
|------|------|
| `src/certificates/certificates.service.ts` | Eligibility + issuance |
| `src/progress/progress.service.ts` | Only caller of the eligibility checks |
| `src/analytics/analytics.service.ts` | `capture(userId, event, payload)` |
| `src/certificates/certificates.module.ts` | `forwardRef` to break the circular import with `ProgressModule` |

---

## 9. Things NOT to change without coordination

- The `findFirst(existing)` short-circuit at the start of each
  eligibility check. Without it, a re-run of the cascade would
  throw `P2002` on an idempotent completion.
- The "quiz stub returns true" fallback. Flipping it to `false`
  before the quiz submission flow lands would stop all course
  certificates from issuing.
- The `analytics.capture` placement inside `issueCertificate`.
  See §5.3.
- The 3-attempt retry budget. Raising it masks a real collision
  problem; lowering it risks transient failure.
- The `forwardRef` on `ProgressService` ↔ `CertificatesService`.
  The two services need each other at module-resolution time.
- The `EnrollmentStatus.ACTIVE` check on path eligibility. A
  dropped enrollment must not earn the path certificate even if
  all course certs are somehow present.
