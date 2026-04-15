# Feature Specification: Public Discovery Endpoints (Categories, Paths, Courses)

**Feature Branch**: `013-public-discovery`
**Created**: 2026-04-15
**Status**: Draft
**Source ticket**: `docs/tickets/KAN-26.md`

---

## Clarifications

### Session 2026-04-15

- Q: Where does `path.certificate` / `course.certificate` data come from given the schema is frozen and has no certificate-config columns? → A: Hardcoded constants in the mappers, separate constant per type. `enabled = true`, `requiresAwamerPlus = !isFree`, `text` is a per-type Arabic constant. Follow-up ticket replaces with per-row reads when schema columns are added.
- Q: How should pagination tiebreaker be handled when multiple list rows share the same `sort` value (e.g., all `order = 0`)? → A: Always append `{ id: 'asc' }` as the secondary sort in `buildOrderBy(query)` for every list endpoint, regardless of the user's `sort` choice. Guarantees deterministic page-to-page row ordering. Mirrors FR-030 curriculum convention.

---

## Overview

Build the public-facing discovery API serving anonymous Home, Discovery listing, Path detail, and Course detail pages. Five new endpoints (a sixth — `GET /tags` — already exists from KAN-71 and is verification-only). All endpoints are public, aggressively cached via the KAN-74 `CacheService`, and return SSR-ready payloads in a single request to avoid N+1 waterfalls. This is a **composition ticket**: it consumes existing helpers from KAN-71, KAN-72, and KAN-74 and authors no new infrastructure.

---

## Audit findings (re-verified against current `master`)

The §2 audit from KAN-26 was re-run as a spot-check before spec generation. All facts from §2.1 still hold:

- ✅ `TagsService.listPublic()` present at `src/content/tags/tags.service.ts:31`.
- ✅ `PublicMarketingQueries` exposes three separate methods (`getFeaturesByOwner`, `getFaqsByOwner`, `getApprovedTestimonialsByOwner`); **no** combined `findForOwner()` method exists.
- ✅ `CacheKeys.{categories.all, paths.list/detail/listPattern/detailPattern, courses.list/detail/listPattern/detailPattern}` already exported from KAN-74.
- ✅ `CacheTTL.{CATEGORIES: null, LIST: 300, DETAIL: null}` already exported (generic names — Decision E says use as-is).
- ✅ `CacheService.{get, set, del, delByPattern, invalidateOwner, slugFor}` all present.
- ✅ `ResponseTransformInterceptor` registered globally in `app.module.ts:114`.
- ✅ Prisma models `Category`, `Path`, `Course`, `Section`, `Lesson` exist with the fields referenced in this spec.
- ✅ `Course.slug @unique` (globally unique).
- ✅ `MarketingOwnerType` enum has `PATH` and `COURSE`.
- ✅ `src/content/{categories,paths,courses}/` directories do **not** exist — clean slate.
- 🚧 `src/paths/{paths.controller,paths.module,paths.service}.ts` legacy stub still exists with `@Controller('paths')` and an empty `findAll()`. **Decision A applies** — must be deleted as the FIRST task.

All operator decisions A–F (KAN-26 §2.2) are baked into this spec.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Anonymous visitor browses the catalog (Priority: P1)

A prospective learner without an account lands on the public Home or Discovery page, sees active categories with path/course counts, and browses published paths and standalone courses with filters (category, tag, level, search) and pagination.

**Why this priority**: Front door of the product. Without it, no one can discover content. Directly drives conversion.

**Independent Test**: Hit `GET /api/v1/categories`, `GET /api/v1/paths`, and `GET /api/v1/courses` without an `Authorization` header. Verify documented shape, filter correctness, and cache hit on the second call.

**Acceptance Scenarios**:

1. **Given** 3 active categories, 5 published paths, 8 published courses, **When** the visitor calls `GET /api/v1/categories`, **Then** the response returns 3 categories ordered by `order asc`, each with correct `pathCount` and `courseCount`.
2. **Given** 12 published paths in 2 categories, **When** the visitor calls `GET /api/v1/paths?categoryId=<X>&limit=5&page=1`, **Then** the response returns the first 5 paths in category X with correct `meta.{total,page,limit,totalPages}`.
3. **Given** the visitor calls `GET /api/v1/paths?search=cyber`, **When** any path's title or subtitle contains "cyber" (case-insensitive), **Then** it appears in the results.
4. **Given** the visitor calls `GET /api/v1/courses?standalone=true&pathId=<X>`, **Then** the API returns 400 with `Cannot supply both pathId and standalone`.
5. **Given** any list endpoint is called twice with identical query parameters within 5 minutes, **Then** the second request is served from Redis (database is not queried).

