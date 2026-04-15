# Get Course Enrollment — Backend Spec (awamer-api)

> **Module:** `EnrollmentModule`
> **Endpoint:** `GET /api/v1/enrollments/me/courses/:courseId`
> **Guards:** `JwtAuthGuard` (controller-level)
> **Status code:** `200 OK`

---

## 1. Summary

Returns the calling user's enrollment in a standalone course, with
the current `CourseProgress` and the most recent `LastPosition` row
(if any). The response is the "detail" variant of the
course-enrollment shape — richer than what `GET /enrollments/me`
returns.

---

## 2. Request

```
GET /api/v1/enrollments/me/courses/:courseId
Cookie: access_token=<JWT>
```

- `:courseId` must be a UUID — enforced by `ParseUUIDPipe`.

---

## 3. Behavior

Source: `src/enrollment/enrollment.controller.ts` `getCourseEnrollment()`
and `src/enrollment/enrollment.service.ts` `getCourseEnrollment()`.

1. **Load the enrollment** via the unique `(userId, courseId)`:
   ```ts
   prisma.courseEnrollment.findUnique({
     where: { userId_courseId: { userId, courseId } },
     include: { course: true },
   });
   ```
2. **If missing → `null`** (the service returns `null`). The
   controller wraps the call and throws
   `NotFoundException('Enrollment not found')` on `null`.
3. **Parallel reads** for the progress and last-position:
   ```ts
   prisma.courseProgress.findUnique({ where: { userId_courseId: { userId, courseId } } });
   prisma.lastPosition.findFirst({ where: { userId, courseId } });
   ```
4. **Map** via
   `CourseEnrollmentDetailResponseDto.fromDetail(enrollment, progress, lastPosition)`.

The service returns `null` so that the controller can choose
between throwing 404 (public endpoint) or returning `null`
(internal caller); the current controller always throws. Treat
the split as an intentional hook for future reuse.

---

## 4. Successful response

```json
{
  "data": {
    "id": "uuid",
    "courseId": "uuid",
    "enrolledAt": "ISO",
    "status": "ACTIVE",
    "course": { "id": "...", "title": "...", "slug": "...", "thumbnail": null, "level": "BEGINNER", "isFree": false },
    "progress": { "percentage": 40, "status": "IN_PROGRESS", "completedSections": 2, "totalSections": 5 },
    "lastPosition": {
      "sectionId": "uuid",
      "lessonId": "uuid",
      "accessedAt": "ISO"
    }
  },
  "message": "Success"
}
```

`progress` and `lastPosition` are each `null` when the underlying
row is missing.

---

## 5. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | `:courseId` not a UUID. |
| `401`  | Missing/invalid access token. |
| `404`  | `Enrollment not found` (no `CourseEnrollment` row for this user/course). |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Prisma read failure. |

Note: the endpoint is specific to standalone courses. A user who
is enrolled in a path-owned course via their `PathEnrollment`
will receive 404 here — their enrollment lives in
`path_enrollments`, not `course_enrollments`.

---

## 6. Side effects

None. Read-only.

---

## 7. Files involved

| File | Role |
|------|------|
| `src/enrollment/enrollment.controller.ts` | `getCourseEnrollment()` handler + null→404 translation |
| `src/enrollment/enrollment.service.ts` | Service logic |
| `src/enrollment/dto/course-enrollment-detail-response.dto.ts` | Response shape |

---

## 8. Tests

| File | Covers |
|------|--------|
| `src/enrollment/enrollment.service.spec.ts` | `null` return on missing enrollment, progress + last-position pairing, `null` fallbacks. |
| `test/enrollment/*.e2e-spec.ts` | 200 shape, 404 for unknown course, 404 for path-owned course. |

---

## 9. Things NOT to change without coordination

- The split between "service returns `null`" and "controller
  throws 404". The service contract is the one both places
  depend on.
- The explicit `lastPosition` field. It is the only place the
  frontend can recover the user's current position in a
  standalone course without paging through progress rows.
