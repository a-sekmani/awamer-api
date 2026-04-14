# Contract — Enrollment endpoints

**Base**: `/api/v1`
**Auth**: `JwtAuthGuard` (global `APP_GUARD`); every endpoint requires an authenticated learner.
**Envelope**: Standard `{ data, message }` on success.

---

## POST /enrollments/paths/:pathId — Enroll in a path

**Params**
- `pathId` — UUID (validated with `ParseUUIDPipe`)

**Body**: empty.

**Side effects** (single `prisma.$transaction`):
1. Create `PathEnrollment { userId, pathId, status: ACTIVE }`.
2. Create `PathProgress { userId, pathId, percentage: 0, status: NOT_STARTED, totalCourses, completedCourses: 0 }`.
3. For each course in the path: create `CourseProgress { userId, courseId, percentage: 0, status: NOT_STARTED, totalSections, completedSections: 0 }`.

**Responses**
- `201` — `{ data: PathEnrollmentResponse, message: "Success" }`
- `404` — path does not exist
- `409` — already enrolled (`findFirst` inside the transaction finds an existing row)
- `401` — unauthenticated

**PathEnrollmentResponse shape**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "pathId": "uuid",
  "status": "ACTIVE",
  "enrolledAt": "2026-04-14T12:00:00.000Z"
}
```

---

## POST /enrollments/courses/:courseId — Enroll in a standalone course

**Params**
- `courseId` — UUID

**Body**: empty.

**Validation**
- The course's `pathId` MUST be `null`. If not, reject with `400` carrying `{ parentPathId }`.

**Side effects** (single `prisma.$transaction`):
1. Create `CourseEnrollment { userId, courseId, status: ACTIVE }`.
2. Create `CourseProgress { userId, courseId, percentage: 0, status: NOT_STARTED, totalSections, completedSections: 0 }`.
3. For each section in the course: create `SectionProgress { userId, sectionId, percentage: 0, status: NOT_STARTED, totalLessons, completedLessons: 0 }`.
4. Do NOT create `PathProgress`.

**Responses**
- `201` — `{ data: CourseEnrollmentResponse, message: "Success" }`
- `400` — course belongs to a path. Body:
  ```json
  {
    "statusCode": 400,
    "message": "Course '<id>' belongs to a path. Enroll in the parent path instead.",
    "parentPathId": "<uuid>",
    "error": "Bad Request"
  }
  ```
- `404` — course does not exist
- `409` — already enrolled (Prisma `P2002` on `CourseEnrollment.@@unique([userId, courseId])`)
- `401` — unauthenticated

**CourseEnrollmentResponse shape**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "courseId": "uuid",
  "status": "ACTIVE",
  "enrolledAt": "2026-04-14T12:00:00.000Z"
}
```

---

## GET /enrollments/me — List my enrollments

**Responses**
- `200` — `{ data: EnrollmentListResponse, message }` (empty arrays allowed)
- `401` — unauthenticated

**EnrollmentListResponse shape**
```json
{
  "paths": [
    {
      "id": "uuid",
      "pathId": "uuid",
      "status": "ACTIVE",
      "enrolledAt": "...",
      "path": { "id": "uuid", "title": "...", "slug": "...", "thumbnail": "..." | null },
      "progress": { "percentComplete": 45, "status": "IN_PROGRESS" }
    }
  ],
  "courses": [
    {
      "id": "uuid",
      "courseId": "uuid",
      "status": "ACTIVE",
      "enrolledAt": "...",
      "course": { "id": "uuid", "title": "...", "slug": "...", "thumbnail": "..." | null },
      "progress": { "percentComplete": 80, "status": "IN_PROGRESS" }
    }
  ]
}
```

**Rules**
- `courses` ONLY contains standalone courses (those with `pathId IS NULL`). Path-attached courses appear under their parent path, not here.
- Both arrays sorted by `enrolledAt DESC`.

---

## GET /enrollments/me/courses/:courseId — Course enrollment detail

**Params**
- `courseId` — UUID

**Responses**
- `200` — `{ data: CourseEnrollmentDetailResponse, message }`
- `404` — course does not exist OR user is not enrolled (same 404 either way — do not differentiate)
- `401` — unauthenticated

**CourseEnrollmentDetailResponse shape**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "courseId": "uuid",
  "status": "ACTIVE",
  "enrolledAt": "...",
  "progress": { "percentComplete": 80, "status": "IN_PROGRESS" },
  "lastPosition": {
    "sectionId": "uuid",
    "lessonId": "uuid",
    "accessedAt": "..."
  } | null
}
```