---

### User Story 2 — Anonymous visitor opens a Path detail page (Priority: P1)

A visitor clicks a path card and lands on the path detail page. The page must render server-side with the full curriculum (courses → sections → lessons), marketing content (features, FAQs, approved testimonials), and stats — all in a single API call.

**Why this priority**: Conversion page. A waterfall of 5+ requests on every cold visit would cripple SSR latency.

**Independent Test**: Call `GET /api/v1/paths/{slug}` for a published path. Verify the response contains `path`, `curriculum`, `features`, `faqs`, `testimonials` in one payload, and that a second call within the cache window does not hit the database.

**Acceptance Scenarios**:

1. **Given** a published path with 3 courses, each having 2 sections of 4 lessons, **When** the visitor calls `GET /api/v1/paths/{slug}`, **Then** the response contains the full nested curriculum sorted by `Course.order`, `Section.order`, `Lesson.order`.
2. **Given** the path has `isFree = true`, **When** the response is built, **Then** every nested lesson's `isFree` flag is `true` regardless of the lesson's stored value.
3. **Given** marketing content scoped to `(ownerType=PATH, ownerId=<path.id>)`, **Then** `features`, `faqs`, and `testimonials` are populated with `status='approved'` testimonials only, ordered by `order asc`.
4. **Given** a slug that does not exist OR exists with `status != PUBLISHED`, **Then** the API returns 404 with `Path with slug "<slug>" not found`.
5. **Given** the response is cached, **When** the same slug is requested again, **Then** the second call reads from Redis in `< 20ms`.

---

### User Story 3 — Anonymous visitor opens a Course detail page (Priority: P2)

Same as US2 but for a course (which may be standalone or attached to a path). Curriculum tree is `Section[]` (one level shallower than Path).

**Why this priority**: P2 because standalone courses are a smaller catalog fraction in the MVP, but the endpoint is required for navigation.

**Independent Test**: Call `GET /api/v1/courses/{slug}` for a published course. Verify shape, `parentPath` field (null when standalone), and section/lesson ordering.

**Acceptance Scenarios**:

1. **Given** a standalone published course (`pathId IS NULL`), **Then** `parentPath` is `null`.
2. **Given** a course attached to a published path, **Then** `parentPath` is `{ id, slug, title }`.
3. **Given** the course has `isFree = true`, **Then** every lesson's `isFree` is `true`.
4. **Given** the course slug exists but `status != PUBLISHED`, **Then** the API returns 404.

---

### Edge Cases

- Page numbers beyond `totalPages` return `data: []` with correct meta — never 404.
- Empty result sets return `data: []` and `meta.totalPages = 0` — never error.
- A published path with zero published courses returns `curriculum: []` and zeroed stats.
- Cache layer failures (Redis unreachable) are caught silently inside `CacheService` and the request falls through to the database.
- `tagId` filter with a non-existent UUID returns an empty list, not 404.
- Categories with `status != ACTIVE` are excluded from `GET /categories` and from path/course count aggregations.
- Default-only requests (no query params) collapse to a single canonical cache key per endpoint.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Endpoints

- **FR-001**: System MUST expose `GET /api/v1/categories` returning all `ACTIVE` categories ordered by `order asc`, each with `pathCount` and `courseCount` (counts of `PUBLISHED` paths/courses).
- **FR-002**: System MUST expose `GET /api/v1/paths` returning a paginated list of `PUBLISHED` paths supporting filters `categoryId`, `tagId`, `level`, `search`, `sort`, `order`, `page`, `limit`.
- **FR-003**: System MUST expose `GET /api/v1/paths/:slug` returning the full path detail payload (path core + curriculum + features + faqs + approved testimonials) for a `PUBLISHED` path in a single response.
- **FR-004**: System MUST expose `GET /api/v1/courses` returning a paginated list of `PUBLISHED` courses, supporting all path filters plus `pathId` and `standalone` (mutually exclusive).
- **FR-005**: System MUST expose `GET /api/v1/courses/:slug` returning the full course detail payload (course core + curriculum + features + faqs + approved testimonials + `parentPath`) for a `PUBLISHED` course in a single response.
- **FR-006**: All five endpoints MUST be public — no `JwtAuthGuard`, no `RolesGuard`, no `Authorization` header required.
- **FR-007**: All five endpoints MUST honor the existing app-level throttler (default 100/min). No per-endpoint override.

