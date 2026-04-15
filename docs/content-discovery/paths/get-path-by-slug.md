# Get Path by Slug — Backend Spec (awamer-api)

> **Module:** `PathsModule`
> **Endpoint:** `GET /api/v1/paths/:slug`
> **Decorator:** `@Public()`
> **Status code:** `200 OK`

---

## 1. Summary

Public detail endpoint for a single path. Returns the full
curriculum (courses → sections → lessons), the path's marketing
content (features, FAQs, approved testimonials), and a derived
`certificate` block. Cache-aside on `paths:detail:<slug>` with
no expiry (invalidated by mutation).

---

## 2. Request

```
GET /api/v1/paths/:slug
```

`:slug` is the unique slug column on `paths`. No query
parameters. No auth.

---

## 3. Behavior — `PathsService.findDetailBySlug(slug)`

Source: `src/content/paths/paths.service.ts` `findDetailBySlug()`.

1. **Cache key** — `CacheKeys.paths.detail(slug)`.
2. **Cache read** — hit → return.
3. **Load path** via `findUnique({ where: { slug }, include: ... })`
   — full deep include of `category`, `tags`, `courses` (filtered
   to `PUBLISHED`, with their sections and lessons), and
   per-course project count.
4. **404 guard:**
   ```ts
   if (!path || path.status !== PathStatus.PUBLISHED)
     throw new NotFoundException(`Path with slug "${slug}" not found`);
   ```
   Both "no such slug" and "slug exists but is `DRAFT`/`ARCHIVED`"
   collapse to the same 404 — a draft path is invisible to public
   consumers.
5. **Parallel marketing composition** — `Promise.all` on three
   helper calls:
   ```ts
   marketing.getFeaturesByOwner(PATH, path.id),
   marketing.getFaqsByOwner(PATH, path.id),
   marketing.getApprovedTestimonialsByOwner(PATH, path.id),
   ```
   Decision B / FR-023 — see
   [../../marketing/public-marketing-queries.md](../../marketing/public-marketing-queries.md).
6. **`isFree` override** — if `path.isFree === true`, call
   `applyIsFreeOverride(path)` from
   [path-stats-helper.md](./path-stats-helper.md) to mutate every
   nested `lesson.isFree` to `true`. This is the API Design §5.4
   "free path makes everything under it free" rule.
7. **Compute stats** via `computePathStats(path)`.
8. **Map to DTO** via `toPathDetailDto(path, marketing, stats)` —
   see [path-mapper.md](./path-mapper.md).
9. **Cache write** — `cache.set(key, dto, CacheTTL.DETAIL)` with
   `CacheTTL.DETAIL = null` (no expiry).
10. **Return** the DTO.

---

## 4. Response shape (abridged)

```json
{
  "data": {
    "path": {
      "id": "uuid",
      "slug": "cybersecurity-foundations",
      "title": "Cybersecurity Foundations",
      "subtitle": "...",
      "description": "...",
      "level": "beginner",
      "thumbnail": "https://...",
      "promoVideo": { "url": "https://...", "thumbnail": "https://..." },
      "isFree": false,
      "isNew": true,
      "status": "PUBLISHED",
      "skills": ["networking", "iam"],
      "category": { "id": "...", "name": "...", "slug": "..." },
      "tags": [ ... ],
      "stats": { "courseCount": 4, "lessonCount": 45, "totalDurationMinutes": 900, "projectCount": 3 },
      "certificate": { "enabled": true, "requiresAwamerPlus": true, "text": "أكمل جميع دورات المسار للحصول على شهادة معتمدة" }
    },
    "curriculum": [
      {
        "id": "uuid",
        "slug": "foundations",
        "order": 0,
        "title": "Foundations",
        "subtitle": "...",
        "description": "...",
        "isFree": false,
        "stats": { "sectionCount": 5, "lessonCount": 12, "totalDurationMinutes": 240 },
        "sections": [
          { "id": "...", "title": "...", "order": 0, "lessons": [ { "id": "...", "title": "...", "type": "VIDEO", "order": 0, "estimatedMinutes": 10, "isFree": false } ] }
        ]
      }
    ],
    "features": [ ... ],
    "faqs": [ ... ],
    "testimonials": [ ... ]
  },
  "message": "Success"
}
```

The `certificate` block is derived, not stored — see
[path-mapper.md](./path-mapper.md) for the fixed text constant
(`PATH_CERTIFICATE_TEXT`) that drives it.

---

## 5. Error responses

| Status | When |
|--------|------|
| `404`  | `Path with slug "${slug}" not found` — unknown slug OR the path is not `PUBLISHED`. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Prisma error. |

---

## 6. Cache behavior

| Key | Format | TTL | Invalidated by |
|-----|--------|-----|----------------|
| `paths:detail:<slug>` | literal suffix | `null` (`CacheTTL.DETAIL`) | `CacheService.invalidateOwner('path', id)` via marketing mutations (`paths:detail:*` pattern delete). See [../../cache/invalidation-flow.md](../../cache/invalidation-flow.md). |

No automatic invalidation on path edits yet — there is no admin
paths CRUD module. When it lands, it must call
`invalidateOwner('path', pathId)` on every mutation.

---

## 7. Side effects

Cache write on miss. No DB writes.

---

## 8. Files involved

| File | Role |
|------|------|
| `src/content/paths/paths.controller.ts` | `findBySlug()` handler |
| `src/content/paths/paths.service.ts` | `findDetailBySlug()` |
| `src/content/paths/path-stats.helper.ts` | `computePathStats`, `applyIsFreeOverride` |
| `src/content/paths/path-mapper.ts` | `toPathDetailDto`, `buildPathCertificate` |
| `src/content/paths/marketing-mapper.ts` | `toFeatureDto` / `toFaqDto` / `toTestimonialDto` |
| `src/content/marketing/helpers/public-queries.helper.ts` | The three marketing loads |

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/content/paths/paths.service.spec.ts` | Cache hit/miss, 404 on missing slug AND on non-published slug, `isFree` override cascades to nested lessons, marketing composition via `Promise.all`, stats match the topology. |
| `src/content/paths/path-mapper.spec.ts` | Every field of `toPathDetailDto`, `buildPathCertificate`, `normalizeLevel` branches. |
| `test/content/paths/*.e2e-spec.ts` | End-to-end detail response, 404 paths. |

---

## 10. Things NOT to change without coordination

- The "draft path → 404" rule. Returning the draft shape with a
  hidden status would leak unpublished content.
- The `Promise.all` over three marketing queries. Sequential
  would double the marketing latency on a cache miss.
- The `applyIsFreeOverride` call on `isFree` paths. The frontend
  renders "free" badges on every nested lesson based on
  `lesson.isFree`.
- The `null` TTL on `paths:detail:*`. The detail cache is
  invalidated on every owner-affecting mutation; a TTL would
  just add noise.
- The fixed `PATH_CERTIFICATE_TEXT` constant. It is marked TODO
  in the source — see [path-mapper.md](./path-mapper.md) §1 —
  and will become a per-row column when the schema gains
  certificate configuration.
