# path-stats.helper.ts — Backend Reference (awamer-api)

> **Source:** `src/content/paths/path-stats.helper.ts`
> **Exports:** `PathStats`, `computePathStats`, `applyIsFreeOverride`, `normalizeLevel`, `buildOrderBy`
> **Consumers:** `PathsService`, `CoursesService` (re-exports `applyIsFreeOverride`)

This module owns the four "derived" pieces of the discovery
service: statistics aggregation, the is-free override, level
normalization, and the paginated orderBy. None of them live on
the schema (see
[../../schema/conventions.md §8](../../schema/conventions.md)
on the derived-stats policy), so they all live here.

---

## 1. `PathStats` + `computePathStats(path)`

```ts
interface PathStats {
  courseCount: number;
  lessonCount: number;
  totalDurationMinutes: number;
  projectCount: number;
}

function computePathStats(path: PathLike): PathStats
```

Walks a nested path structure (`path → courses → sections →
lessons`) and accumulates four counts:

- `courseCount` = `path.courses.length`.
- `lessonCount` = sum of `section.lessons.length` across every
  section in every course.
- `totalDurationMinutes` = sum of `lesson.estimatedMinutes ?? 0`
  across every lesson.
- `projectCount` = sum of `course._count.projects` across every
  course (fed by the Prisma `_count` include).

The input type (`PathLike`) is a structural subset — any object
with `courses[].sections[].lessons[]` and a `_count.projects` on
each course will work. This makes the helper testable without
stubbing the full Prisma shape.

---

## 2. `applyIsFreeOverride(parent)`

```ts
function applyIsFreeOverride(parent: { courses?: ...; sections?: ... }): void
```

Mutates every nested `lesson.isFree` to `true`. Accepts either
a **path-shaped** object (`courses → sections → lessons`) or a
**course-shaped** object (`sections → lessons`) — the two
branches are independent `if` checks, so passing an object with
both `courses` and `sections` walks both.

Called from `PathsService.findDetailBySlug` and
`CoursesService.findDetailBySlug` only when the parent's
`isFree` flag is `true`. The rule is API Design §5.4: **a free
parent makes everything under it free**, regardless of the
individual lesson/course flags.

Note: this mutates the input object in place. The caller is
expected to have just loaded the object from the DB for this
single request; the mutation never leaks to other consumers or
back to the DB.

---

## 3. `normalizeLevel(value)`

```ts
const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);

function normalizeLevel(value: string | null): PathLevel | null
```

Validates a raw string against the three canonical lowercase
levels and returns `null` on anything else (including `null`
input). Used by the mapper layer
([path-mapper.md](./path-mapper.md)) to normalize
`Path.level`, which is stored as `String?` on the schema
(Decision D — schema frozen; the real enum exists for `Course`
via `CourseLevel`).

The normalization is intentionally forgiving: a stored value of
`"Beginner"` or `"BEGINNER"` is lowercased and accepted; anything
unrecognized becomes `null`. Admin tooling should prefer to
write the canonical lowercase form but the helper is the safety
net.

---

## 4. `buildOrderBy(query)`

```ts
function buildOrderBy(query: ListPathsQueryDto): Prisma.PathOrderByWithRelationInput[]
```

Returns the two-element orderBy array for
`GET /paths`:

```ts
[
  { <primary key>: <order> },
  { id: 'asc' },
]
```

Where the primary key is one of:

- `createdAt` if `query.sort === 'created_at'`
- `title` if `query.sort === 'title'`
- `order` otherwise (default)

And the direction is `query.order ?? 'asc'`.

**The `{ id: 'asc' }` tiebreaker is mandatory** and comes per
FR-030a. Without it, two paths with the same `order` (or the
same `title`) would flip across pages when the DB planner felt
like it. Any new paginated listing service must follow the same
rule — see [../../api-conventions.md §4](../../api-conventions.md).

---

## 5. Tests

| File | Covers |
|------|--------|
| `src/content/paths/path-stats.helper.spec.ts` | Empty path (all zeros); single-lesson path; realistic topology (multi-course, multi-section, multi-lesson); `applyIsFreeOverride` for path and course shapes; `normalizeLevel` accepts every variant casing and rejects unknown values; `buildOrderBy` produces every sort×order combination with the tiebreaker. |

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/paths/path-stats.helper.ts` | The module |
| `src/content/paths/paths.service.ts` | Primary consumer |
| `src/content/courses/course-stats.helper.ts` | Re-exports `applyIsFreeOverride` |

---

## 7. Things NOT to change without coordination

- The derived-stats-in-helper policy. Moving these to stored
  columns on `Path` was considered and rejected — see
  [../../schema/conventions.md §8](../../schema/conventions.md).
- The `{ id: 'asc' }` tiebreaker.
- The `applyIsFreeOverride` in-place mutation. Cloning for
  immutability would require wrapping every nested structure
  and doubling the object-graph allocation.
- The lowercase-or-null behavior of `normalizeLevel`. Returning
  the raw value on unrecognized levels would leak schema drift
  to the API.