#### Filters & validation

- **FR-008**: `?level=` MUST be validated against the canonical lowercase enum `['beginner', 'intermediate', 'advanced']`; invalid values return 400.
- **FR-009**: `?search=` MUST be a 1–100 character trimmed string; the database query MUST use case-insensitive `ILIKE %search%` against `title` AND `subtitle`.
- **FR-010**: `?sort=` MUST be validated against the server-controlled allowlist `['order', 'created_at', 'title']`; invalid values return 400.
- **FR-011**: `?categoryId=`, `?tagId=`, `?pathId=` MUST be validated as UUID v4; invalid values return 400.
- **FR-012**: `?page=` MUST be `>= 1` and `<= 1000`; `?limit=` MUST be `>= 1` and `<= 100`.
- **FR-013**: Supplying both `?pathId` and `?standalone=true` to `GET /courses` MUST return 400 with `Cannot supply both pathId and standalone`.

#### Pagination

- **FR-014**: List responses MUST include `meta: { total, page, limit, totalPages }` where `totalPages = Math.ceil(total / limit)`.
- **FR-015**: A page number beyond `totalPages` MUST return `data: []`, NOT 404.
- **FR-016**: Empty result sets MUST return `data: []` and `meta.totalPages = 0`.

#### Caching

- **FR-017**: Each list endpoint MUST compute a deterministic 16-character query hash from a canonical, sorted-key, default-omitting representation of the query parameters and use it as the cache key suffix.
- **FR-018**: Each read endpoint MUST follow the cache-aside pattern: check Redis first via `CacheService.get`; on miss, query the database, fully assemble the DTO, then `CacheService.set` before returning.
- **FR-019**: List endpoints MUST cache with `CacheTTL.LIST` (5 minutes). Detail and `/categories` endpoints MUST cache with `CacheTTL.DETAIL` / `CacheTTL.CATEGORIES` (both `null` — invalidated only on mutation).
- **FR-020**: This ticket MUST NOT modify `src/common/cache/cache-keys.ts` or any other file under `src/common/cache/**` (frozen — Decision E). All key builders and TTL constants needed already exist.
- **FR-021**: This ticket MUST NOT add invalidation calls to admin services. KAN-74 already wired the 18-marker invalidation sweep. Implementation MUST verify (in spot-check) that `paths:list:*`, `paths:detail:*`, `courses:list:*`, `courses:detail:*` are covered by existing `TagsService` and marketing service mutations. If any gap is found for a key this ticket consumes, STOP and ask — do not silently add calls in frozen modules.
- **FR-022**: `CategoriesService` MUST include a top-of-file TODO comment per Decision F documenting the manual-invalidation gap until an admin Categories CRUD module is built.

#### Marketing composition

- **FR-023**: `PathsService.findDetailBySlug` and `CoursesService.findDetailBySlug` MUST call `PublicMarketingQueries.getFeaturesByOwner`, `getFaqsByOwner`, and `getApprovedTestimonialsByOwner` **in parallel** via `Promise.all` (Decision B — Option 1, frozen-safe). They MUST NOT add a combined `findForOwner()` method to the marketing helper.

#### Response shape

