# Enrollment — Index

Dual-rung enrollment for paths and standalone courses. Introduced by
KAN-73 (see [../schema/course-enrollment.md](../schema/course-enrollment.md)
for the data model).

## Endpoints

| File | Purpose |
|------|---------|
| [enroll-in-path.md](./enroll-in-path.md) | `POST /api/v1/enrollments/paths/:pathId` — create `PathEnrollment` + seed progress rows |
| [enroll-in-course.md](./enroll-in-course.md) | `POST /api/v1/enrollments/courses/:courseId` — create `CourseEnrollment` for a standalone course; rejects path-owned courses with `parentPathId` passthrough |
| [list-my-enrollments.md](./list-my-enrollments.md) | `GET /api/v1/enrollments/me` — both rungs with progress rolled in |
| [get-course-enrollment.md](./get-course-enrollment.md) | `GET /api/v1/enrollments/me/courses/:courseId` — detail view with progress + last position |

## Guards

| File | Purpose |
|------|---------|
| [enrollment-guard.md](./enrollment-guard.md) | `EnrollmentGuard` — polymorphic access check based on `course.pathId`; `hasAccessToCourse` helper |
