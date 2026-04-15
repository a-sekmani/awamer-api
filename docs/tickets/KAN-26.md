# KAN-26 — [BE] Public Discovery endpoints (Categories, Paths, Courses)

**Type:** Backend feature ticket
**Epic:** E3 — Backend MVP (final ticket)
**Status:** To Do (unblocked by KAN-70, KAN-71, KAN-72, KAN-73, KAN-74)
**Reference:** [API Design v2 §5](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/27754532/API+Design)

---

## 1. Goal (one paragraph)

Build the public-facing discovery API that serves the **anonymous** Home, Discovery listing, Path detail, and Course detail pages. Six endpoints, all `Public` access (no auth), all cached aggressively via the KAN-74 `CacheService`. Each detail endpoint must return the **complete page payload in a single SSR request** (path/course core + full curriculum + features + faqs + approved testimonials), eliminating the N-request waterfall that would otherwise hit RDS on every page view. Reuse all the helpers built in KAN-71 (`TagsService`), KAN-72 (`PublicMarketingQueries`), and KAN-74 (`CacheService`, `CacheKeys`, `RevalidationHelper`) — this ticket is composition, not new helper authorship.

---

## 2. Audit findings (already executed — operator decisions baked in)

This section was an audit checklist in v1 of this ticket. Claude Code executed it and reported back. The findings and operator decisions are baked into the rest of this document. Implementation MUST treat the §3-§17 sections below as the final source of truth, but Claude Code is encouraged to spot-check that the findings still hold (i.e., no other developer changed the codebase between audit and implementation).

### 2.1 Verified facts (from audit)

- ✅ `TagsService.listPublic()` exists at `src/content/tags/tags.service.ts` and is reused as-is.
- ✅ `CacheKeys` already exports `categories.all()`, `paths.{list, detail, listPattern, detailPattern}`, `courses.{list, detail, listPattern, detailPattern}` — added during KAN-74. **Just consume them.**
- ✅ `CacheTTL` already exports `CATEGORIES: null`, `LIST: 300`, `DETAIL: null` — generic but functionally correct. **Use these names; do NOT add per-domain renames.**
- ✅ `CacheService.{get, set, del, delByPattern, invalidateOwner, slugFor}` all present.
- ✅ Prisma models `Category`, `Path`, `Course`, `Section`, `Lesson` exist (KAN-70).
- ✅ `MarketingOwnerType` enum has `PATH` and `COURSE`.
- ✅ `ResponseTransformInterceptor` is wired globally — controllers return raw payloads; the interceptor wraps in `{ data, meta }`.
- ✅ `Course.slug @unique` is **globally unique** — `GET /courses/:slug` is unambiguous, no migration needed.
- ✅ `Path.isNew` and `Course.isNew` are stored Boolean columns (not computed).
- ✅ Categories/Paths/Courses directories do NOT yet exist under `src/content/` — clean slate.

### 2.2 Decisions on stop conditions and gaps (operator decided)

These six decisions are FINAL. Implementation must follow them exactly.

#### Decision A — Delete the legacy `src/paths/` stub

A leftover stub at `src/paths/{paths.controller, paths.module, paths.service}.ts` registers `@Controller('paths')` with an empty `findAll()` method. It must be deleted so this ticket can wire `src/content/paths/` to the same route prefix.

**Required actions (FIRST tasks in tasks.md):**
- Delete `src/paths/paths.controller.ts`, `src/paths/paths.module.ts`, `src/paths/paths.service.ts`, and the entire `src/paths/` directory.
- Remove the `PathsModule` import from `src/app.module.ts`.
- Mention "removed legacy `src/paths/` stub" in the eventual commit message.

#### Decision B — Use three parallel marketing calls (Option 1, frozen-safe)

`PublicMarketingQueries` exposes three separate methods (audited):
- `getFeaturesByOwner(ownerType, ownerId)`
- `getFaqsByOwner(ownerType, ownerId)`
- `getApprovedTestimonialsByOwner(ownerType, ownerId)`

There is NO combined `findForOwner()` method. **Do NOT add one** (KAN-72 is frozen per §14). Instead, call all three in parallel:

```typescript
const [features, faqs, testimonials] = await Promise.all([
  this.marketing.getFeaturesByOwner(MarketingOwnerType.PATH, path.id),
  this.marketing.getFaqsByOwner(MarketingOwnerType.PATH, path.id),
  this.marketing.getApprovedTestimonialsByOwner(MarketingOwnerType.PATH, path.id),
]);
```

Latency is identical to a single combined call because Prisma issues all three in parallel. The §8 service skeleton in this document already shows the correct pattern.