- **FR-024**: `CategoryResponseDto` MUST contain exactly: `id`, `name`, `slug`, `description`, `icon`, `order`, `pathCount`, `courseCount`.
- **FR-025**: `PathSummaryDto` MUST contain `id`, `slug`, `title`, `subtitle`, `level` (normalized), `thumbnail`, `category`, `tags`, `isFree`, `isNew`, `stats: { courseCount, lessonCount, totalDurationMinutes }`.
- **FR-026**: `PathDetailDto` MUST match KAN-26 §7.3 verbatim, including `path.certificate`, `path.promoVideo`, `path.skills`, `path.stats.projectCount`, and the nested `curriculum`. The `certificate` object is built by `buildPathCertificate({ isFree })` in `path-mapper.ts`: `{ enabled: true, requiresAwamerPlus: !path.isFree, text: PATH_CERTIFICATE_TEXT }` where `PATH_CERTIFICATE_TEXT = 'أكمل جميع دورات المسار للحصول على شهادة معتمدة'`. A `TODO(KAN-?-certificate-config)` comment above the constant documents the future schema-column migration.
- **FR-027**: `CourseSummaryDto` and `CourseDetailDto` MUST mirror Path DTOs per KAN-26 §7.4, with `parentPath` instead of nested course curriculum, and `stats.projectCount` scoped to the single course. The `certificate` object is built by `buildCourseCertificate({ isFree })` in `course-mapper.ts`: `{ enabled: true, requiresAwamerPlus: !course.isFree, text: COURSE_CERTIFICATE_TEXT }` where `COURSE_CERTIFICATE_TEXT = 'أكمل الدورة للحصول على شهادة معتمدة'`. A `TODO(KAN-?-certificate-config)` comment above the constant documents the future schema-column migration.
- **FR-028**: When `path.isFree = true` (or `course.isFree = true`), the DTO mapper MUST set every nested `lesson.isFree = true` regardless of the stored lesson value (design rule from API Design §5.4).
- **FR-029**: `Path.level` (stored as `String?`) MUST be normalized in the DTO mapper via `normalizeLevel()`: lowercase, return value if it matches one of `['beginner', 'intermediate', 'advanced']`, else return `null`. `Course.level` is enum-backed and only needs lowercasing.
- **FR-030**: Curriculum ordering MUST be `Course.order asc, Course.id asc`, `Section.order asc`, `Lesson.order asc`. Tags MUST be ordered by `tag.name asc`. Marketing items MUST be ordered by `order asc`.
- **FR-030a**: Every list endpoint's `orderBy` array MUST end with `{ id: 'asc' }` regardless of the user-supplied `sort` parameter. This guarantees deterministic row ordering across pages when primary sort values tie (e.g., multiple rows with `order = 0`). Implemented in `buildOrderBy(query)` for both Paths and Courses. Unit tests MUST cover the default query, `?sort=title&order=desc`, and `?sort=created_at&order=desc` cases. An e2e test MUST seed ≥5 rows sharing the same `order` value, request `?page=1&limit=2` and `?page=2&limit=2`, and assert no overlap, no missing rows, and identical ordering on re-request.

#### Error handling

- **FR-031**: A slug that does not exist OR exists with `status != PUBLISHED` MUST return 404 via `NotFoundException` with the message `Path with slug "<slug>" not found` (or course equivalent).
- **FR-032**: Cache layer failures MUST NOT surface to the client — `CacheService` swallows errors and the request falls through to the database.

#### Module wiring & cleanup

- **FR-033**: The legacy stub at `src/paths/{paths.controller,paths.module,paths.service}.ts` MUST be deleted in its entirety (Decision A) and its `PathsModule` import removed from `src/app.module.ts` BEFORE any new `src/content/paths/` code is added.
- **FR-034**: New `CategoriesModule`, `PathsModule`, and `CoursesModule` MUST be created under `src/content/` and registered with the existing `ContentModule` umbrella.

#### Testing

- **FR-035**: Service unit test coverage. `PathsService` and `CoursesService` MUST have unit tests covering: cache hit path (no Prisma call), cache miss path (Prisma + `cache.set` called), 404 on missing/unpublished slug, `isFree` override correctness, parallel marketing call assertion (`Promise.all` with three calls). `CategoriesService` MUST have the same tests except the parallel marketing assertion (it makes no marketing calls). The `normalizeLevel` helper is unit-tested separately in `path-stats.helper.spec.ts` (T008), not in service specs.
- **FR-036**: Each new endpoint MUST have an e2e test covering: shape, public access (no Authorization), pagination meta, every supported filter, 400 on `pathId`+`standalone` collision (courses only), 404 on missing/draft slug, cache hit/miss assertion, cold/warm latency budget.
- **FR-037**: All four existing test suites (`npm test`, `npm run test:schema`, `npm run test:content:e2e`, `npm run test:e2e`) MUST remain green after this ticket.
- **FR-038**: New e2e specs MUST add `await redis.flushdb()` in `beforeEach` after DB truncation (lesson from KAN-74).

### Key Entities

