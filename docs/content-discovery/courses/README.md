# Courses (Public Discovery) — Index

Public discovery endpoints for courses. Includes both path-owned
courses and standalone courses — see
[../../schema/course-changes.md](../../schema/course-changes.md)
and [../../schema/course-enrollment.md](../../schema/course-enrollment.md)
for the data model.

## Endpoints

| File | Purpose |
|------|---------|
| [list-courses.md](./list-courses.md) | `GET /api/v1/courses` — paginated list with filters incl. `pathId`/`standalone` mutual exclusion, cache-aside on `courses:list:<queryHash>` (5 min TTL) |
| [get-course-by-slug.md](./get-course-by-slug.md) | `GET /api/v1/courses/:slug` — full detail with curriculum + marketing; 404 on missing or non-published slug |

## Helpers

| File | Purpose |
|------|---------|
| [course-stats-helper.md](./course-stats-helper.md) | `computeCourseStats`, `buildCourseOrderBy`; re-exports `applyIsFreeOverride` from the paths helper |
| [course-mapper.md](./course-mapper.md) | `toCourseSummaryDto`, `toCourseDetailDto`, `buildCourseCertificate`, plus the `COURSE_CERTIFICATE_TEXT` constant |

## Shared with paths

The courses module reuses two helpers from the paths module:

- [../paths/query-hash-helper.md](../paths/query-hash-helper.md) —
  `computeQueryHash` (cache key normalization)
- [../paths/marketing-mapper.md](../paths/marketing-mapper.md) —
  `toFeatureDto`, `toFaqDto`, `toTestimonialDto`