#### Decision C — Accept current Prisma indexes; do NOT add migrations

The audit flagged missing composite indexes:
- `@@index([pathId, status, order])` on `Course`
- `@@index([status, order])` on `Path`

`prisma/schema.prisma` and `prisma/migrations/**` are FROZEN per §14. Adding indexes is deferred to a separate post-MVP perf ticket (`KAN-26-followup-indexes`).

**Rationale:** The cache layer (TTL=null for details, 5min for lists) absorbs >95% of read traffic. Cold-cache hits run against a small MVP dataset where the existing single-column indexes (`pathId`, `categoryId`, `slug`) are sufficient to stay under the §11 budgets (200ms detail, 300ms list).

**Required actions:**
- Do NOT modify `prisma/schema.prisma` or any migration file.
- At each cache-aside read site, add an inline comment: `// TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits, add @@index([pathId, status, order]) on Course and @@index([status, order]) on Path.`
- Document this decision in the "Known limitations" section of spec.md.

#### Decision D — Leave `Path.level` as `String?`; do NOT migrate to enum

The audit confirmed `Path.level` is stored as `String?` while `Course.level` uses the `CourseLevel` enum (`BEGINNER` | `INTERMEDIATE` | `ADVANCED`). This inconsistency exists in KAN-70 schema and is frozen.

**Runtime mitigation:**
1. The `?level=` query parameter is validated by `@IsEnum(['beginner', 'intermediate', 'advanced'])` on the DTO — invalid input is rejected with 400.
2. In the DTO mapper for Path, normalize: `level: normalizeLevel(path.level)` where `normalizeLevel` lowercases and returns the value if it matches one of the three canonical values, else returns `null`.
3. For Course, the enum already enforces correctness — just lowercase for the DTO.

**Required actions:**
- Add `@IsEnum` validator on `ListPathsQueryDto.level` and `ListCoursesQueryDto.level` (already in §10 below).
- Implement `normalizeLevel()` helper in `src/content/paths/path-stats.helper.ts` (or a shared location).
- Document in spec.md "Known limitations": "Path.level is String? (not enum) due to frozen schema; query filter validates against the canonical three values, response is normalized."

#### Decision E — Use existing generic `CacheTTL` constants; no per-domain renames

KAN-74 created:
- `CacheTTL.CATEGORIES = null`
- `CacheTTL.LIST = 300`
- `CacheTTL.DETAIL = null`

This ticket's earlier draft proposed `PATHS_LIST`, `PATHS_DETAIL`, `COURSES_LIST`, `COURSES_DETAIL`. **Do NOT add these.** Renaming would risk other code that may already reference the generic names.

**Mapping (use this table when reading §6.1):**

| Endpoint cache key | TTL constant to use |
|---|---|
| `categories:all` | `CacheTTL.CATEGORIES` |
| `paths:list:*` | `CacheTTL.LIST` |
| `paths:detail:*` | `CacheTTL.DETAIL` |
| `courses:list:*` | `CacheTTL.LIST` |
| `courses:detail:*` | `CacheTTL.DETAIL` |

#### Decision F — Categories invalidation: ship with TODO marker

There is no `AdminCategoriesService` yet. `GET /api/v1/categories` will cache `categories:all` with TTL=null. Without an admin invalidation call, manual DB changes will not be reflected until either Redis is flushed or the application is restarted.

**Acceptable for MVP** because:
- Categories change rarely (≈monthly).
- Operator can manually `redis-cli DEL categories:all` after a manual DB update.
- An admin Categories CRUD module is planned as a separate ticket (`KAN-?-admin-categories`).

**Required actions:**
- In `CategoriesService`, add a top-of-file comment:
  ```typescript
  // TODO(KAN-?-admin-categories): When the admin Categories CRUD module is built,
  // it MUST call this.cache.del(CacheKeys.categories.all()) on every mutation
  // to invalidate the categories:all cache. Until then, manual flush is required.
  ```
- Document in spec.md "Known limitations": "Categories cache invalidation is currently manual; admin Categories CRUD module is a separate ticket."

### 2.3 Spot-check before implementation (Claude Code re-runs at start of `/speckit.implement`)

Before writing any code, re-verify:

```bash
# Confirm src/paths/ stub still exists (Decision A still applicable)
ls src/paths/ 2>&1

# Confirm marketing helper still has three separate methods
grep -n "getFeaturesByOwner\|getFaqsByOwner\|getApprovedTestimonialsByOwner" src/content/marketing/helpers/public-queries.helper.ts

# Confirm CacheKeys and CacheTTL still expose what audit found
grep -n "categories\|paths\|courses\|CATEGORIES\|LIST\|DETAIL" src/common/cache/cache-keys.ts | head -30

# Confirm src/content/{categories,paths,courses}/ still don't exist
ls src/content/ 2>&1
```