- **Category**: name, slug (unique), description, icon, order, status (active/hidden). Aggregates `pathCount` and `courseCount` for the listing endpoint.
- **Path**: title, slug (unique), subtitle, description, level (free-form String? — see Known Limitations), thumbnail, promoVideoUrl, promoVideoThumbnail, skills (JSON), isNew, isFree, status (draft/published/archived), order. Belongs to a Category. Has many Courses.
- **Course**: title, slug (globally unique), subtitle, description, level (enum), thumbnail, skills, isNew, isFree, status, order. Belongs to a Category and optionally a Path. Has many Sections and Projects.
- **Section**: title, description, order. Belongs to a Course. Has many Lessons.
- **Lesson**: title, type (text/video/interactive/mixed), order, isFree, estimatedMinutes. Belongs to a Section.
- **Tag**: read via existing `TagsService.listPublic`. Joined to Path/Course via `path_tags` / `course_tags`.
- **Feature / Faq / Testimonial**: read via existing `PublicMarketingQueries`. Scoped by `(ownerType, ownerId)`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Anonymous visitors can load the discovery listing page in under 300ms on a cold cache and under 20ms on a warm cache (full payload, 20 items per page).
- **SC-002**: Anonymous visitors can load any path or course detail page in under 200ms on a cold cache and under 20ms on a warm cache (full SSR payload in a single request).
- **SC-003**: After the cache is warm, ≥95% of read traffic is served from Redis.
- **SC-004**: Detail pages return the complete payload (core + full curriculum + features + faqs + testimonials) in exactly one HTTP request.
- **SC-005**: All five new endpoints reject malformed inputs with 400 and unknown slugs with 404 — no 500s leak under valid input.
- **SC-006**: All four existing test suites remain green; new suites add at least 30 unit tests and three e2e specs (one per resource).

---

## Assumptions

- The MVP dataset size is small enough that the absence of composite indexes (Decision C) does not breach the cold-cache budgets. If post-deployment monitoring shows otherwise, a follow-up ticket adds the indexes.
- `Path.level` data integrity is maintained by application convention (admin tools write canonical values). Schema-level enforcement is deferred (Decision D).
- KAN-74's invalidation sweep correctly covers `paths:list:*`, `paths:detail:*`, `courses:list:*`, `courses:detail:*`. The implementation spot-check verifies this; if a gap is found, the operator decides how to fill it.
- The `ResponseTransformInterceptor` correctly wraps both single-item (`{ data }`) and paginated (`{ data, meta }`) payloads.
- The default app-level throttler (100/min) is sufficient for public discovery endpoints.
- The existing `ContentModule` umbrella imports child modules and only needs to register the three new ones.

---

## Known limitations

These three limitations are intentional outcomes of operator decisions C, D, and F. They MUST appear verbatim in this spec:

1. **Composite query indexes deferred** (Decision C): Composite indexes `[pathId, status, order]` on Course and `[status, order]` on Path are NOT added in this ticket. The cache layer absorbs >95% of read traffic. If post-deployment monitoring shows hot DB hits with seq scans, add the indexes via a follow-up ticket (`KAN-26-followup-indexes`).

2. **Path.level type inconsistency** (Decision D): `Path.level` is stored as `String?` while `Course.level` is enum-backed. The `?level=` query filter validates against the canonical three values, and the response is normalized via `normalizeLevel()`. Stored data integrity is not enforced at the schema level. Migration to enum is deferred.

3. **Certificate metadata is mapper-computed, not DB-backed** (Clarification 2026-04-15): The `certificate` object on path/course detail responses is computed at the mapper layer rather than read from the database, because the Prisma schema has no certificate-config columns and is frozen for this ticket. `enabled` is hardcoded to `true` (every published path/course grants a certificate per KAN-73 policy), `requiresAwamerPlus` mirrors `!isFree`, and `text` is a per-type Arabic constant (`PATH_CERTIFICATE_TEXT` / `COURSE_CERTIFICATE_TEXT`). A follow-up ticket can add schema columns and replace the constants with per-row reads.

4. **Categories cache invalidation is manual** (Decision F): No admin Categories CRUD module exists yet. After manual DB changes to categories, the operator must `redis-cli DEL categories:all` (or restart the app) for changes to be visible. Admin Categories CRUD is a separate ticket.

---

## Out of scope

- Admin CRUD endpoints for Categories, Paths, Courses, Sections, Lessons (separate tickets).
- Composite database indexes (deferred — Decision C).
- Migrating `Path.level` to an enum (deferred — Decision D).
- Adding a combined `findForOwner()` method to `PublicMarketingQueries` (frozen — Decision B).
- Modifying any file under `src/common/cache/**` (frozen — Decision E).
- Any change to `prisma/schema.prisma` or migrations (frozen — KAN-26 §14).
- Per-endpoint throttle overrides.
- Popularity sort, price filters, full-text search (deferred to follow-up tickets).
