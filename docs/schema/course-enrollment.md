# Schema — CourseEnrollment

> **Source:** `prisma/schema.prisma` (`CourseEnrollment`)
> **Migration:** `20260414145648_v6_path_course_pages_alignment`
> **Module doc:** [../enrollment/README.md](../enrollment/README.md)

`CourseEnrollment` is the second rung of a **parallel** enrollment
model. `PathEnrollment` (which predates epic E3) continues to cover
courses that live inside a path. `CourseEnrollment` is the new rung for
**standalone** courses — courses created with `pathId = NULL`.

---

## 1. The model

```prisma
model CourseEnrollment {
  id         String                 @id @default(uuid())
  userId     String
  courseId   String
  status     CourseEnrollmentStatus @default(ACTIVE)
  enrolledAt DateTime               @default(now())

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@unique([userId, courseId])
  @@index([userId])
  @@index([courseId])
  @@map("course_enrollments")
}
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK. |
| `userId` | uuid | FK → `users`. `ON DELETE CASCADE`. |
| `courseId` | uuid | FK → `courses`. `ON DELETE CASCADE`. |
| `status` | `CourseEnrollmentStatus` | `ACTIVE` / `COMPLETED` / `DROPPED`. |
| `enrolledAt` | `DateTime` | Creation timestamp. The only audit field — no `createdAt`/`updatedAt`. |

Unique constraint `(userId, courseId)` enforces **one enrollment row
per user per course**. A user who drops and re-enrolls flips the status
of the existing row; they do not create a second row.

---

## 2. `CourseEnrollmentStatus`

```prisma
enum CourseEnrollmentStatus {
  ACTIVE    @map("active")
  COMPLETED @map("completed")
  DROPPED   @map("dropped")

  @@map("course_enrollment_status")
}
```

Three states. Legal transitions (enforced in `EnrollmentService`, not
the DB):

```
ACTIVE → COMPLETED   (progress cascade sets this)
ACTIVE → DROPPED     (manual withdraw — not currently exposed)
DROPPED → ACTIVE     (re-enroll)
```

`COMPLETED` is terminal: once the cascade marks a course complete,
re-enrollment is not supported by the current flow.

---

## 3. Relationship to `PathEnrollment`

`PathEnrollment` is a **separate** model from `CourseEnrollment`. Its
definition is unchanged by epic E3:

```prisma
model PathEnrollment {
  id         String           @id @default(uuid())
  userId     String
  pathId     String
  status     EnrollmentStatus @default(ACTIVE)
  enrolledAt DateTime         @default(now())
  // ...
}
```

The two models are **mutually exclusive** by course ownership:

| Course has a parent path? | Enrollment lives in | Guard checks |
|---------------------------|---------------------|--------------|
| Yes (`course.pathId != null`) | `path_enrollments` | `EnrollmentGuard` resolves `course → path → enrollment` and ignores `course_enrollments`. |
| No (`course.pathId == null`)  | `course_enrollments` | `EnrollmentGuard` queries `course_enrollments` directly. |

This "polymorphic enrollment" is the central design of KAN-73 and is
documented in detail in
[../enrollment/enrollment-guard.md](../enrollment/enrollment-guard.md).

A consequence: a path-owned course **cannot** have rows in
`course_enrollments`. `EnrollmentService.enrollInCourse` refuses such
calls and surfaces the parent `pathId` as a `parentPathId` passthrough
on the error response so the frontend can redirect to the path
enrollment flow. See [../enrollment/enroll-in-course.md](../enrollment/enroll-in-course.md).

---

## 4. Indexes

- `UNIQUE(userId, courseId)` — the primary guard against duplicate
  enrollment.
- `@@index([userId])` — serves `GET /enrollments/me`.
- `@@index([courseId])` — serves the admin "learners in this course"
  analytics query (future use).

---

## 5. Progress rows

Enrolling in a standalone course creates the enrollment row **and** a
seed `CourseProgress` row with `percentage: 0, status: NOT_STARTED`,
inside the same transaction. `SectionProgress` and `LessonProgress`
rows are created lazily the first time the user hits the progress
cascade on a lesson. See [../learning/progress-cascade.md](../learning/progress-cascade.md).

---

## 6. Schema tests

| File | Asserts |
|------|---------|
| `test/schema/enrollment.spec.ts` | `CourseEnrollment` unique `(userId, courseId)`, cascade delete on user and course, default status is `ACTIVE`, status transitions are unconstrained by the DB (they are enforced in the service). |

---

## 7. Things NOT to change without coordination

- The separation between `PathEnrollment` and `CourseEnrollment`.
  Merging them into a polymorphic `enrollments` table was considered
  and rejected — the discriminator would be required on every query
  and the two tables already have different column shapes.
- The `UNIQUE(userId, courseId)` constraint. Without it, "drop and
  re-enroll" would accumulate ghost rows.
- The `ON DELETE CASCADE` on both FKs. Deleting a user should remove
  their enrollments; deleting a course should remove its enrollment
  rows (this is how admin content takedown stays consistent).
