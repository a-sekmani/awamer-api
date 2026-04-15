# Research — Public Discovery (KAN-26)

This is a composition ticket. No external research was required; every technical choice is fixed by either KAN-26 §2.2 operator decisions, the existing KAN-71/72/74 infrastructure, or the two `/speckit.clarify` answers from session 2026-04-15. This file consolidates them so that future contributors do not need to re-read the ticket history.

---

## Decision A — Delete the legacy `src/paths/` stub

- **Decision**: Delete `src/paths/{paths.controller, paths.module, paths.service}.ts` and the directory itself before adding any new code under `src/content/paths/`.
- **Rationale**: A leftover stub registers `@Controller('paths')` with an empty `findAll()`. Without removal, the new `src/content/paths/PathsController` would create an ambiguous route at `/api/v1/paths`.
- **Alternatives considered**: (a) Extending the stub in place — rejected because it lives outside the `src/content/` umbrella and breaks the Module Isolation principle. (b) Renaming the new controller to a different prefix — rejected because the API contract requires `/api/v1/paths`.

## Decision B — Three parallel marketing calls (Option 1, frozen-safe)

- **Decision**: Call `PublicMarketingQueries.getFeaturesByOwner`, `getFaqsByOwner`, and `getApprovedTestimonialsByOwner` in parallel via `Promise.all` from `PathsService.findDetailBySlug` and `CoursesService.findDetailBySlug`.
- **Rationale**: `src/content/marketing/**` is frozen (KAN-72). Adding a combined `findForOwner()` helper would touch a frozen path. Parallel calls have identical latency to a single combined call because Prisma issues all three in parallel.
- **Alternatives considered**: (a) Adding a `findForOwner()` wrapper on `PublicMarketingQueries` — rejected as a frozen-path violation. (b) Sequential calls — rejected, would triple latency.

## Decision C — Accept current Prisma indexes; defer composite indexes

- **Decision**: Do not add `[pathId, status, order]` on Course or `[status, order]` on Path. Place `TODO(KAN-26-followup-indexes)` markers above every `findUnique` / `findMany` call.
- **Rationale**: `prisma/schema.prisma` is frozen. The cache layer (TTL=null for details, 5 minutes for lists) absorbs >95% of traffic; cold-cache budgets (200ms detail / 300ms list) are achievable with existing single-column indexes for the MVP dataset.
- **Alternatives considered**: (a) Migration with composite indexes — rejected, frozen schema. (b) No TODO markers — rejected, the markers are the breadcrumb for the follow-up ticket.

## Decision D — Leave `Path.level` as `String?`; normalize in mapper

- **Decision**: `Path.level` stays `String?`. The query DTO validates `?level=` against `@IsEnum(['beginner','intermediate','advanced'])`. The DTO mapper calls `normalizeLevel(value)` which lowercases and returns the value if it matches one of the three canonical values, else `null`. `Course.level` is already enum-backed and only needs lowercasing.
- **Rationale**: Schema is frozen. Application-level normalization gives the API a clean enum contract without touching `prisma/schema.prisma`.
- **Alternatives considered**: (a) Migrating to `CourseLevel` enum — rejected, frozen schema. (b) Returning the raw string — rejected, breaks the DTO contract and the frontend's type assumptions.

## Decision E — Use existing generic `CacheTTL` constants

- **Decision**: Use `CacheTTL.CATEGORIES` (null), `CacheTTL.LIST` (300), and `CacheTTL.DETAIL` (null) as already exported from `src/common/cache/cache-keys.ts`. Do NOT modify `cache-keys.ts`.
- **Rationale**: KAN-74 already added all key builders (`categories.all`, `paths.list/detail/listPattern/detailPattern`, `courses.list/detail/listPattern/detailPattern`) and TTL constants. Renaming or duplicating them would touch a frozen file and risk breaking other consumers.
- **Alternatives considered**: Per-domain TTL constants (`PATHS_LIST`, `PATHS_DETAIL`, …) — rejected, frozen-path violation and unnecessary indirection.

## Decision F — Categories invalidation: ship with TODO marker

