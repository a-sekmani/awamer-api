# Get Course by Slug — Backend Spec (awamer-api)

> **Module:** `CoursesModule`
> **Endpoint:** `GET /api/v1/courses/:slug`
> **Decorator:** `@Public()`
> **Status code:** `200 OK`

---

## 1. Summary

Public detail endpoint for a single course. Returns the course
core, its parent path (if any), curriculum (sections + lessons),
marketing content (features, FAQs, approved testimonials), and
a derived `certificate` block. Cache-aside on
`courses:detail:<slug>` with no expiry.

Mirrors [../paths/get-path-by-slug.md](../paths/get-path-by-slug.md)
with the course shape.

---

## 2. Request

```
GET /api/v1/courses/:slug
```

`:slug` is the unique slug on `courses`. No auth, no query params.

---

## 3. Behavior — `CoursesService.findDetailBySlug(slug)`

Source: `src/content/courses/courses.service.ts`
`findDetailBySlug()`.

1. **Cache key** — `CacheKeys.courses.detail(slug)`.
2. **Cache read** — hit → return.
3. **Load course** via `findUnique({ where: { slug }, include })`
   with deep nesting:
   - `category`, `path` (the parent, may be `null`), `tags`,
     `sections` (ordered by `order`, with lessons ordered by
     `order`), and `_count.projects`.
4. **404 guard:**
   ```ts
   if (!course || course.status !== CourseStatus.PUBLISHED)
     throw new NotFoundException(`Course with slug "${slug}" not found`);
   ```
   Draft courses are invisible, same as paths.
5. **Parallel marketing composition** on
   `MarketingOwnerType.COURSE, course.id`:
   ```ts
   Promise.all([
     marketing.getFeaturesByOwner(COURSE, course.id),
     marketing.getFaqsByOwner(COURSE, course.id),
     marketing.getApprovedTestimonialsByOwner(COURSE, course.id),
   ]);
   ```
6. **`isFree` override** — if `course.isFree === true`, call the
   course-shaped branch of `applyIsFreeOverride(course)` (same
   helper as paths — see
   [../paths/path-stats-helper.md §2](../paths/path-stats-helper.md)).
7. **Compute stats** via `computeCourseStats(course)`.
8. **Map** via `toCourseDetailDto(course, marketing, stats)`.
9. **Cache write** with `CacheTTL.DETAIL` (`null`).
10. **Return** the DTO.

Note: step 6 only overrides `lesson.isFree`. It does **not**
override the parent path's `isFree` for a path-owned course —
the constitutional cascade on `ContentAccessGuard` (see
[../../learning/content-access-guard.md](../../learning/content-access-guard.md))
already handles the Path rung there.

---

## 4. Response shape (abridged)

```json
{
  "data": {
    "course": {
      "id": "uuid",
      "slug": "intro-sql",
      "title": "Intro to SQL",
      "subtitle": "...",
      "description": "...",
      "level": "beginner",
      "thumbnail": "https://...",
      "isFree": true,
      "isNew": false,
      "status": "PUBLISHED",
      "skills": ["sql", "data"],
      "category": { "id": "...", "name": "Databases", "slug": "databases" },
      "parentPath": { "id": "...", "slug": "data-engineering", "title": "Data Engineering" },
      "tags": [ ... ],
      "stats": { "sectionCount": 4, "lessonCount": 12, "totalDurationMinutes": 180, "projectCount": 1 },
      "certificate": { "enabled": true, "requiresAwamerPlus": false, "text": "أكمل الدورة للحصول على شهادة معتمدة" }
    },
    "curriculum": [
      {
        "id": "uuid",
        "title": "Basics",
        "order": 0,
        "lessons": [
          { "id": "...", "title": "...", "type": "VIDEO", "order": 0, "estimatedMinutes": 10, "isFree": true }
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

`parentPath` is `null` for standalone courses. The
`certificate.text` is a different fixed constant from the path
version — see [course-mapper.md](./course-mapper.md).

---

## 5. Error responses

| Status | When |
|--------|------|
| `404`  | `Course with slug "${slug}" not found`. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Prisma error. |

---

## 6. Cache behavior

| Key | Format | TTL | Invalidated by |
|-----|--------|-----|----------------|
| `courses:detail:<slug>` | literal suffix | `null` | `CacheService.invalidateOwner('course', id)` via marketing mutations (pattern delete on `courses:detail:*`). See [../../cache/invalidation-flow.md](../../cache/invalidation-flow.md). |

---

## 7. Side effects

Cache write on miss. No DB writes.

---

## 8. Files involved

| File | Role |
|------|------|
| `src/content/courses/courses.controller.ts` | `findBySlug()` handler |
| `src/content/courses/courses.service.ts` | `findDetailBySlug()` |
| `src/content/courses/course-stats.helper.ts` | `computeCourseStats`, `applyIsFreeOverride` (re-exported from paths) |
| `src/content/courses/course-mapper.ts` | `toCourseDetailDto`, `buildCourseCertificate` |
| `src/content/paths/marketing-mapper.ts` | `toFeatureDto` / `toFaqDto` / `toTestimonialDto` (shared) |
| `src/content/marketing/helpers/public-queries.helper.ts` | Marketing loads |

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/content/courses/courses.service.spec.ts` | Cache hit/miss, 404 paths, `isFree` override behavior, marketing parallelism, parent-path vs standalone shapes. |
| `src/content/courses/course-mapper.spec.ts` | Every field of `toCourseDetailDto`, `buildCourseCertificate`, standalone vs path-owned `parentPath`. |
| `test/content/courses/*.e2e-spec.ts` | End-to-end detail response, 404 paths, parent-path and standalone variants. |

---

## 10. Things NOT to change without coordination

- The "draft course → 404" rule.
- The `Promise.all` marketing composition.
- The shared `applyIsFreeOverride` import (from
  `path-stats.helper.ts`). The function is polymorphic on the
  shape — see [../paths/path-stats-helper.md §2](../paths/path-stats-helper.md).
- The `null` TTL.
- The `COURSE_CERTIFICATE_TEXT` constant — see
  [course-mapper.md](./course-mapper.md).
