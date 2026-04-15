# Tasks: Public Discovery Endpoints (KAN-26)

**Branch**: `013-public-discovery`
**Spec**: `./spec.md`
**Plan**: `./plan.md`
**Source ticket**: `docs/tickets/KAN-26.md`

Conventions: `[P]` = parallelizable (different files, no dependencies on incomplete tasks). `[USn]` = belongs to User Story n. Setup, Foundational, Polish, and Verification phases have no story label.

This tasks list incorporates Decisions A–F from KAN-26 §2.2 and the two `/speckit.clarify` answers from session 2026-04-15:
- **Clarification 1**: Hardcoded `buildPathCertificate` / `buildCourseCertificate` constants in mappers (FR-026, FR-027, Known Limitation #3).
- **Clarification 2**: `buildOrderBy` always appends `{ id: 'asc' }` as deterministic pagination tiebreaker (FR-030a).

---

## Phase 1 — Setup

- [X] T001 Delete the legacy `src/paths/` stub directory entirely (`src/paths/paths.controller.ts`, `src/paths/paths.module.ts`, `src/paths/paths.service.ts`, and the directory itself). Decision A — this MUST be the first action of the implementation phase. Rationale: the stub registers `@Controller('paths')` and would cause an ambiguous route once `src/content/paths/PathsController` is added.
- [X] T002 Remove the `PathsModule` import and the `imports: [..., PathsModule, ...]` entry from `src/app.module.ts` (the legacy one from `src/paths/paths.module.ts`). Run `npm run build` to confirm no dangling references.
- [X] T003 Spot-check audit per spec.md "Audit findings": `ls src/paths/ 2>&1` returns "No such file or directory"; `ls src/content/{categories,paths,courses}/ 2>&1` returns "No such file or directory"; `grep -n "getFeaturesByOwner\|getFaqsByOwner\|getApprovedTestimonialsByOwner" src/content/marketing/helpers/public-queries.helper.ts` shows the three methods; `grep -n "categories\|paths\|courses\|CATEGORIES\|LIST\|DETAIL" src/common/cache/cache-keys.ts` shows the existing key builders and TTL constants. STOP and report if any spot-check fails.
- [X] T004 Locate the umbrella `src/content/content.module.ts`; note its current `imports`/`exports` arrays. The three new modules (`CategoriesModule`, `PathsModule`, `CoursesModule`) will be registered in T043.

---

## Phase 2 — Foundational (blocking prerequisites for all user stories)

- [X] T005 [P] Create `src/content/paths/query-hash.helper.ts` exporting `computeQueryHash(query: Record<string, unknown>): string`. The function builds the canonical sorted-key, default-omitting object per FR-017 / KAN-26 §5.3 (drops `sort='order'`, `order='asc'`, `page=1`, `limit=20`; lowercases + trims `search`) and delegates to `CacheKeys.buildQueryHash` from `src/common/cache/cache-keys.ts` (already exported by KAN-74).
- [X] T006 [P] Create `src/content/paths/query-hash.helper.spec.ts` covering: same hash for `{categoryId:X, page:1}` vs `{page:1, categoryId:X}`; default-only query hashes to a single canonical empty key; `search='Cyber  '` and `search='cyber'` produce the same hash; explicit defaults (`page=1`) are dropped before hashing.
- [X] T007 [P] Create `src/content/paths/path-stats.helper.ts` exporting (a) `computePathStats(path)` returning `{ courseCount, lessonCount, totalDurationMinutes, projectCount }` per data-model.md; (b) `applyIsFreeOverride(path)` that mutates every nested lesson's `isFree` to `true`; (c) `normalizeLevel(value: string | null): 'beginner' | 'intermediate' | 'advanced' | null` that lowercases and validates against the canonical three values; (d) `buildOrderBy(query: ListPathsQueryDto): Prisma.PathOrderByWithRelationInput[]` that returns `[primary, { id: 'asc' }]` per FR-030a — the primary is `{ createdAt: query.order }` for `sort='created_at'`, `{ title: query.order }` for `sort='title'`, else `{ order: query.order }`.
- [X] T008 [P] Create `src/content/paths/path-stats.helper.spec.ts` covering: `normalizeLevel` cases (`'beginner'`, `'BEGINNER'`, `' Beginner '` → trimmed-and-lowercased fails the strict match → `null`, `'invalid'` → `null`, `null` → `null`); stats summing across courses/sections/lessons including a `path` with zero published courses; `applyIsFreeOverride` mutates lessons in place; `buildOrderBy` returns `[{ order: 'asc' }, { id: 'asc' }]` for default query, `[{ title: 'desc' }, { id: 'asc' }]` for `?sort=title&order=desc`, `[{ createdAt: 'desc' }, { id: 'asc' }]` for `?sort=created_at&order=desc`.
- [X] T009 [P] Create `src/content/courses/course-stats.helper.ts` exporting (a) `computeCourseStats(course)` returning `{ sectionCount, lessonCount, totalDurationMinutes, projectCount }`; (b) re-export `applyIsFreeOverride` from `path-stats.helper.ts` (the function works on any object with `isFree: boolean` and a nested lessons array shape — do NOT duplicate the implementation); (c) `buildCourseOrderBy(query: ListCoursesQueryDto): Prisma.CourseOrderByWithRelationInput[]` returning `[primary, { id: 'asc' }]` per FR-030a.
- [X] T010 [P] Create `src/content/courses/course-stats.helper.spec.ts` covering: section-only stats math, isFree override mutation on sections.lessons, `buildCourseOrderBy` cases mirroring T008 for the Course entity.
- [X] T011 [P] Create `src/content/categories/dto/category-response.dto.ts` matching `contracts/categories.md` exactly: `id`, `name`, `slug`, `description`, `icon`, `order`, `pathCount`, `courseCount`.
- [X] T012 [P] Create `src/content/paths/dto/list-paths.query.dto.ts` per FR-008–FR-012 / KAN-26 §10. Decorators from `class-validator`: `@IsOptional`, `@IsUUID(4)`, `@IsEnum`, `@IsString`, `@MinLength(1)`, `@MaxLength(100)`, `@Transform(({value}) => typeof value === 'string' ? value.trim() : value)` for `search`, `@IsInt`, `@Min(1)`, `@Max(1000)` for `page`, `@Min(1) @Max(100)` for `limit`, `@Type(() => Number)` for both numerics. Defaults: `sort='order'`, `order='asc'`, `page=1`, `limit=20`.
- [X] T013 [P] Create `src/content/paths/dto/path-summary.dto.ts` matching FR-025 / `contracts/paths.md`.
- [X] T014 [P] Create `src/content/paths/dto/path-detail.dto.ts` matching FR-026 / `contracts/paths.md` — full nested shape including `path.certificate: { enabled, requiresAwamerPlus, text }`, `path.promoVideo`, `path.skills`, `path.stats.projectCount`, `curriculum: Course[]` with nested `sections.lessons`, `features`, `faqs`, `testimonials`.
- [X] T015 [P] Create `src/content/courses/dto/list-courses.query.dto.ts`. Same as paths plus `pathId?: string` (`@IsUUID(4)`) and `standalone?: boolean` (presence-based — accept `'true'` or boolean `true` via `@Transform`). Add a class-level `@ValidateIf` constraint (or a custom `@Validate` constraint class) that triggers when both `pathId` and `standalone` are set and throws `BadRequestException` with message `Cannot supply both pathId and standalone` (FR-013). Alternative: do the mutual-exclusion check in `CoursesController` before calling the service — implementation choice.
- [X] T016 [P] Create `src/content/courses/dto/course-summary.dto.ts` matching `contracts/courses.md`.
- [X] T017 [P] Create `src/content/courses/dto/course-detail.dto.ts` matching `contracts/courses.md` — includes `course.certificate`, `parentPath: { id, slug, title } | null`, `curriculum: Section[]`, marketing arrays.
- [X] T018 Create `src/content/paths/path-mapper.ts` exporting `toPathSummaryDto(path, stats)` and `toPathDetailDto(path, marketing, stats)`. **At the top of the file, define the certificate constant and helper per Clarification 1:**
  ```ts
  // TODO(KAN-?-certificate-config): When the schema gains certificateText/
  // certificateEnabled/certificateRequiresAwamerPlus columns on Path, replace
  // this constant with a per-row read. For MVP, all paths grant a certificate
  // and the text is uniform.
  const PATH_CERTIFICATE_TEXT = 'أكمل جميع دورات المسار للحصول على شهادة معتمدة';

  function buildPathCertificate(path: { isFree: boolean }) {
    return {
      enabled: true,
      requiresAwamerPlus: !path.isFree,
      text: PATH_CERTIFICATE_TEXT,
    };
  }
  ```
  The detail mapper uses `buildPathCertificate(path)` to populate `path.certificate`. Apply `normalizeLevel` to `path.level`. Order tags by `tag.name asc` (already done at the Prisma layer but assert in the mapper). Wire `marketing.features`, `marketing.faqs`, `marketing.testimonials` into the response.
- [X] T019 Create `src/content/paths/path-mapper.spec.ts` covering: `toPathSummaryDto` field-by-field shape; `toPathDetailDto` field-by-field shape including `certificate`; `buildPathCertificate({ isFree: true })` returns `{ enabled: true, requiresAwamerPlus: false, text: PATH_CERTIFICATE_TEXT }`; `buildPathCertificate({ isFree: false })` returns `{ enabled: true, requiresAwamerPlus: true, text: PATH_CERTIFICATE_TEXT }`; `normalizeLevel` integration in the mapper produces lowercase or `null`; `applyIsFreeOverride` is invoked when `path.isFree=true` and lesson DTOs all have `isFree=true`.
- [X] T020 Create `src/content/courses/course-mapper.ts` exporting `toCourseSummaryDto(course, stats)` and `toCourseDetailDto(course, marketing, stats)`. **At the top of the file, define the certificate constant and helper per Clarification 1:**
  ```ts
  // TODO(KAN-?-certificate-config): When the schema gains certificateText/
  // certificateEnabled/certificateRequiresAwamerPlus columns on Course, replace
  // this constant with a per-row read. For MVP, all courses grant a certificate
  // and the text is uniform.
  const COURSE_CERTIFICATE_TEXT = 'أكمل الدورة للحصول على شهادة معتمدة';

  function buildCourseCertificate(course: { isFree: boolean }) {
    return {
      enabled: true,
      requiresAwamerPlus: !course.isFree,
      text: COURSE_CERTIFICATE_TEXT,
    };
  }
  ```
  Lowercase `course.level`. Set `parentPath: null` when `course.pathId IS NULL`, else `{ id, slug, title }` from the joined `path` row. The detail mapper uses `buildCourseCertificate(course)` to populate `course.certificate`.
- [X] T021 Create `src/content/courses/course-mapper.spec.ts` covering: `toCourseSummaryDto` shape; `toCourseDetailDto` shape including `certificate`; `buildCourseCertificate` `isFree` true/false cases; `parentPath` null vs populated; `applyIsFreeOverride` semantics.

---

## Phase 3 — User Story 1: Anonymous visitor browses the catalog (P1)

**Goal**: `GET /categories`, `GET /paths`, `GET /courses` return correctly-shaped, filterable, paginated, deterministically ordered, cached responses.

**Independent test**: `curl` each endpoint without auth, verify shape + filters + meta + cache hit on second call. Verify that paginating across rows with tied `order` values returns disjoint pages on subsequent requests.

### Categories

- [X] T022 [US1] Create `src/content/categories/categories.service.ts` exporting `CategoriesService` with one method `listAllPublic(): Promise<CategoryResponseDto[]>`. Inject `PrismaService` and `CacheService`. **At the top of the file, add the Decision F TODO comment verbatim:**
  ```ts
  // TODO(KAN-?-admin-categories): When the admin Categories CRUD module is built,
  // it MUST call this.cache.del(CacheKeys.categories.all()) on every mutation
  // to invalidate the categories:all cache. Until then, manual flush is required.
  ```
  Implement cache-aside via `CacheKeys.categories.all()` and `CacheTTL.CATEGORIES`. Query: `prisma.category.findMany({ where: { status: ACTIVE }, orderBy: { order: 'asc' }, include: { _count: { select: { paths: { where: { status: PUBLISHED } }, courses: { where: { status: PUBLISHED } } } } } })`. Map each row to `CategoryResponseDto`.
- [X] T023 [US1] Create `src/content/categories/categories.controller.ts` with `@Controller('categories')` and one `@Get()` method returning `categoriesService.listAllPublic()`. The global `ResponseTransformInterceptor` wraps the array in `{ data, message: 'Success' }`.
- [X] T024 [US1] Create `src/content/categories/categories.module.ts` exporting `CategoriesModule` with imports `[PrismaModule]` (CacheModule is global per KAN-74), providers `[CategoriesService]`, controllers `[CategoriesController]`.
- [X] T025 [US1] Create `src/content/categories/categories.service.spec.ts` covering: cache hit (no Prisma call); cache miss (Prisma called + cache.set); count aggregation (only PUBLISHED paths/courses count); ACTIVE filter (HIDDEN categories excluded); `cache.get` failure tolerance (mocked rejection → falls through to DB); `cache.set` failure tolerance (returns result anyway).

### Paths list

- [X] T026 [US1] Create `src/content/paths/paths.service.ts` exporting `PathsService` with method `listPublic(query: ListPathsQueryDto): Promise<PaginatedResponse<PathSummaryDto>>`. Inject `PrismaService`, `CacheService`, `PublicMarketingQueries`. Implement `buildPathListWhere(query)` as a private helper or local function (handles `categoryId`, `tagId`, `level`, `search` — `search` uses `OR: [{ title: { contains, mode: 'insensitive' } }, { subtitle: { contains, mode: 'insensitive' } }]`; `tagId` uses `tags: { some: { tagId: query.tagId } }`). Use `buildOrderBy` from `path-stats.helper.ts` (FR-030a tiebreaker). Use `prisma.$transaction([findMany, count])`. Add the comment `// TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits, add @@index([status, order]) on Path.` immediately above the `findMany`. The `findDetailBySlug` method is added in Phase 4 (T035).
- [X] T027 [US1] Add unit tests in `src/content/paths/paths.service.spec.ts` for `listPublic` only (detail tests come in Phase 4): cache hit/miss; filters (`categoryId`, `tagId`, `level`, `search`); pagination meta math (`Math.ceil(total/limit)`, page beyond range → empty data); `cache.get` failure tolerance; `buildOrderBy` integration (assert the `orderBy` argument passed to `prisma.path.findMany` is `[primary, { id: 'asc' }]`). Test case: when filter matches zero rows, response is exactly `{ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }`. This explicitly covers FR-016.

### Courses list

- [X] T028 [US1] Create `src/content/courses/courses.service.ts` exporting `CoursesService` with `listPublic(query: ListCoursesQueryDto)`. Same pattern as `PathsService.listPublic`. Implement `buildCourseListWhere(query)` covering `categoryId`, `tagId` (via `tags: { some: { tagId } }`), `level` (enum direct match), `search` (title + subtitle ILIKE), `pathId`, and `standalone === true → pathId: null`. If the DTO did not enforce the `pathId` + `standalone` mutual exclusion, do it here at the top of the method and throw `BadRequestException('Cannot supply both pathId and standalone')` (FR-013). Use `buildCourseOrderBy` from `course-stats.helper.ts`. Use `prisma.$transaction([findMany, count])`. Detail method added in Phase 5.
- [X] T029 [US1] Add unit tests in `src/content/courses/courses.service.spec.ts` for `listPublic` only: cache hit/miss; `pathId` filter; `standalone` filter; mutual exclusion → 400; tag/level/search filters; `buildCourseOrderBy` integration. Test case: when filter matches zero rows, response is exactly `{ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }`. This explicitly covers FR-016. Test case: `cache.get` mocked to reject with an error → service falls through to Prisma without throwing. Test case: `cache.set` mocked to reject → service returns the result without throwing. Mirrors T027 (PathsService) coverage of FR-032.
- [X] T030 [US1] Create `src/content/paths/paths.controller.ts` with `@Controller('paths')` and one `@Get()` route returning `pathsService.listPublic(query)`. Add `@HttpCode(200)`. The detail route is added in Phase 4 (T036). Create `src/content/courses/courses.controller.ts` with `@Controller('courses')` and one `@Get()` route returning `coursesService.listPublic(query)`. Detail route added in Phase 5 (T040).
- [X] T031 [US1] Create `src/content/paths/paths.module.ts` and `src/content/courses/courses.module.ts`. Each module imports `PrismaModule` and `MarketingModule` (verify `MarketingModule` exports `PublicMarketingQueries`; if not, import the helper directly via a provider re-export). Providers and controllers wired. Note: `CacheModule` is global per KAN-74, no import needed.

#### E2E for User Story 1

- [X] T032 [P] [US1] Add e2e spec `test/content/categories/categories.controller.e2e-spec.ts`. Bootstrap via shared `test/content/test-app.ts`. Add `await redis.flushdb()` in `beforeEach` after DB truncation (FR-038). Seed: 2 ACTIVE + 1 HIDDEN category, 3 published paths in cat A and 2 in cat B, 2 standalone courses in cat A, 1 draft path (excluded). Assert: shape per `contracts/categories.md`; ordering by `order asc`; `pathCount` and `courseCount` correct; HIDDEN excluded; draft path not counted; second call served from cache (Prisma call counter or middleware spy). Public access: no Authorization header.
- [X] T033 [P] [US1] Add e2e spec `test/content/paths/paths.controller.e2e-spec.ts` for the **list endpoint only** (detail tests added in T038). Cover: shape via `toMatchObject`; pagination meta correctness; default-query case (no params); page-beyond-range returns `data: []` with correct meta; filters (`categoryId`, `tagId`, `level`, `search` case-insensitive on title AND subtitle); 400 on invalid UUID / invalid enum; cold/warm cache assertion (cold `< 300ms`, warm `< 20ms`); public access (no Authorization). **Pagination determinism test (FR-030a)**: seed ≥5 paths sharing `order = 0`; request `?page=1&limit=2` and `?page=2&limit=2`; assert no overlap between page 1 and page 2; assert page 1 + page 2 + page 3 cover all 5 rows; assert that re-requesting `?page=1&limit=2` returns the exact same rows in the exact same order as the first call.
- [X] T034 [P] [US1] Add e2e spec `test/content/courses/courses.controller.e2e-spec.ts` for the **list endpoint only** (detail tests added in T042). Same coverage as T033 plus: `?pathId=<uuid>` filter; `?standalone=true` returns only `pathId IS NULL`; `?pathId=X&standalone=true` returns 400 with `Cannot supply both pathId and standalone`. **Pagination determinism test**: same pattern as T033 with 5 standalone courses sharing `order = 0` (or null) — assert no overlap and identical re-request ordering.

---

## Phase 4 — User Story 2: Anonymous visitor opens a Path detail page (P1)

**Goal**: `GET /paths/:slug` returns the full SSR payload in one call.

**Independent test**: `curl` for a published slug, assert nested shape (path + curriculum + features + faqs + testimonials + certificate), `isFree` override, 404 for unknown/draft slug, second call from cache.

- [X] T035 [US2] Add `findDetailBySlug(slug: string): Promise<PathDetailDto>` to `PathsService` (same file as T026). Cache-aside via `CacheKeys.paths.detail(slug)` and `CacheTTL.DETAIL`. Single deep `findUnique({ where: { slug, status: PUBLISHED }, include: { category: true, tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } }, courses: { where: { status: PUBLISHED }, orderBy: [{ order: 'asc' }, { id: 'asc' }], include: { sections: { orderBy: { order: 'asc' }, include: { lessons: { orderBy: { order: 'asc' } } } }, _count: { select: { projects: true } } } } } })`. Add the comment `// TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits, add @@index([pathId, status, order]) on Course.` immediately above the `findUnique`. Throw `NotFoundException(`Path with slug "${slug}" not found`)` when null. Fetch marketing via THREE parallel `Promise.all` calls — `getFeaturesByOwner`, `getFaqsByOwner`, `getApprovedTestimonialsByOwner` with `MarketingOwnerType.PATH` and `path.id` (Decision B / FR-023). Compute stats via `computePathStats`. If `path.isFree`, call `applyIsFreeOverride(path)`. Map via `toPathDetailDto(path, { features, faqs, testimonials }, stats)` — the mapper invokes `buildPathCertificate({ isFree: path.isFree })`. `cache.set(key, dto, CacheTTL.DETAIL)` then return.
- [X] T036 [US2] Add the `@Get(':slug')` route to `PathsController` (same file as T030) calling `pathsService.findDetailBySlug(slug)`. Add `@HttpCode(200)`.
- [X] T037 [US2] Extend `paths.service.spec.ts` with detail tests: cache hit (no Prisma call); cache miss (Prisma call + cache.set); `NotFoundException` when slug missing; `NotFoundException` when status != PUBLISHED; isFree override applied to all nested lessons; **all three marketing methods invoked in parallel** — mock each method to return a 50ms-delayed promise and assert total elapsed time is `< 100ms` (proves `Promise.all`); `buildPathCertificate` invoked with correct `{ isFree }`; DTO mapper shape; `cache.get` failure tolerance; `cache.set` failure tolerance.
- [X] T038 [US2] Extend `test/content/paths/paths.controller.e2e-spec.ts` with detail-endpoint tests: 200 + full shape via `toMatchObject` (path, curriculum, features, faqs, testimonials); `path.certificate` populated correctly (enabled, requiresAwamerPlus reflects isFree, text is the Arabic constant); 404 unknown slug; 404 draft-status slug; isFree override visible in response (set `path.isFree=true`, assert all nested lessons have `isFree=true`); marketing arrays present and ordered; second call served from cache (cold `< 200ms`, warm `< 20ms`); `parentPath`-equivalent fields not present (paths don't have parent).

---

## Phase 5 — User Story 3: Anonymous visitor opens a Course detail page (P2)

**Goal**: `GET /courses/:slug` returns the full SSR payload (one level shallower than Path).

**Independent test**: `curl` for a published course slug, assert `parentPath` null vs populated, certificate, isFree override, 404 cases, cache.

- [X] T039 [US3] Add `findDetailBySlug(slug: string): Promise<CourseDetailDto>` to `CoursesService` (same file as T028). Same pattern as `PathsService.findDetailBySlug` but: deep include is `{ category: true, path: true, tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } }, sections: { orderBy: { order: 'asc' }, include: { lessons: { orderBy: { order: 'asc' } } } }, _count: { select: { projects: true } } }`. Add the comment `// TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits, add @@index([pathId, status, order]) on Course.` above the `findUnique`. Marketing calls use `MarketingOwnerType.COURSE`. Stats via `computeCourseStats`. `parentPath` resolved from `course.path` (null when `course.pathId IS NULL`). 404 message: `Course with slug "${slug}" not found`. Mapper invokes `buildCourseCertificate({ isFree: course.isFree })`.
- [X] T040 [US3] Add the `@Get(':slug')` route to `CoursesController` (same file as T030) calling `coursesService.findDetailBySlug(slug)`. Add `@HttpCode(200)`.
- [X] T041 [US3] Extend `courses.service.spec.ts` with detail tests mirroring T037 structure (cache hit/miss, NotFoundException, isFree override, parallel marketing assertion, certificate constant invocation, mapper shape, `cache.get`/`cache.set` failure tolerance) plus: `parentPath: null` for standalone, `parentPath: { id, slug, title }` for path-attached.
- [X] T042 [US3] Extend `test/content/courses/courses.controller.e2e-spec.ts` with detail-endpoint tests mirroring T038 plus: standalone course returns `parentPath: null`; path-attached course returns `parentPath: { id, slug, title }`; `course.certificate` populated correctly per the course constant.

---

## Phase 6 — Polish & wiring

- [X] T043 Edit `src/content/content.module.ts` to register `CategoriesModule`, `PathsModule`, `CoursesModule` in `imports`. Re-export them in the `exports` array if the umbrella module re-exports child modules. Verify `src/app.module.ts` still imports the umbrella `ContentModule` and does NOT import the deleted legacy `PathsModule`.
- [X] T044 Run `npm run build` — must pass with 0 TypeScript errors.
- [X] T045 Run `npm test` (unit) — all green; new specs add ≥30 tests over the 478 baseline.
- [X] T046 Run `npm run test:schema` — 48/48 green.
- [X] T047 Run `npm run test:content:e2e` — all green including the three new suites (categories, paths, courses).
- [X] T048 Run `npm run test:e2e` (full suite) — all green.
- [X] T049 Frozen-path diff check: `git diff master --stat -- prisma/schema.prisma prisma/migrations/ src/auth/ src/users/ src/onboarding/ src/enrollment/ src/progress/ src/certificates/ src/learning/ src/content/tags/ src/content/marketing/ src/common/cache/ src/common/guards/ src/common/filters/ src/analytics/ src/health/ docker-compose.yml .env .env.example test/auth.e2e-spec.ts test/onboarding.e2e-spec.ts test/app.e2e-spec.ts test/content/tags/ test/content/marketing/ test/enrollment/ test/certificates/` — output MUST be empty. The `src/paths/` deletion is intentional and outside this frozen list.
- [X] T050 Dependency budget check: `git diff master..HEAD package.json | grep -E '^\+\s+"' | wc -l` MUST equal `0`.

---

## Phase 7 — Verification (FR-021 spot-check + manual smoke)

- [X] T051 KAN-74 invalidation coverage spot-check. Run `grep -rn "delByPattern\|invalidateOwner" src/content/tags/ src/content/marketing/` and confirm `TagsService` mutations call `cache.delByPattern('paths:list:*')` and `cache.delByPattern('courses:list:*')` in addition to `cache.del('tags:all')`, and that marketing service mutations call `cache.invalidateOwner('path' | 'course', ownerId)` (which expands to delete `paths:detail:*` / `courses:detail:*` and `paths:list:*` / `courses:list:*`). If any gap exists for the keys this ticket consumes, STOP and report — do not silently add invalidation calls inside frozen modules.
- [X] T052 Manual smoke per `quickstart.md`: `docker-compose up -d`, `npm run start:dev`, then `curl http://localhost:3001/api/v1/categories`, `?limit=5` paths, `paths/<slug>`, `?standalone=true` courses, `courses/<slug>`, and `tags`. Verify Redis keys via `docker exec awamer-redis redis-cli KEYS 'paths:list:*'` (and similar for the other patterns). Verify cold-vs-warm timing visibly differs.

---

## Dependencies and execution order

```
Phase 1 (Setup)            — strict order: T001 → T002 → T003 → T004
Phase 2 (Foundational)     — mostly parallel:
                             T005,T006,T007,T009,T011,T012,T013,T014,T015,T016,T017 in parallel
                             T008 after T007
                             T010 after T009
                             T018 after T007 + T013 + T014  →  T019 after T018
                             T020 after T009 + T016 + T017  →  T021 after T020
Phase 3 (US1)              — Categories: T022 → T023 → T024 → T025; E2E T032 after T024
                             Paths list:    T026 → T027; Controller T030 (paths half) and T031 (paths half) → E2E T033
                             Courses list:  T028 → T029; Controller T030 (courses half) and T031 (courses half) → E2E T034
                             T026, T028 can run in parallel after Phase 2
Phase 4 (US2)              — T035 → T036 → T037, T038 (T037 and T038 in parallel)
Phase 5 (US3)              — T039 → T040 → T041, T042 (in parallel)
Phase 6 (Polish)           — strict order: T043 → T044 → T045 → T046 → T047 → T048 → T049 → T050
Phase 7 (Verification)     — T051 → T052
```

US1, US2, US3 are independently shippable after Phase 1 + Phase 2 complete. **MVP scope = US1 only** (categories + list endpoints) — visitors can browse the catalog but cannot open detail pages until US2/US3 ship.

## Parallel execution opportunities

- **Phase 2**: T005, T006, T007, T009, T011, T012, T013, T014, T015, T016, T017 — eleven foundational files independent of each other.
- **Phase 3 e2e**: T032, T033, T034 — three independent test files after their respective service+controller+module are wired.
- **Phase 4**: T037 (unit) and T038 (e2e) parallel after T036.
- **Phase 5**: T041 (unit) and T042 (e2e) parallel after T040.

## Suggested MVP scope

**Phase 1 + Phase 2 + Phase 3 (Categories + Paths list + Courses list)** ships a viable Discovery page. Detail pages (US2, US3) follow as independent increments — each is small (one method + one route + 2 test files).

## Format validation

All 52 tasks above start with `- [ ]`, contain a sequential `T0XX` ID, include `[P]` where parallelizable, include `[USn]` only inside user-story phases, and reference exact file paths.
