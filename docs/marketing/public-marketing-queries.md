# PublicMarketingQueries — Backend Reference (awamer-api)

> **Class:** `PublicMarketingQueries`
> **Source:** `src/content/marketing/helpers/public-queries.helper.ts`
> **Used by:** `PathsService.findDetailBySlug`, `CoursesService.findDetailBySlug`

Read-only query helpers for fetching marketing content attached
to a given path or course. Imported by the public discovery
services (KAN-26) to avoid having them poke at the marketing
tables directly.

---

## 1. Public API

```ts
async getFeaturesByOwner(ownerType, ownerId):                Promise<Feature[]>
async getFaqsByOwner(ownerType, ownerId):                    Promise<Faq[]>
async getApprovedTestimonialsByOwner(ownerType, ownerId):    Promise<Testimonial[]>
```

Each method does exactly one `findMany` with the right
`ownerType`/`ownerId` filter and ordering.

---

## 2. Ordering

All three queries sort by `[{ order: 'asc' }, <tiebreaker>]`. The
tiebreaker differs:

- **Features, FAQs:** `{ id: 'asc' }`. Neither model has a
  `createdAt` column (schema frozen by KAN-70), so there is
  nothing else to break ties on. Alphabetic id is stable and
  unambiguous.
- **Testimonials:** `{ createdAt: 'asc' }`. `Testimonial` has a
  `createdAt` column, and the literal spec in KAN-72 §3
  specifies creation order as the tiebreaker.

Do not "harmonize" the three tiebreakers — the difference is
intentional.

---

## 3. `getApprovedTestimonialsByOwner` — the status filter

```ts
prisma.testimonial.findMany({
  where: { ownerType, ownerId, status: TestimonialStatus.APPROVED },
  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
});
```

Only `APPROVED` testimonials are returned. `PENDING` testimonials
are invisible to the public (they have been submitted but an
admin has not approved them yet). `HIDDEN` testimonials are
invisible (admin has actively rejected them). This filter is the
entire reason the three public-query methods are not a single
generic helper — the feature and FAQ queries have no status
filter because neither model carries one.

---

## 4. What it does not do

- **Does not** validate that the owner exists. The caller (
  `PathsService.findDetailBySlug` / `CoursesService.findDetailBySlug`)
  has already loaded the path/course before calling into here.
  Validating twice would be redundant DB work.
- **Does not** cache. The caller caches the entire detail DTO at
  a higher layer (`paths:detail:<slug>` / `courses:detail:<slug>`
  via `CacheService`). Caching the intermediate marketing rows
  would be redundant.
- **Does not** filter on path/course status. An admin can attach
  marketing to a draft path; if the public discovery query ever
  surfaces a draft path, it will get the marketing too. The
  discovery services handle the `PUBLISHED` filter at the path/
  course level.

---

## 5. Parallelism at the call site

`PathsService.findDetailBySlug` and `CoursesService.findDetailBySlug`
call the three methods in parallel via `Promise.all`:

```ts
const [features, faqs, testimonials] = await Promise.all([
  this.marketing.getFeaturesByOwner(MarketingOwnerType.PATH, path.id),
  this.marketing.getFaqsByOwner(MarketingOwnerType.PATH, path.id),
  this.marketing.getApprovedTestimonialsByOwner(MarketingOwnerType.PATH, path.id),
]);
```

Decision B / FR-023 in the source comment. The three queries are
independent, the DB is fine with concurrent reads, and the
latency win is ~2x on the marketing step.

---

## 6. Tests

| File | Covers |
|------|--------|
| (no dedicated spec) | `PublicMarketingQueries` is exercised transitively by `PathsService` / `CoursesService` specs and by the content e2e suite. A direct unit spec is not necessary because the class is three one-liner Prisma queries. |

---

## 7. Files involved

| File | Role |
|------|------|
| `src/content/marketing/helpers/public-queries.helper.ts` | The class |
| `src/content/paths/paths.service.ts` | Caller — `findDetailBySlug` |
| `src/content/courses/courses.service.ts` | Caller — `findDetailBySlug` |
| `src/content/marketing/marketing.module.ts` | Provider registration + export |

---

## 8. Things NOT to change without coordination

- The `APPROVED`-only filter on testimonials. Leaking pending or
  hidden testimonials to the public is a content moderation bug.
- The per-model tiebreakers. See §2.
- The "no owner existence check" decision. Callers already have
  the row in hand; duplicating the check here would be pointless
  DB work on a hot path.
- The "no caching" decision. Caching here would compete with the
  caller-level detail cache and add invalidation complexity.