If any spot-check FAILS (e.g., another developer added `findForOwner` since the audit), STOP and report.

---

## 3. Scope — exactly six endpoints

| # | Method & Path | Purpose | Cache key | TTL |
|---|---|---|---|---|
| 1 | `GET /api/v1/categories` | List active categories with counts | `CacheKeys.categories.all()` | `CacheTTL.CATEGORIES` (null) |
| 2 | `GET /api/v1/paths` | List published paths with filters + pagination | `CacheKeys.paths.list(queryHash)` | `CacheTTL.LIST` (300s) |
| 3 | `GET /api/v1/paths/:slug` | Full path detail (single SSR payload) | `CacheKeys.paths.detail(slug)` | `CacheTTL.DETAIL` (null) |
| 4 | `GET /api/v1/courses` | List published courses with filters + pagination | `CacheKeys.courses.list(queryHash)` | `CacheTTL.LIST` (300s) |
| 5 | `GET /api/v1/courses/:slug` | Full course detail (single SSR payload) | `CacheKeys.courses.detail(slug)` | `CacheTTL.DETAIL` (null) |
| 6 | `GET /api/v1/tags` | **Already exists** in KAN-71 (`TagsService.listPublic`) — verification only | `tags:all` | (already KAN-71) |

**Total new code:** 5 endpoints (1, 2, 3, 4, 5). Endpoint 6 is verification-only.

**Removed from original Jira description:** `GET /api/v1/paths/:slug/courses/:courseId` was deleted in API Design v2 (§5 changelog) and is replaced by `GET /api/v1/courses/:slug`. Do NOT implement the removed endpoint.

---

## 4. Modules and file layout

```
src/content/
├── categories/                          ← NEW
│   ├── categories.module.ts
│   ├── categories.controller.ts         ← @Controller('categories')
│   ├── categories.service.ts
│   └── dto/
│       └── category-response.dto.ts
├── paths/                               ← NEW
│   ├── paths.module.ts
│   ├── paths.controller.ts              ← @Controller('paths')
│   ├── paths.service.ts
│   ├── path-stats.helper.ts             ← stats computation + normalizeLevel
│   ├── path-mapper.ts                   ← entity → DTO
│   └── dto/
│       ├── list-paths.query.dto.ts
│       ├── path-summary.dto.ts
│       └── path-detail.dto.ts
├── courses/                             ← NEW
│   ├── courses.module.ts
│   ├── courses.controller.ts            ← @Controller('courses')
│   ├── courses.service.ts
│   ├── course-stats.helper.ts
│   ├── course-mapper.ts
│   └── dto/
│       ├── list-courses.query.dto.ts
│       ├── course-summary.dto.ts
│       └── course-detail.dto.ts
├── tags/                                ← UNTOUCHED (KAN-71)
└── marketing/                           ← UNTOUCHED (KAN-72)
```

**Removed (per Decision A):**
- `src/paths/` (entire directory)

**`ContentModule`** (the umbrella module under `src/content/`) — register the three new modules: `CategoriesModule`, `PathsModule`, `CoursesModule`. `TagsModule` and `MarketingModule` are already registered.

---

## 5. Filters and pagination

### 5.1 Filter set (decision: medium B + `search`)

The API Design v2 §5.3 and §5.5 specify a base set; we honor that and add `search` per operator decision.

**`GET /paths` query parameters:**

| Param | Type | Required | Default | Validation | Notes |
|---|---|---|---|---|---|
| `categoryId` | UUID string | no | — | UUID v4 | Filters by exact category match |
| `tagId` | UUID string | no | — | UUID v4 | Filters by exact tag match (joins via `path_tags`) |
| `level` | enum | no | — | `'beginner' \| 'intermediate' \| 'advanced'` | Maps to `Path.level` (string column — see Decision D) |
| `search` | string | no | — | 1–100 chars, trimmed | Case-insensitive `ILIKE %search%` on `title` AND `subtitle` |
| `sort` | enum | no | `'order'` | `'order' \| 'created_at' \| 'title'` | Server-controlled allowlist |
| `order` | enum | no | `'asc'` | `'asc' \| 'desc'` | |
| `page` | integer | no | `1` | `>= 1`, max 1000 | |
| `limit` | integer | no | `20` | `>= 1`, max 100 | |

**`GET /courses` query parameters** — same as above, plus:

| Param | Type | Required | Default | Validation | Notes |
|---|---|---|---|---|---|
| `pathId` | UUID string | no | — | UUID v4 | Filters to courses in a specific path |
| `standalone` | boolean | no | — | `true` only (presence-based) | When set, filters `Course.pathId IS NULL`. **Mutually exclusive** with `pathId` — supplying both returns 400. |

**No `sortBy=popular`** — that requires enrollment-count denormalization which we don't have yet. **No `priceMin/priceMax`** — pricing model isn't finalized. Both can be added in a follow-up ticket.

### 5.2 Pagination response shape (matches API Design §2.5)

```json
{
  "data": [...],
  "meta": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

`totalPages = Math.ceil(total / limit)`. If `total = 0`, `totalPages = 0` and `data = []`. Page numbers beyond `totalPages` return an empty `data` array (not 404).

### 5.3 Query hash (for cache key)

Compute `queryHash = sha256(JSON.stringify(canonicalQuery)).slice(0, 16)`.

`canonicalQuery` MUST be a sorted object containing **only** the query parameters that affect the result (default values omitted to keep the cache space small):

```typescript
function canonicalize(query: ListQuery): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (query.categoryId) obj.categoryId = query.categoryId;
  if (query.tagId) obj.tagId = query.tagId;
  if (query.level) obj.level = query.level;
  if (query.search) obj.search = query.search.toLowerCase().trim();
  if (query.pathId) obj.pathId = query.pathId;
  if (query.standalone) obj.standalone = true;
  if (query.sort && query.sort !== 'order') obj.sort = query.sort;
  if (query.order && query.order !== 'asc') obj.order = query.order;
  if (query.page && query.page !== 1) obj.page = query.page;
  if (query.limit && query.limit !== 20) obj.limit = query.limit;
  // Sort keys for deterministic JSON output
  return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = obj[k]; return acc; }, {} as any);
}
```

Hash deterministic: `?categoryId=X&page=1` → same key as `?page=1&categoryId=X`. Default-only requests (no params) → `queryHash = sha256('{}').slice(0,16)` — one canonical empty key.

---

## 6. Cache strategy

### 6.1 TTL policy (uses existing constants from KAN-74)

| Endpoint | Key builder | TTL constant | Invalidation trigger |
|---|---|---|---|
| `GET /categories` | `CacheKeys.categories.all()` | `CacheTTL.CATEGORIES` | Admin Category mutation (TODO — see Decision F) |
| `GET /paths` | `CacheKeys.paths.list(hash)` | `CacheTTL.LIST` | Admin Path/Course/Tag mutation (already KAN-74) |
| `GET /paths/:slug` | `CacheKeys.paths.detail(slug)` | `CacheTTL.DETAIL` | Admin mutation on this path or any of its children/marketing (already KAN-74) |
| `GET /courses` | `CacheKeys.courses.list(hash)` | `CacheTTL.LIST` | Admin Course/Tag mutation (already KAN-74) |
| `GET /courses/:slug` | `CacheKeys.courses.detail(slug)` | `CacheTTL.DETAIL` | Admin mutation on this course or its marketing (already KAN-74) |
| `GET /tags` | `CacheKeys.tags.all()` | (already KAN-71) | (already wired) |

### 6.2 No new cache-keys.ts additions needed

Audit confirmed all required key builders and TTL constants exist. **Do NOT modify `cache-keys.ts`.** This ticket consumes only.

If during implementation a missing key builder is genuinely needed (unexpected), STOP and ask — don't silently add to `cache-keys.ts`.

### 6.3 Cache-aside pattern (every read endpoint)

```typescript
async listPublic(query: ListPathsQueryDto): Promise<PaginatedResponse<PathSummaryDto>> {
  const hash = computeQueryHash(query);
  const key = CacheKeys.paths.list(hash);

  const cached = await this.cache.get<PaginatedResponse<PathSummaryDto>>(key);
  if (cached) return cached;

  const result = await this.queryAndAssemble(query); // hits DB
  await this.cache.set(key, result, CacheTTL.LIST);
  return result;
}
```

**The order matters:** assemble the full response with all derived fields (counts, joined relations, computed flags) BEFORE caching. Never cache an intermediate shape.

### 6.4 Invalidation responsibility

This ticket adds **read-side cache-aside only**. It does NOT add invalidation calls inside admin mutation services — those were wired in KAN-74's 18-marker sweep.

**Implementation MUST verify (in spot-check) that:**

- `TagsService` mutations call `cache.delByPattern('paths:list:*')` and `cache.delByPattern('courses:list:*')` (in addition to `cache.del('tags:all')`).
- Marketing service mutations call `cache.invalidateOwner('path' | 'course', ownerId)` which expands to delete `paths:detail:{slug}` / `courses:detail:{slug}`.

**If any of these invalidations is missing for a key we introduce**, document the gap, STOP, and ask. Do NOT silently add invalidation calls outside this ticket's frozen-paths boundary (the existing KAN-71/72 services are frozen — see §14).

**Categories invalidation is intentionally absent** per Decision F — TODO marker only.

### 6.5 `slugFor` helper

`CacheService.slugFor(ownerType, ownerId)` was added in KAN-74. Reused as-is. No changes needed.

---

## 7. Response shapes (DTOs)

The shapes below MUST match API Design v2 §5 exactly.

### 7.1 `CategoryResponseDto`

```typescript
{
  id: string;            // UUID
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  order: number;
  pathCount: number;     // count of published paths in this category
  courseCount: number;   // count of published courses in this category
}
```

`GET /categories` returns `{ data: CategoryResponseDto[] }` ordered by `order asc`.

### 7.2 `PathSummaryDto` (item in `GET /paths`)

```typescript
{
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  level: 'beginner' | 'intermediate' | 'advanced' | null;  // normalized — see Decision D
  thumbnail: string | null;
  category: { id: string; name: string; slug: string };
  tags: Array<{ id: string; name: string; slug: string }>;
  isFree: boolean;
  isNew: boolean;
  stats: {
    courseCount: number;
    lessonCount: number;
    totalDurationMinutes: number;
  };
}
```

### 7.3 `PathDetailDto` (response from `GET /paths/:slug`)

See API Design §5.4 for the full shape — copy field names verbatim.

```typescript
{
  path: {
    id, slug, title, subtitle, description,
    level,                       // normalized via normalizeLevel()
    thumbnail,
    promoVideo: { url, thumbnail } | null,
    isFree, isNew, status,
    skills: string[],
    category: { id, name, slug },
    tags: Array<{ id, name, slug }>,
    stats: {
      courseCount, lessonCount, totalDurationMinutes,
      projectCount  // sum across all courses
    },
    certificate: {
      enabled: boolean,
      requiresAwamerPlus: boolean,
      text: string
    }
  },
  curriculum: Array<{
    id, slug, order, title, subtitle, description, isFree,
    stats: { sectionCount, lessonCount, totalDurationMinutes },
    sections: Array<{
      id, title, order,
      lessons: Array<{
        id, title, type, order, estimatedMinutes, isFree
      }>
    }>
  }>,
  features: FeatureDto[],         // from PublicMarketingQueries.getFeaturesByOwner
  faqs: FaqDto[],                 // from PublicMarketingQueries.getFaqsByOwner
  testimonials: TestimonialDto[]  // from PublicMarketingQueries.getApprovedTestimonialsByOwner
}
```

**Constraints:**
- Curriculum courses ordered by `Course.order asc`, then `id asc`.
- Sections ordered by `Section.order asc`.
- Lessons ordered by `Lesson.order asc`.
- Lesson DTO does NOT include content blocks.
- If `path.isFree = true`, set every lesson's `isFree = true` regardless of `Lesson.isFree`.
- Features, faqs, testimonials all ordered by `order asc`. Testimonials filtered to `status = 'approved'` (already done by `getApprovedTestimonialsByOwner`).

### 7.4 `CourseSummaryDto` and `CourseDetailDto`

Mirror Path DTOs per API Design §5.5 and §5.6 exactly. Key differences:

- `CourseSummary.path` → `{ id, slug, title } | null`
- `CourseDetail.parentPath` → `{ id, slug, title } | null`
- `CourseDetail.curriculum` is `Section[]` (no nested course layer)
- `CourseDetail.stats` includes `projectCount` (count of projects in this course only)
- `Course.level` is enum-backed — just lowercase to match the API contract

---

## 8. Service layer

```typescript
// src/content/paths/paths.service.ts

