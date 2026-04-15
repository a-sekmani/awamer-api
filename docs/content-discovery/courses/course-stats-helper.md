# course-stats.helper.ts — Backend Reference (awamer-api)

> **Source:** `src/content/courses/course-stats.helper.ts`
> **Exports:** `CourseStats`, `computeCourseStats`, `buildCourseOrderBy`, `applyIsFreeOverride` (re-exported)
> **Consumers:** `CoursesService`

Course-side equivalent of
[../paths/path-stats-helper.md](../paths/path-stats-helper.md).
Owns the derived statistics and the course list `orderBy`. Re-
exports the is-free override from the paths helper rather than
duplicating it — the function is shape-polymorphic and works
for both `Path.courses.sections.lessons` and
`Course.sections.lessons`.

---

## 1. `CourseStats` + `computeCourseStats(course)`

```ts
interface CourseStats {
  sectionCount: number;
  lessonCount: number;
  totalDurationMinutes: number;
  projectCount: number;
}

function computeCourseStats(course: CourseLike): CourseStats
```

Walks `course.sections.lessons` and accumulates:

- `sectionCount = course.sections.length`.
- `lessonCount` = sum of `section.lessons.length`.
- `totalDurationMinutes` = sum of `lesson.estimatedMinutes ?? 0`.
- `projectCount` = `course._count?.projects ?? 0`.

The input type is a structural subset, same pattern as the
paths helper.

---

## 2. `applyIsFreeOverride` — re-exported

```ts
// Re-export applyIsFreeOverride from the path helper to honour
// DRY (T009 / Fix 5). The function is shape-polymorphic and
// works on any object with a nested sections/lessons array.
export { applyIsFreeOverride } from '../paths/path-stats.helper';
```

No separate implementation. `CoursesService.findDetailBySlug`
imports it from this module, but the function is the same
object as the one `PathsService.findDetailBySlug` uses. See
[../paths/path-stats-helper.md §2](../paths/path-stats-helper.md).

---

## 3. `buildCourseOrderBy(query)`

```ts
function buildCourseOrderBy(
  query: ListCoursesQueryDto,
): Prisma.CourseOrderByWithRelationInput[]
```

Same shape as the paths equivalent:

```ts
[
  { <primary>: <order> },
  { id: 'asc' },
]
```

- `sort === 'created_at'` → `createdAt`.
- `sort === 'title'` → `title`.
- otherwise → `order`.
- Direction from `query.order ?? 'asc'`.
- Always ends with `{ id: 'asc' }` (FR-030a).

The duplication between `buildOrderBy` (paths) and
`buildCourseOrderBy` (courses) is because the Prisma type
parameter differs — `Prisma.PathOrderByWithRelationInput` vs
`Prisma.CourseOrderByWithRelationInput` — and a generic helper
would add no real clarity.

---

## 4. No `normalizeLevel` here

The courses module does **not** need a `normalizeLevel` helper
because `Course.level` is a real Prisma enum (`CourseLevel`),
not a `String?`. The mapper
([course-mapper.md](./course-mapper.md)) handles the
case-adjustment via its own tiny `lowercaseLevel` helper.

Paths have `normalizeLevel` because `Path.level` is stored as
`String?` (Decision D — schema frozen).

---

## 5. Tests

| File | Covers |
|------|--------|
| `src/content/courses/course-stats.helper.spec.ts` | `computeCourseStats` for empty / full topologies, `buildCourseOrderBy` for every sort×order combination, the re-export works (imports the function from the paths module and runs it on a course-shaped object). |

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/courses/course-stats.helper.ts` | The module |
| `src/content/courses/courses.service.ts` | Consumer |
| `src/content/paths/path-stats.helper.ts` | Source of `applyIsFreeOverride` |

---

## 7. Things NOT to change without coordination

- The re-export of `applyIsFreeOverride`. Forking a course
  implementation would let the two override helpers drift.
- The `{ id: 'asc' }` tiebreaker.
- The absence of `normalizeLevel`. See §4.
