# Enroll in Path — Backend Spec (awamer-api)

> **Module:** `EnrollmentModule`
> **Endpoint:** `POST /api/v1/enrollments/paths/:pathId`
> **Guards:** `JwtAuthGuard` (controller-level)
> **Status code:** `201 Created`

---

## 1. Summary

Creates a `PathEnrollment` row for the calling user and seeds the
per-user progress rows for the path and every course underneath it
— all in one Prisma transaction. After a successful call, the
learning endpoints (`POST /learning/lessons/:lessonId/complete`) are
available for every lesson inside the path.

Enrollment is **one-per-(user, path)**. A second call for the same
pair is rejected with `409 Conflict`.

---

## 2. Request

```
POST /api/v1/enrollments/paths/:pathId
Cookie: access_token=<JWT>
```

- `:pathId` must be a UUID — enforced by `ParseUUIDPipe`.
- No body.

---

## 3. Behavior — `EnrollmentService.enrollInPath(userId, pathId)`

Source: `src/enrollment/enrollment.service.ts` `enrollInPath()`.

Wrapped in `prisma.$transaction`:

1. **Load the path** with its courses and each course's sections
   (just the ids):
   ```ts
   tx.path.findUnique({
     where: { id: pathId },
     include: { courses: { select: { id: true, sections: { select: { id: true } } } } },
   });
   ```
   - Missing → `NotFoundException(\`Path '${pathId}' does not exist\`)`.
2. **Check for existing enrollment** via
   `tx.pathEnrollment.findFirst({ where: { userId, pathId } })`.
   - If present → `ConflictException(\`Already enrolled in path '${pathId}'\`)`.
3. **Create the enrollment** with `status: EnrollmentStatus.ACTIVE`.
4. **Create `PathProgress`** seed row:
   - `totalCourses = path.courses.length`
   - `completedCourses = 0`, `percentage = 0`, `status: NOT_STARTED`.
5. **For each course under the path, create a `CourseProgress`**
   seed row:
   - `totalSections = course.sections.length`
   - `completedSections = 0`, `percentage = 0`, `status: NOT_STARTED`.
   - Iteration is sequential (`for … of`) to keep the transaction
     deterministic; the number of courses per path is small.
6. **Commit** and return the `PathEnrollment` row.

Note the cascade does **not** seed `SectionProgress` or
`LessonProgress` — those rows are created lazily by the progress
cascade the first time a user hits `POST /learning/lessons/:id/complete`.

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
    "pathId": "uuid",
    "status": "ACTIVE",
    "enrolledAt": "ISO",
    "createdAt": "ISO",
    "updatedAt": "ISO"
  },
  "message": "Success"
}
```

The raw `PathEnrollment` Prisma entity is returned. There is no
response DTO; consumers parse the shape directly.

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | `:pathId` is not a valid UUID (`ParseUUIDPipe`). |
| `401`  | Missing/invalid access token. |
| `404`  | `Path '${pathId}' does not exist`. |
| `409`  | `Already enrolled in path '${pathId}'`. |
| `429 RATE_LIMIT_EXCEEDED` | Global throttler. |
| `500 INTERNAL_ERROR` | Unexpected Prisma error inside the transaction. |

No `errorCode` strings on the domain paths — the frontend branches
on HTTP status.

---

## 6. Side effects

| Table | Mutation |
|-------|----------|
| `path_enrollments` | INSERT (ACTIVE) |
| `path_progress` | INSERT (seed, percentage 0, NOT_STARTED) |
| `course_progress` | INSERT × `path.courses.length` (seed rows) |

All three happen in a single `$transaction`. No analytics event is
fired here; `path_started` is reserved for the future progress
cascade that marks the first lesson complete.

---

## 7. Files involved

| File | Role |
|------|------|
| `src/enrollment/enrollment.controller.ts` | `enrollInPath()` route |
| `src/enrollment/enrollment.service.ts` | Business logic + transaction |
| `src/enrollment/dto/path-enrollment-response.dto.ts` | Used by the list endpoint (not this one) |
| `src/auth/guards/jwt-auth.guard.ts` | Auth gate |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/enrollment/enrollment.service.spec.ts` | Happy-path creation, seed row counts match the path's course/section topology, `P2002`-style conflict on double enroll, 404 on unknown path, transaction rollback on seed-row failure. |
| `test/enrollment/*.e2e-spec.ts` | HTTP shape, 201 response, cookie auth, double-enroll → 409, UUID validation. |

---

## 9. Things NOT to change without coordination

- The per-course `CourseProgress` seed loop. Skipping it would
  leave the learning endpoints unable to recalculate `CourseProgress`
  correctly on the first lesson completion, because the cascade
  assumes the row already exists.
- The transaction scope. Splitting the enrollment create from the
  progress seed opens a window where a crashed request leaves the
  user "enrolled but with no progress rows", which is worse than
  "not enrolled at all".
- The 409-on-duplicate behavior. Returning 200 for an existing
  enrollment would mask double-submit accidents on the frontend.
- The absence of a `SectionProgress` / `LessonProgress` seed. The
  lazy creation is deliberate — seeding would multiply the initial
  write cost with no user-visible benefit.
