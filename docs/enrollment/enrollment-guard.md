# EnrollmentGuard — Backend Reference (awamer-api)

> **Class:** `EnrollmentGuard`
> **Source:** `src/common/guards/enrollment.guard.ts`
> **Supporting method:** `EnrollmentService.hasAccessToCourse(userId, courseId)`
> **Applied on:** `POST /api/v1/learning/lessons/:lessonId/complete`

`EnrollmentGuard` is the polymorphic access check that sits between
`JwtAuthGuard` and `ContentAccessGuard` on learning routes. Its job
is: **reject any caller who does not hold an ACTIVE enrollment that
grants access to the lesson's owning course** — whether that
enrollment lives in `path_enrollments` or `course_enrollments`.

---

## 1. Summary

The guard runs on every route that carries a `:lessonId` path
parameter. Given the lesson id and the authenticated user, it
resolves the lesson → section → course chain and asks
`EnrollmentService.hasAccessToCourse` whether the user has an
active enrollment that grants access. If not, it throws
`ForbiddenException('Not enrolled')`.

The "polymorphic" part is on the enrollment lookup, not on the
route: the caller never picks a rung. The guard decides based on
`course.pathId`.

---

## 2. `canActivate(context)`

Source: `src/common/guards/enrollment.guard.ts`.

1. **Read the user** from `req.user` (populated by
   `JwtAuthGuard`). If absent → `ForbiddenException('Not enrolled')`
   (defensive — `JwtAuthGuard` should have rejected earlier).
2. **Read the `:lessonId`** from `req.params`. If absent →
   `ForbiddenException('Not enrolled')` (fail closed — the guard
   should never run on a route without a lessonId).
3. **Load the lesson** to get its owning `courseId`:
   ```ts
   prisma.lesson.findUnique({
     where: { id: lessonId },
     include: { section: { select: { courseId: true } } },
   });
   ```
   Missing lesson → `NotFoundException(\`Lesson '${lessonId}' not found\`)`.
4. **Delegate to `EnrollmentService.hasAccessToCourse(userId, courseId)`**.
5. Return `true` on access, throw `ForbiddenException('Not enrolled')`
   on deny.

---

## 3. `EnrollmentService.hasAccessToCourse(userId, courseId)` — the polymorphic query

Source: `src/enrollment/enrollment.service.ts` `hasAccessToCourse()`.

```ts
const course = await this.prisma.course.findUnique({
  where: { id: courseId },
  select: { id: true, pathId: true },
});
if (!course) return false;

if (course.pathId !== null) {
  const pe = await this.prisma.pathEnrollment.findFirst({
    where: {
      userId,
      pathId: course.pathId,
      status: EnrollmentStatus.ACTIVE,
    },
    select: { id: true },
  });
  return pe !== null;
}

const ce = await this.prisma.courseEnrollment.findFirst({
  where: {
    userId,
    courseId,
    status: CourseEnrollmentStatus.ACTIVE,
  },
  select: { id: true },
});
return ce !== null;
```

Three properties:

1. **Course missing → deny.** Defensive; `EnrollmentGuard` will
   raise 404 earlier, but the helper covers other callers.
2. **Course has a parent path → check `PathEnrollment`** for that
   path with status `ACTIVE`. `CourseEnrollment` rows are never
   consulted for path-owned courses.
3. **Course is standalone → check `CourseEnrollment`** with status
   `ACTIVE`.

**ACTIVE is required.** A `PAUSED` path enrollment or a `DROPPED`
course enrollment returns `false` and the caller is rejected.
This is clarification Q3 — see the source comment.

---

## 4. Guard chain order

On the `/learning/lessons/:lessonId/complete` route the guards run
in this order (declared explicitly on the method — see
[../learning/complete-lesson.md](../learning/complete-lesson.md)):

```
JwtAuthGuard → EnrollmentGuard → ContentAccessGuard
```

Order matters:

- `JwtAuthGuard` populates `req.user` so the downstream guards can
  read it.
- `EnrollmentGuard` rejects non-enrolled users before
  `ContentAccessGuard` runs, so the paywall layer never has the
  chance to leak free/paid information to a non-enrolled caller.
- `ContentAccessGuard` enforces the `isFree`-cascade → subscription
  check (see [../learning/content-access-guard.md](../learning/content-access-guard.md)).

Do not reorder. The guard chain is documented by Decision 9 +
FR-025 in the learning controller source.

---

## 5. Error responses

The guard always throws one of:

| Status | `message` |
|--------|-----------|
| `403`  | `Not enrolled` |
| `404`  | `Lesson '${lessonId}' not found` |

Neither carries an `errorCode`.

---

## 6. Tests

| File | Covers |
|------|--------|
| `src/enrollment/enrollment.service.spec.ts` | `hasAccessToCourse` for path-owned course with ACTIVE path enrollment (allow), with PAUSED path enrollment (deny), without enrollment (deny); for standalone course with ACTIVE course enrollment (allow), with DROPPED (deny), without (deny); unknown course (deny). |
| `test/content/learning/*.e2e-spec.ts` | Full guard chain enforcement: 401 without cookie, 403 without enrollment, 403 on dropped enrollment, 200 on active enrollment. |

---

## 7. Files involved

| File | Role |
|------|------|
| `src/common/guards/enrollment.guard.ts` | The guard |
| `src/enrollment/enrollment.service.ts` | `hasAccessToCourse` |
| `src/learning/learning.controller.ts` | Applies the guard |
| `src/common/guards/content-access.guard.ts` | Next guard in the chain |

---

## 8. Things NOT to change without coordination

- The ACTIVE-only check. PAUSED/DROPPED enrollments are
  deliberately denied.
- The polymorphic resolution via `course.pathId`. A user-provided
  "which rung" parameter would re-open the bug this design closes.
- The guard order on the learning controller. See §4.
- The "fail closed" behavior on a missing `:lessonId`. A later
  route that forgets to carry the parameter will get a 403 until
  it is fixed — which is the desired failure mode.
