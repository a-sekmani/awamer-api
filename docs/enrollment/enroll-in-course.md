# Enroll in Course — Backend Spec (awamer-api)

> **Module:** `EnrollmentModule`
> **Endpoint:** `POST /api/v1/enrollments/courses/:courseId`
> **Guards:** `JwtAuthGuard` (controller-level)
> **Status code:** `201 Created`

---

## 1. Summary

Creates a `CourseEnrollment` row for a **standalone** course — a
course with `pathId = NULL`. Calling this endpoint on a course that
belongs to a parent path is rejected with `400 Bad Request` and the
parent `pathId` is surfaced on the error response so the frontend
can redirect to the path enrollment flow.

Seeds `CourseProgress` and one `SectionProgress` row per section,
all inside a single Prisma transaction.

---

## 2. Request

```
POST /api/v1/enrollments/courses/:courseId
Cookie: access_token=<JWT>
```

- `:courseId` must be a UUID — enforced by `ParseUUIDPipe`.
- No body.

---

## 3. Behavior — `EnrollmentService.enrollInCourse(userId, courseId)`

Source: `src/enrollment/enrollment.service.ts` `enrollInCourse()`.

Wrapped in `prisma.$transaction`:

1. **Load the course** with its sections and each section's
   lessons (ids only):
   ```ts
   tx.course.findUnique({
     where: { id: courseId },
     include: { sections: { select: { id: true, lessons: { select: { id: true } } } } },
   });
   ```
   - Missing → `NotFoundException(\`Course '${courseId}' does not exist\`)`.
2. **Parent-path check.** `if (course.pathId !== null)` throw a
   `BadRequestException` whose response object carries
   `parentPathId: course.pathId`. `HttpExceptionFilter` surfaces
   that key on the error envelope via the `PASSTHROUGH_KEYS`
   whitelist — see
   [../api-conventions.md §3](../api-conventions.md). The full
   shape returned to the client:
   ```json
   {
     "statusCode": 400,
     "message": "Course '...' belongs to a path. Enroll in the parent path instead.",
     "parentPathId": "<uuid>"
   }
   ```
3. **Create the `CourseEnrollment`** with `status: ACTIVE`. Wrapped
   in a try/catch that converts Prisma `P2002` (unique
   `(userId, courseId)`) into `ConflictException(\`Already enrolled
   in course '${courseId}'\`)`.
4. **Create `CourseProgress`** seed row:
   - `totalSections = course.sections.length`, zeros + NOT_STARTED.
5. **For each section, create `SectionProgress`** seed row:
   - `totalLessons = section.lessons.length`, zeros + NOT_STARTED.
6. **Commit** and return the `CourseEnrollment` row.

Note this seeds `SectionProgress` rows (one per section), unlike
`enrollInPath` which stops at `CourseProgress`. Reason: a
standalone course has only one level of nesting below it, and
seeding `SectionProgress` upfront simplifies the progress cascade.

---

## 4. Successful response

```
HTTP/1.1 201 Created
```

```json
{
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "courseId": "uuid",
    "status": "ACTIVE",
    "enrolledAt": "ISO"
  },
  "message": "Success"
}
```

---

## 5. Error responses

| Status | When | Extra fields |
|--------|------|--------------|
| `400 VALIDATION_FAILED` | `:courseId` not a UUID. | — |
| `400`  | `Course '${courseId}' belongs to a path. Enroll in the parent path instead.` | **`parentPathId: <uuid>`** |
| `401`  | Missing/invalid access token. | — |
| `404`  | `Course '${courseId}' does not exist`. | — |
| `409`  | `Already enrolled in course '${courseId}'` (Prisma P2002). | — |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. | — |
| `500 INTERNAL_ERROR` | Unexpected Prisma error. | — |

The `parentPathId` passthrough is the **only** extra field on the
error envelope for this endpoint. Frontend consumers read it when
status is 400 and the message mentions "belongs to a path".

---

## 6. Side effects

| Table | Mutation |
|-------|----------|
| `course_enrollments` | INSERT (ACTIVE) |
| `course_progress` | INSERT (seed) |
| `section_progress` | INSERT × `course.sections.length` |

No path progress — a standalone course has no parent path.

---

## 7. Files involved

| File | Role |
|------|------|
| `src/enrollment/enrollment.controller.ts` | `enrollInCourse()` route |
| `src/enrollment/enrollment.service.ts` | Business logic |
| `src/common/filters/http-exception.filter.ts` | Passthrough for `parentPathId` |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/enrollment/enrollment.service.spec.ts` | Happy-path seed counts, parent-path rejection shape (including `parentPathId`), P2002 → 409, 404 on unknown course, transaction rollback. |
| `test/enrollment/*.e2e-spec.ts` | End-to-end including the `parentPathId` field surfacing, 201 success shape, double-enroll 409. |

---

## 9. Things NOT to change without coordination

- The `parentPathId` passthrough. The frontend hinges its redirect
  logic on this exact field name.
- The refusal to enroll in a path-owned course. Enrollment storage
  depends on `course.pathId` (see [../schema/course-enrollment.md §3](../schema/course-enrollment.md));
  allowing a `CourseEnrollment` row on a path-owned course would
  put two conflicting sources of truth on the same course.
- The seed loop for `SectionProgress`. Stopping at
  `CourseProgress` would push the section-count query into the
  progress cascade's hot path on every lesson completion.
- The `P2002 → 409` conversion. The DB unique is the single
  enforcement point; do not add a read-then-write pre-check.
