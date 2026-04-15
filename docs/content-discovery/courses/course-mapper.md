# course-mapper.ts — Backend Reference (awamer-api)

> **Source:** `src/content/courses/course-mapper.ts`
> **Exports:** `toCourseSummaryDto`, `toCourseDetailDto`, `buildCourseCertificate`, `__TEST_ONLY__`
> **Consumers:** `CoursesService.listPublic`, `CoursesService.findDetailBySlug`

Course-side equivalent of
[../paths/path-mapper.md](../paths/path-mapper.md). Maps Prisma
rows to the public discovery DTOs.

---

## 1. `COURSE_CERTIFICATE_TEXT`

```ts
// TODO(KAN-?-certificate-config): When the schema gains
// certificateText/certificateEnabled/certificateRequiresAwamerPlus
// columns on Course, replace this constant with a per-row read.
// For MVP, all courses grant a certificate and the text is uniform.
const COURSE_CERTIFICATE_TEXT =
  'أكمل الدورة للحصول على شهادة معتمدة';
```

Different from `PATH_CERTIFICATE_TEXT` — the paths version reads
"complete all courses in the path", the courses version reads
"complete the course". Both are fixed for the MVP and both have
the same TODO pointing at a future per-row schema column.

---

## 2. `buildCourseCertificate(course)`

```ts
function buildCourseCertificate(course: { isFree: boolean }): CertificateDto {
  return {
    enabled: true,
    requiresAwamerPlus: !course.isFree,
    text: COURSE_CERTIFICATE_TEXT,
  };
}
```

Same shape as `buildPathCertificate` — see
[../paths/path-mapper.md §2](../paths/path-mapper.md).

The `CertificateDto` type is imported from
`../paths/dto/path-detail.dto.ts` — paths and courses share the
type.

---

## 3. `lowercaseLevel(value)` — private helper

```ts
function lowercaseLevel(value: string | null): CourseLevelFilter | null
```

Adjusts the stored `CourseLevel` enum value (e.g. `'BEGINNER'`)
to the lowercase wire-format (`'beginner'`). Returns `null` on
anything unrecognized. Functionally similar to paths'
`normalizeLevel`, but simpler because the DB values are the
canonical UPPERCASE enum — there is no
"Beginner"/"beginner"/"BEGINNER" ambiguity to tolerate.

---

## 4. `toCourseSummaryDto(course, stats)`

Maps a row to the **list** response DTO:

```ts
{
  id, slug, title, subtitle,
  level: lowercaseLevel(course.level),
  thumbnail,
  category: mapCategory(course.category),
  path: course.path
    ? { id, slug, title }
    : null,
  tags: mapTags(course.tags),
  isFree, isNew,
  stats: {
    sectionCount,
    lessonCount,
    totalDurationMinutes,
  },
}
```

Notes:

- `path` — the parent path is embedded as a `{ id, slug, title }`
  block, or `null` for standalone courses.
- `stats` — the summary subset (no `projectCount`).
- `description` is **not** on the summary.

---

## 5. `toCourseDetailDto(course, marketing, stats)`

Maps a row + preloaded marketing to the detail DTO. Has three
top-level keys:

```ts
{
  course: CourseCoreDto,  // full course incl. stats + certificate
  curriculum: PathSectionDto[],  // sections + lessons
  features: FeatureDto[],
  faqs: FaqDto[],
  testimonials: TestimonialDto[],
}
```

### `course` block (`CourseCoreDto`)

Adds over the summary:

- `description`
- `status` (always `'PUBLISHED'`)
- `skills` (from JSONB, coerced via `asStringArray`)
- `stats` (full, including `projectCount`)
- `certificate` — `buildCourseCertificate({ isFree: course.isFree })`
- `parentPath` — renamed from `path` in the summary DTO. The
  two DTOs use different key names for the same concept:
  **list uses `path`, detail uses `parentPath`**. This is a
  small inconsistency from the original KAN-26 design that the
  frontend has already shipped against; do not "harmonize" it
  without coordinating the frontend update.

### `curriculum` block

Simpler than the paths version because there is only one level
of nesting (sections → lessons, no outer course loop). Each
section becomes:

```ts
{
  id, title, order,
  lessons: [ { id, title, type, order, estimatedMinutes, isFree } ]
}
```

Uses `PathSectionDto` as the type (imported from
`./dto/course-detail.dto.ts`) — the name is legacy; the type is
identical for paths and courses at this nesting level.

### Marketing blocks

Passed through from the caller, already mapped via
[../paths/marketing-mapper.md](../paths/marketing-mapper.md).

---

## 6. Internal helpers

- `mapCategory(c)` — `{ id, name, slug }`.
- `mapTags(tags)` — flattens `TagJoinRow[]` to `{ id, name, slug }[]`.
- `asStringArray(value)` — same coercion as the paths mapper.

Three tiny helpers, duplicated from the paths mapper. A shared
utility module would consolidate them; the duplication is the
cost of colocating each mapper with its own DTO types.

---

## 7. Tests

| File | Covers |
|------|--------|
| `src/content/courses/course-mapper.spec.ts` | `toCourseSummaryDto` fields including `path: null` for standalone, `toCourseDetailDto` fields including `parentPath` naming, `buildCourseCertificate` for free and paid, `lowercaseLevel` branches. |

---

## 8. Files involved

| File | Role |
|------|------|
| `src/content/courses/course-mapper.ts` | The module |
| `src/content/courses/dto/course-summary.dto.ts` | `CourseSummaryDto` + `PaginatedResponse` |
| `src/content/courses/dto/course-detail.dto.ts` | `CourseDetailDto`, `CourseCoreDto`, `PathSectionDto`, `FaqDto`, `FeatureDto`, `TestimonialDto` |
| `src/content/paths/dto/path-detail.dto.ts` | `CertificateDto` (shared) |
| `src/content/courses/course-stats.helper.ts` | `CourseStats` |

---

## 9. Things NOT to change without coordination

- The `COURSE_CERTIFICATE_TEXT` constant. See §1.
- The `path` vs `parentPath` naming inconsistency between
  summary and detail. See §5.
- The `PathSectionDto` name reuse at the nesting level. The DTO
  type is in `dto/course-detail.dto.ts`; the name is legacy.
- The `projectCount` omission from the summary DTO — same
  rationale as paths.
