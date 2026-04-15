# List My Enrollments — Backend Spec (awamer-api)

> **Module:** `EnrollmentModule`
> **Endpoint:** `GET /api/v1/enrollments/me`
> **Guards:** `JwtAuthGuard` (controller-level)
> **Status code:** `200 OK`

---

## 1. Summary

Returns every enrollment belonging to the calling user — both
`PathEnrollment` rows and `CourseEnrollment` rows for standalone
courses — with the current per-scope progress rolled in. Used by
the learner dashboard.

---

## 2. Request

```
GET /api/v1/enrollments/me
Cookie: access_token=<JWT>
```

No query parameters.

---

## 3. Behavior — `EnrollmentService.listAllForUser(userId)`

Source: `src/enrollment/enrollment.service.ts` `listAllForUser()`.

1. **Parallel reads** via `Promise.all`:
   ```ts
   prisma.pathEnrollment.findMany({
     where: { userId },
     include: { path: true },
     orderBy: { enrolledAt: 'desc' },
   });
   prisma.courseEnrollment.findMany({
     where: { userId, course: { pathId: null } },
     include: { course: true },
     orderBy: { enrolledAt: 'desc' },
   });
   ```
   The course query filters by `course.pathId: null` so that a
   course that has been moved under a path after the user enrolled
   (an admin reshape) does not appear on both rungs of the
   response. It is still technically present in
   `course_enrollments` but is hidden from the learner until the
   admin resolves the conflict.
2. **Load progress rows** for all returned enrollments:
   ```ts
   prisma.pathProgress.findMany({ where: { userId, pathId: { in: ... } } });
   prisma.courseProgress.findMany({ where: { userId, courseId: { in: ... } } });
   ```
3. **Map** each enrollment row together with its matching progress
   row (`null` when missing) to the response DTO via
   `PathEnrollmentResponseDto.fromEntity` and
   `CourseEnrollmentResponseDto.fromEntity`.
4. **Return** `{ paths, courses }`.

---

## 4. `EnrollmentListResponseDto`

```ts
{
  paths:   PathEnrollmentResponseDto[],
  courses: CourseEnrollmentResponseDto[],
}
```

Both arrays may be empty. The `PathEnrollmentResponseDto` embeds
the `path` (id, title, slug, thumbnail, level, estimatedHours,
`isFree`) and a `progress` block (`{ percentage, status,
completedCourses, totalCourses }` or `null`).

`CourseEnrollmentResponseDto` embeds the `course` (id, title, slug,
thumbnail, level, `isFree`) and a `progress` block
(`{ percentage, status, completedSections, totalSections }` or
`null`).

See the DTO files for the exact property sets — they are plain
class-transformer shapes with a static `fromEntity` factory.

---

## 5. Successful response

```json
{
  "data": {
    "paths": [
      {
        "id": "uuid",
        "pathId": "uuid",
        "enrolledAt": "ISO",
        "status": "ACTIVE",
        "path": { "id": "...", "title": "...", "slug": "...", "thumbnail": null, "level": "beginner", "estimatedHours": 20, "isFree": false },
        "progress": { "percentage": 42, "status": "IN_PROGRESS", "completedCourses": 1, "totalCourses": 3 }
      }
    ],
    "courses": [
      {
        "id": "uuid",
        "courseId": "uuid",
        "enrolledAt": "ISO",
        "status": "ACTIVE",
        "course": { "id": "...", "title": "...", "slug": "...", "thumbnail": null, "level": "BEGINNER", "isFree": false },
        "progress": { "percentage": 0, "status": "NOT_STARTED", "completedSections": 0, "totalSections": 5 }
      }
    ]
  },
  "message": "Success"
}
```

Empty user → `{ "paths": [], "courses": [] }`.

---

## 6. Error responses

| Status | When |
|--------|------|
| `401`  | Missing/invalid access token. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Prisma read failure. |

---

## 7. Side effects

None. Read-only.

---

## 8. Files involved

| File | Role |
|------|------|
| `src/enrollment/enrollment.controller.ts` | `listMine()` handler |
| `src/enrollment/enrollment.service.ts` | `listAllForUser()` logic |
| `src/enrollment/dto/enrollment-list-response.dto.ts` | Response wrapper |
| `src/enrollment/dto/path-enrollment-response.dto.ts` | Per-row shape |
| `src/enrollment/dto/course-enrollment-response.dto.ts` | Per-row shape |

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/enrollment/enrollment.service.spec.ts` | Empty lists, ordering by `enrolledAt desc`, the `course.pathId: null` filter on the course rung, correct pairing of progress rows to enrollments, null-safety when a progress row is missing. |
| `test/enrollment/*.e2e-spec.ts` | Envelope shape matches §5. |

---

## 10. Things NOT to change without coordination

- The `course.pathId: null` filter on the course enrollment query.
  Removing it would surface admin-moved courses twice.
- The `orderBy: { enrolledAt: 'desc' }` on both rungs. The frontend
  assumes newest-first.
- The `progress: null` fallback for enrollments whose progress row
  has not been seeded yet. Forcing a server-side seed here would
  contradict the "seed on enrollment, not on list" decision made
  for `enrollInCourse`.