@Injectable()
export class PathsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly marketing: PublicMarketingQueries,  // KAN-72, three separate methods
  ) {}

  async findDetailBySlug(slug: string): Promise<PathDetailDto> {
    const key = CacheKeys.paths.detail(slug);
    const cached = await this.cache.get<PathDetailDto>(key);
    if (cached) return cached;

    // (1) Single Prisma query with deep include
    // TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits,
    //   add @@index([pathId, status, order]) on Course.
    const path = await this.prisma.path.findUnique({
      where: { slug, status: PathStatus.PUBLISHED },
      include: {
        category: true,
        tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
        courses: {
          where: { status: CourseStatus.PUBLISHED },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          include: {
            sections: {
              orderBy: { order: 'asc' },
              include: { lessons: { orderBy: { order: 'asc' } } }
            },
            _count: { select: { projects: true } }
          }
        }
      }
    });

    if (!path) throw new NotFoundException(`Path with slug "${slug}" not found`);

    // (2) Marketing content via THREE parallel calls (Decision B — Option 1)
    const [features, faqs, testimonials] = await Promise.all([
      this.marketing.getFeaturesByOwner(MarketingOwnerType.PATH, path.id),
      this.marketing.getFaqsByOwner(MarketingOwnerType.PATH, path.id),
      this.marketing.getApprovedTestimonialsByOwner(MarketingOwnerType.PATH, path.id),
    ]);

    // (3) Compute stats + apply isFree override
    const stats = computePathStats(path);
    if (path.isFree) applyIsFreeOverride(path);

    // (4) Map to DTO (normalizeLevel handles String? -> enum string | null)
    const dto = toPathDetailDto(path, { features, faqs, testimonials }, stats);

    // (5) Cache and return
    await this.cache.set(key, dto, CacheTTL.DETAIL);
    return dto;
  }

  async listPublic(query: ListPathsQueryDto): Promise<PaginatedResponse<PathSummaryDto>> {
    const hash = computeQueryHash(query);
    const key = CacheKeys.paths.list(hash);
    const cached = await this.cache.get<PaginatedResponse<PathSummaryDto>>(key);
    if (cached) return cached;

    const where = buildPathListWhere(query);
    const orderBy = buildOrderBy(query);
    const skip = (query.page - 1) * query.limit;

    // TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits,
    //   add @@index([status, order]) on Path.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.path.findMany({
        where,
        include: {
          category: true,
          tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
          courses: {
            where: { status: CourseStatus.PUBLISHED },
            include: { sections: { include: { _count: { select: { lessons: true } } } } }
          }
        },
        orderBy,
        skip,
        take: query.limit,
      }),
      this.prisma.path.count({ where }),
    ]);

    const data = items.map(p => toPathSummaryDto(p, computePathStats(p)));
    const result: PaginatedResponse<PathSummaryDto> = {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      },
    };

    await this.cache.set(key, result, CacheTTL.LIST);
    return result;
  }
}
```

`CoursesService` and `CategoriesService` follow the same pattern but smaller. `CategoriesService` has only one method (`listAllPublic`).

`CategoriesService` MUST include the top-of-file TODO from Decision F.

---

## 9. Controller layer

```typescript
// src/content/paths/paths.controller.ts