- **Decision**: `CategoriesService` includes a top-of-file TODO comment documenting that an admin Categories CRUD module (separate ticket) must call `cache.del(CacheKeys.categories.all())` on every mutation. Until then, manual `redis-cli DEL categories:all` is required after DB changes.
- **Rationale**: Categories change rarely (≈monthly). Adding an admin Categories module here would expand the ticket scope significantly. The MVP can live with manual flush.
- **Alternatives considered**: (a) Building admin Categories CRUD in this ticket — rejected, scope creep. (b) Setting a short TTL like 1 hour — rejected, would still serve stale data and adds complexity.

---

## Clarification 1 (2026-04-15) — Certificate metadata source

- **Decision**: Hardcoded constants in the mapper layer, separate constant per type. `enabled: true`, `requiresAwamerPlus: !isFree`, `text` is a per-type Arabic constant. Constants live at the top of `path-mapper.ts` and `course-mapper.ts` with a `TODO(KAN-?-certificate-config)` comment. Helper functions: `buildPathCertificate({ isFree })` and `buildCourseCertificate({ isFree })`.
  ```ts
  const PATH_CERTIFICATE_TEXT = 'أكمل جميع دورات المسار للحصول على شهادة معتمدة';
  const COURSE_CERTIFICATE_TEXT = 'أكمل الدورة للحصول على شهادة معتمدة';
  ```
- **Rationale**: The Prisma schema has no `certificateText` / `certificateEnabled` / `certificateRequiresAwamerPlus` columns and is frozen. The frontend SSR contract (API Design v2 §5.4/5.6) requires the field to be present — so it cannot be omitted. Hardcoded constants are deterministic, testable, and zero-risk.
- **Alternatives considered**: (a) Omit the field — rejected, breaks the contract. (b) Read from env vars — rejected, adds operational surface area without MVP value. (c) Add schema columns — rejected, frozen schema.

## Clarification 2 (2026-04-15) — Pagination determinism

- **Decision**: Every list endpoint's `orderBy` array MUST end with `{ id: 'asc' }` regardless of the user's `sort` choice. Implemented in `buildOrderBy(query)` for both `PathsService.listPublic` and `CoursesService.listPublic`.
  ```ts
  function buildOrderBy(query) {
    const primary =
      query.sort === 'created_at' ? { createdAt: query.order } :
      query.sort === 'title'      ? { title: query.order } :
                                    { order: query.order };
    return [primary, { id: 'asc' }];
  }
  ```
- **Rationale**: `Path.order` defaults to `0` and `Course.order` is nullable Int. Multiple rows commonly share the same `order` value; without a deterministic tiebreaker, paginated requests can repeat or skip rows across pages. The PK index makes `id asc` the cheapest deterministic tiebreaker. Mirrors the FR-030 curriculum convention.
- **Alternatives considered**: (a) `createdAt` tiebreaker — rejected, doubles sort cost on un-indexed columns. (b) Cursor-based pagination — rejected, much larger scope change. (c) Accept non-determinism — rejected, visitors will notice on page 2.

---

## Best-practice reuse from prior tickets

| Topic | Source ticket | How it's reused |
|---|---|---|
| Cache-aside pattern with `CacheService.{get, set}` | KAN-74 | Every read endpoint follows the same skeleton: check, miss → assemble full DTO → set |
| Query-hash key construction | KAN-74 | `CacheKeys.buildQueryHash` already exported; `query-hash.helper.ts` is a thin wrapper that builds the canonical, default-omitting object |
| `redis.flushdb()` in e2e `beforeEach` | KAN-74 | All three new e2e specs (FR-038) — prevents Redis state leakage between tests |
| Shared test bootstrap `test/content/test-app.ts` | KAN-72 | All three new e2e specs reuse it |
| `MarketingOwnerType` enum for marketing scoping | KAN-72 | Used in `findDetailBySlug` calls |
| `TagsService.listPublic` reuse | KAN-71 | `GET /tags` — verification only, no new code |
| `PrismaService.$transaction([findMany, count])` for parallel pagination | Standard NestJS+Prisma pattern | `listPublic` methods use it for atomic + parallelized list+count |
