# path-mapper.ts — Backend Reference (awamer-api)

> **Source:** `src/content/paths/path-mapper.ts`
> **Exports:** `toPathSummaryDto`, `toPathDetailDto`, `buildPathCertificate`, `emptyPaginatedResponse`, `__TEST_ONLY__`
> **Consumers:** `PathsService.listPublic`, `PathsService.findDetailBySlug`

The mapper layer between Prisma rows and the public discovery
DTOs. Pure functions — no DB access, no mutation of the input
beyond reading it. Uses `PathRow` / `CourseRow` / etc. structural
subset types so tests can feed plain objects.

---

## 1. `PATH_CERTIFICATE_TEXT` — the fixed constant

```ts
// TODO(KAN-?-certificate-config): When the schema gains
// certificateText/certificateEnabled/certificateRequiresAwamerPlus
// columns on Path, replace this constant with a per-row read. For
// MVP, all paths grant a certificate and the text is uniform.
const PATH_CERTIFICATE_TEXT =
  'أكمل جميع دورات المسار للحصول على شهادة معتمدة';
```

- Hardcoded Arabic text.
- Exported from `__TEST_ONLY__` so specs can assert on it.
- The TODO points at the future schema change — when `Path`
  gains `certificateText` / `certificateEnabled` /
  `certificateRequiresAwamerPlus` columns, `buildPathCertificate`
  becomes a per-row read instead of a constant.

---

## 2. `buildPathCertificate(path)`

```ts
function buildPathCertificate(path: { isFree: boolean }): CertificateDto {
  return {
    enabled: true,
    requiresAwamerPlus: !path.isFree,
    text: PATH_CERTIFICATE_TEXT,
  };
}
```

Three fields:

- `enabled` — always `true` for the MVP (every path grants a
  certificate).
- `requiresAwamerPlus` — negation of `path.isFree`. A free path
  does not require Awamer Plus; a paid path does.
- `text` — the fixed constant in §1.

The derived `certificate` block lives on the `path` object inside
`PathDetailDto`. The `CertificateDto` type itself is declared in
`dto/path-detail.dto.ts`.

---

## 3. `toPathSummaryDto(path, stats)`

Maps a row to the **list** response DTO. Fields:

```ts
{
  id, slug, title, subtitle,
  level: normalizeLevel(path.level),
  thumbnail,
  category: mapCategory(path.category),
  tags:     mapTags(path.tags),
  isFree, isNew,
  stats: { courseCount, lessonCount, totalDurationMinutes },
}
```

Notes:

- `level` is normalized via `normalizeLevel` from
  [path-stats-helper.md](./path-stats-helper.md).
- `category` and `tags` are flattened — the caller's include
  brings `tags: { tag: { ... } }`, and `mapTags` pulls the nested
  `tag` out.
- The summary's `stats` is a **subset** of the full `PathStats`
  — `projectCount` is omitted because list cards do not show it.
- `description` is **not** included. The list view is headline-
  only; the description lives on the detail view.

---

## 4. `toPathDetailDto(path, marketing, stats)`

Maps a row + preloaded marketing arrays to the **detail**
response DTO. The shape has four top-level keys:

```ts
{
  path: { ... full path shape incl. stats + certificate ... },
  curriculum: [ ... per-course entries with nested sections + lessons ... ],
  features: FeatureDto[],
  faqs: FaqDto[],
  testimonials: TestimonialDto[],
}
```

### `path` block

Adds over the summary shape:

- `description`
- `promoVideo` — a `{ url, thumbnail }` object, or `null` when
  `path.promoVideoUrl` is `null`
- `status` (always `'PUBLISHED'` at this point, but the DTO
  includes it)
- `skills` — from the JSONB column, coerced to `string[]` via
  `asStringArray`
- `stats` — the full `PathStats` (including `projectCount`)
- `certificate` — `buildPathCertificate({ isFree: path.isFree })`

### `curriculum` block

For each course under the path, emits:

```ts
{
  id, slug,
  order: course.order ?? 0,
  title, subtitle, description,
  isFree,
  stats: {
    sectionCount: course.sections.length,
    lessonCount: <computed>,
    totalDurationMinutes: <computed>,
  },
  sections: [
    {
      id, title, order,
      lessons: [
        { id, title, type, order, estimatedMinutes, isFree }
      ]
    }
  ]
}
```

The per-course stats are computed inline inside the mapper (not
via `computeCourseStats`). The two `for` loops tally
`lessonCount` and `totalDurationMinutes` directly. This is a
~6-line duplication of `computeCourseStats` and is intentional —
the mapper needs the per-course stats indexed by course inside
the same walk it uses to build `curriculum`, and a separate
helper call would require either a second walk or a mutable
accumulator.

### `features` / `faqs` / `testimonials`

Already-mapped DTOs from the caller, passed through. The caller
(`PathsService.findDetailBySlug`) builds them via
`marketing-mapper.ts` — see
[marketing-mapper.md](./marketing-mapper.md).

---

## 5. `emptyPaginatedResponse(page, limit)`

Helper for callers that need to short-circuit with an empty
list:

```ts
{ data: [], meta: { total: 0, page, limit, totalPages: 0 } }
```

Currently unused in production code but exported for tests and
future consumers.

---

## 6. Internal helpers (not exported)

- `mapTags(tags)` — walks `TagJoinRow[]` and flattens to
  `{ id, name, slug }[]`.
- `mapCategory(c)` — pulls `{ id, name, slug }` from a
  `CategoryRow`.
- `asStringArray(value)` — coerces the Prisma `Json` column to
  `string[]`, returning `[]` on anything non-array.

These are deliberately simple one-liners. If any of them grow,
split them into a shared utility module.

---

## 7. Tests

| File | Covers |
|------|--------|
| `src/content/paths/path-mapper.spec.ts` | `toPathSummaryDto` fields, `toPathDetailDto` fields (including `promoVideo: null` when the URL is null), `buildPathCertificate` for free and paid paths, `asStringArray` branches, per-course stats computation inside curriculum. |

---

## 8. Files involved

| File | Role |
|------|------|
| `src/content/paths/path-mapper.ts` | The module |
| `src/content/paths/dto/path-summary.dto.ts` | `PathSummaryDto` + `PaginatedResponse<T>` |
| `src/content/paths/dto/path-detail.dto.ts` | `PathDetailDto` + `CertificateDto` + nested DTOs |
| `src/content/paths/path-stats.helper.ts` | `normalizeLevel`, `PathStats` |

---

## 9. Things NOT to change without coordination

- The `PATH_CERTIFICATE_TEXT` constant. Removing the TODO
  without also adding the schema column leaves consumers with
  no `certificate.text` to render.
- The "inline per-course stats" computation in `toPathDetailDto`.
  Collapsing it into `computeCourseStats` requires a second walk
  or a mutable accumulator — not worth the cleanup.
- The `projectCount` omission from `PathSummaryDto`. List cards
  have a fixed visual budget.
- The Arabic text in the certificate. This is a product copy
  decision, not a backend one.