@Controller('paths')
export class PathsController {
  constructor(private readonly pathsService: PathsService) {}

  @Get()
  @HttpCode(200)
  async list(@Query() query: ListPathsQueryDto): Promise<PaginatedResponse<PathSummaryDto>> {
    return this.pathsService.listPublic(query);
  }

  @Get(':slug')
  @HttpCode(200)
  async findBySlug(@Param('slug') slug: string): Promise<PathDetailDto> {
    return this.pathsService.findDetailBySlug(slug);
  }
}
```

**Response wrapping:** The global `ResponseTransformInterceptor` (audited at `src/app.module.ts:114`) wraps responses in `{ data }` or `{ data, meta }` automatically. Controllers return raw payloads.

**No guards:** Public endpoints. No `@UseGuards`, no `@Roles`. Tests must verify the absence of `Authorization` requirement.

**Throttler:** Apply default app-level throttle (100/min from `THROTTLE_LIMIT`). No per-endpoint `@Throttle` override needed.

---

## 10. DTO validation

```typescript
// src/content/paths/dto/list-paths.query.dto.ts

export class ListPathsQueryDto {
  @IsOptional()
  @IsUUID(4, { message: 'categoryId must be a valid UUID' })
  categoryId?: string;

  @IsOptional()
  @IsUUID(4)
  tagId?: string;

  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced'])
  level?: 'beginner' | 'intermediate' | 'advanced';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  search?: string;

