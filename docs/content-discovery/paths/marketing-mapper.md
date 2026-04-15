# marketing-mapper.ts — Backend Reference (awamer-api)

> **Source:** `src/content/paths/marketing-mapper.ts`
> **Exports:** `toFeatureDto`, `toFaqDto`, `toTestimonialDto`
> **Consumers:** `PathsService.findDetailBySlug`, `CoursesService.findDetailBySlug`

Three one-function mappers that translate the Prisma `Feature`,
`Faq`, and `Testimonial` rows into the DTO shapes rendered on
the public path/course detail page. Lives in `content/paths/`
because both `PathsService` and `CoursesService` import it
directly; the location predates the marketing tri-module shape
and was not moved during KAN-26.

---

## 1. The three functions

```ts
function toFeatureDto(row: Feature): FeatureDto
function toFaqDto(row: Faq): FaqDto
function toTestimonialDto(row: Testimonial): TestimonialDto
```

Each is a straight field-rename. Notable mappings:

### `toFeatureDto`

```ts
{ id, title, description, icon, order }
```

One-to-one. No transformation.

### `toFaqDto`

```ts
{ id, question, answer, order }
```

One-to-one. No transformation.

### `toTestimonialDto`

```ts
{
  id,
  authorName,
  authorTitle,       // may be null
  authorAvatar: row.avatarUrl,   // renamed
  body:        row.content,      // renamed
  rating,            // may be null
  order,
}
```

Two field renames:

- `avatarUrl → authorAvatar` — the schema column is
  `avatarUrl`, but the DTO uses `authorAvatar` for consistency
  with `authorName` and `authorTitle`.
- `content → body` — the schema column is `content`, but the
  DTO uses `body` to align with the frontend's content-block
  nomenclature (where "content" is an overloaded word).

These are deliberate and load-bearing; the frontend hard-codes
`authorAvatar` and `body`.

---

## 2. What is not mapped

- `ownerType` / `ownerId` — the public detail page already knows
  which path/course it's rendering; exposing the raw ownership
  pair is unnecessary.
- `createdAt` (Testimonial only) — not currently shown on the
  public page. If added, it belongs at the field-rename level,
  not as a post-process.
- `status` (Testimonial only) — the caller has already filtered
  to `APPROVED` via
  `PublicMarketingQueries.getApprovedTestimonialsByOwner` (see
  [../../marketing/public-marketing-queries.md §3](../../marketing/public-marketing-queries.md)),
  so every row arriving here is approved. Surfacing `status` in
  the public DTO would leak internal state.

---

## 3. Why in `paths/` and not `marketing/`

The mapper lives in `src/content/paths/` rather than a shared
`src/content/marketing/` spot because:

1. `PathsService` imports it directly. At the time KAN-26
   shipped, the nearest natural home was the paths module, and
   it already imported the DTO types from `dto/path-detail.dto.ts`.
2. `CoursesService` also imports it from this path (notice the
   `../paths/marketing-mapper` in
   [../courses/course-stats-helper.md](../courses/course-stats-helper.md)).
   Moving it to `content/marketing/` would break both imports.
3. The DTO target types (`FeatureDto`, `FaqDto`, `TestimonialDto`)
   are defined in `dto/path-detail.dto.ts` — keeping the mapper
   next to its target DTOs reduces cross-module coupling.

If the mapper ever grows a third consumer outside the paths and
courses modules, promote it to `src/content/marketing/` (plus
update the two imports).

---

## 4. Tests

| File | Covers |
|------|--------|
| (no dedicated spec) | Each function is three to six lines of field copies. Coverage comes from `path-mapper.spec.ts` and `course-mapper.spec.ts` which exercise the detail DTO end-to-end. |

---

## 5. Files involved

| File | Role |
|------|------|
| `src/content/paths/marketing-mapper.ts` | The mappers |
| `src/content/paths/dto/path-detail.dto.ts` | `FeatureDto`, `FaqDto`, `TestimonialDto` target types |
| `src/content/paths/paths.service.ts` | Primary consumer |
| `src/content/courses/courses.service.ts` | Also imports from here |

---

## 6. Things NOT to change without coordination

- The `avatarUrl → authorAvatar` and `content → body` renames.
  The frontend hard-codes the DTO names.
- Omitting `status` from the testimonial DTO. Leaking it would
  let a client detect pending/hidden state on non-approved rows
  (which should never reach here, but defense in depth).
- The cross-module import from `courses.service.ts`. Relocating
  the file is a two-import refactor.