  @IsOptional()
  @IsEnum(['order', 'created_at', 'title'])
  sort?: 'order' | 'created_at' | 'title' = 'order';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
```

`ListCoursesQueryDto` adds `pathId?` and `standalone?` plus a class-level `@ValidateIf` constraint that rejects when both are supplied (return 400).

---

## 11. SQL performance

The detail endpoint executes a single deep `findUnique`. The list endpoint uses `$transaction([findMany, count])` for parallel execution.

**Performance budget:**
- Cold cache (DB hit): `< 200ms` for detail, `< 300ms` for list (full payload, 20 items).
- Warm cache: `< 20ms`.

These are gates in the e2e tests (§13).

**Index strategy** is per Decision C: rely on existing single-column indexes + cache layer. Composite indexes deferred to follow-up ticket.

---

## 12. Error handling

| Condition | Status | Response |
|---|---|---|
| Path/Course slug not found OR `status != published` | 404 | `{ statusCode: 404, message: 'Path with slug "X" not found' }` |
| Invalid query parameter | 400 | Standard `ValidationPipe` error response |
| `pathId` and `standalone` both supplied | 400 | `{ statusCode: 400, message: 'Cannot supply both pathId and standalone' }` |
| Prisma error (DB down) | 500 | Standard error envelope (global filter) |
| Cache error | (silent — `CacheService` never throws) | Falls through to DB |

Use `NotFoundException`, `BadRequestException` from `@nestjs/common`.

---

## 13. Tests

### 13.1 Unit tests (per service)

For each of `CategoriesService`, `PathsService`, `CoursesService`:

- `listPublic` returns cached result when cache hit (mock `cache.get` to return value, assert no Prisma call).
- `listPublic` queries Prisma + caches result on cache miss.
- `findDetailBySlug` cache hit path (no DB call).
- `findDetailBySlug` cache miss path (DB call + cache set).
- `findDetailBySlug` throws `NotFoundException` when slug not found OR status != published.
- `findDetailBySlug` applies `isFree` override correctly.
- `findDetailBySlug` calls all three marketing methods in parallel (mock + assert).
- DTO mapper produces shape from §7 (snapshot or field-by-field).
- Stats computation correct.
- `normalizeLevel()` handles: `'beginner'` → `'beginner'`, `'BEGINNER'` → `'beginner'`, `'invalid'` → `null`, `null` → `null`.
- `cache.get` failure (mocked rejection) does NOT throw — falls through to DB.
- `cache.set` failure does NOT throw.

### 13.2 E2E tests

**Files:**
- `test/content/categories/categories.controller.e2e-spec.ts`
- `test/content/paths/paths.controller.e2e-spec.ts`
- `test/content/courses/courses.controller.e2e-spec.ts`

Each e2e spec MUST:

- Bootstrap via shared `test/content/test-app.ts` (KAN-72 added flushdb on bootstrap).
- Add `await redis.flushdb()` in `beforeEach` after DB truncation. (Lesson from KAN-74.)
- Seed minimal fixture data.
- Assert response shape via `toMatchObject` for at least one item.
- Assert `Authorization` header NOT required.
- Assert pagination meta correct.
- Assert filter correctness for every supported query param.
- Assert 400 when `pathId` + `standalone` both supplied (courses only).
- Assert 404 when slug doesn't exist OR status != published.
- **Cache assertions** (at least one per service):
  - First request: cache miss, Prisma called.
  - Second request: cache hit, Prisma NOT called.
- **Performance assertions** (at least one per service):
  - Cold cache list: `< 300ms`.
  - Warm cache list: `< 20ms`.
  - Cold cache detail: `< 200ms`.
  - Warm cache detail: `< 20ms`.

### 13.3 Existing test suites must remain green

```bash
npm test                       # unit tests (currently 478)
npm run test:schema            # KAN-70 schema (48)
npm run test:content:e2e       # content e2e (currently 95)
npm run test:e2e               # full e2e (currently 287 + 1 todo)
```

No regressions. Frozen-path verification (§14) catches accidental changes.

---

## 14. Frozen paths (do NOT modify)

```
prisma/schema.prisma
prisma/migrations/**
src/auth/**
src/users/**
src/onboarding/**
src/enrollment/**
src/progress/**
src/certificates/**
src/learning/**
src/content/tags/**          ← KAN-71
src/content/marketing/**     ← KAN-72
src/common/cache/**          ← KAN-74 (entire module — including cache-keys.ts; see §6.2)
src/common/guards/**
src/common/filters/**
src/analytics/**
src/health/**
docker-compose.yml
.env / .env.example
test/auth.e2e-spec.ts
test/onboarding.e2e-spec.ts
test/app.e2e-spec.ts
test/content/tags/**
test/content/marketing/**
test/enrollment/**
test/certificates/**
```

**Allowed modifications:**
- DELETE `src/paths/` (entire directory — Decision A)
- Edit `src/app.module.ts` to: (a) remove the deleted `PathsModule` import, (b) register `ContentModule` updates if needed (audit determined `ContentModule` already registers child modules — extend it).
- Edit `src/content/content.module.ts` (or wherever the umbrella lives) to register the three new child modules.

**New directories:**
- `src/content/categories/**`
- `src/content/paths/**`
- `src/content/courses/**`
- `test/content/categories/**`
- `test/content/paths/**`
- `test/content/courses/**`

Run `git diff master --stat -- <frozen paths>` at the end; output MUST be empty for every frozen path. The `src/paths/` deletion is expected and not a frozen-path violation (it's not in the frozen list).

---

## 15. Definition of Done

Implementation is NOT complete unless ALL of these pass.

### 15.1 Build & schema

- [ ] `npm run build` → 0 TypeScript errors
- [ ] `npx prisma validate` → valid
- [ ] `git diff master prisma/` → empty

### 15.2 Test gates (full suite — lesson from KAN-74)

- [ ] `npm test` → all unit tests pass (current baseline 478, expect at least +30 new)
- [ ] `npm run test:schema` → 48/48
- [ ] `npm run test:content:e2e` → all green, with new categories/paths/courses suites added
- [ ] `npm run test:e2e` → all green (full suite, NOT just content)

### 15.3 Cache verification

- [ ] Manual `curl /api/v1/paths` then `curl` again → second response served from cache (verify via `docker exec awamer-redis redis-cli KEYS 'paths:list:*'`)
- [ ] Manual `curl /api/v1/paths/:slug` → key `paths:detail:{slug}` present in Redis
- [ ] After Admin path mutation: `paths:detail:{slug}` removed from Redis (verifies KAN-74 invalidation covers our keys)

### 15.4 Frozen-path diff

- [ ] `git diff master --stat -- <every frozen path from §14>` → empty (the `src/paths/` deletion is intentional and outside the frozen list)

### 15.5 Manual smoke

- [ ] `docker-compose up -d`
- [ ] `npm run start:dev`
- [ ] `curl http://localhost:3001/api/v1/categories | jq` → returns array
- [ ] `curl http://localhost:3001/api/v1/paths?limit=5 | jq` → returns paginated array
- [ ] `curl http://localhost:3001/api/v1/paths/{any-published-slug} | jq` → returns full PathDetail
- [ ] `curl http://localhost:3001/api/v1/courses?standalone=true | jq` → returns only standalone courses
- [ ] `curl http://localhost:3001/api/v1/courses/{any-published-slug} | jq` → returns full CourseDetail
- [ ] `curl http://localhost:3001/api/v1/tags | jq` → returns from KAN-71 endpoint (verification only)

### 15.6 Dependency budget

- [ ] No new npm dependencies added. (`git diff master..HEAD package.json | grep -E '^\+\s+"' | wc -l` → 0)

### 15.7 Spec-kit artifacts

- [ ] `specs/013-public-discovery/spec.md` complete (includes "Known limitations" section per Decisions C, D, F)
- [ ] `specs/013-public-discovery/plan.md` complete
- [ ] `specs/013-public-discovery/tasks.md` complete (FIRST task is the `src/paths/` deletion per Decision A)
- [ ] `/speckit.analyze` re-run after remediations → 0 actionable findings

---

## 16. Spec-kit workflow plan

| Step | Command | Expected duration |
|---|---|---|
| 1 | `/speckit.specify` | 5 min |
| 2 | `/speckit.clarify` — expect 0–2 questions (most decisions baked in §2.2) | 5 min |
| 3 | `/speckit.plan` | 5 min |
| 4 | `/speckit.tasks` | 3 min |
| 5 | `/speckit.analyze` | 3 min |
| 6 | Manual remediations + re-analyze | 10–15 min |
| 7 | `/speckit.implement` | 30–45 min |
| 8 | Manual verification (run all 4 test suites + curl) | 10 min |
| 9 | Commit + merge | 5 min |

Total estimated wall-clock time: 1.5–2 hours.

---

## 17. Known limitations (must appear verbatim in spec.md)

1. **Composite query indexes deferred** (Decision C): Composite indexes `[pathId, status, order]` on Course and `[status, order]` on Path are NOT added in this ticket. The cache layer absorbs >95% of read traffic. If post-deployment monitoring shows hot DB hits with seq scans, add the indexes via a follow-up ticket (`KAN-26-followup-indexes`).

2. **Path.level type inconsistency** (Decision D): `Path.level` is stored as `String?` while `Course.level` is enum-backed. The `?level=` query filter validates against the canonical three values, and the response is normalized via `normalizeLevel()`. Stored data integrity is not enforced at the schema level. Migration to enum is deferred.

3. **Categories cache invalidation is manual** (Decision F): No admin Categories CRUD module exists yet. After manual DB changes to categories, the operator must `redis-cli DEL categories:all` (or restart the app) for changes to be visible. Admin Categories CRUD is a separate ticket.

---

## 18. Done definition (one sentence)

KAN-26 is done when the six public endpoints return correctly-shaped JSON, are aggressively cached with cache-aside, all four test suites are green, no frozen path is touched, the legacy `src/paths/` stub is deleted, and `docker-compose up + curl` smoke tests pass against the running app.
