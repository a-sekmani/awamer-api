# Implementation Plan: Public Discovery Endpoints (KAN-26)

**Branch**: `013-public-discovery` | **Date**: 2026-04-15 | **Spec**: `./spec.md`
**Source ticket**: `docs/tickets/KAN-26.md`

## Summary

Five new public, anonymous, aggressively-cached read endpoints serving the Discovery / Path detail / Course detail pages of the Awamer frontend (`GET /api/v1/categories`, `GET /api/v1/paths`, `GET /api/v1/paths/:slug`, `GET /api/v1/courses`, `GET /api/v1/courses/:slug`). A sixth endpoint (`GET /api/v1/tags`) already exists from KAN-71 and is verification-only.

This is a **composition ticket**: it consumes existing infrastructure from KAN-71 (`TagsService`), KAN-72 (`PublicMarketingQueries` — three separate methods), and KAN-74 (`CacheService`, `CacheKeys`, `CacheTTL`, `RevalidationHelper`). No new helpers are authored, no schema changes, no new dependencies.

The technical approach is cache-aside on every read. Detail endpoints execute a single deep Prisma `findUnique` with nested `include` to assemble the full SSR payload in one query, then call the three marketing methods in parallel via `Promise.all` (Decision B), apply the `isFree` override for free paths/courses, normalize `Path.level` (Decision D), build a hardcoded `certificate` constant per type (Clarification 2026-04-15), and cache the assembled DTO. List endpoints use `prisma.$transaction([findMany, count])` and append `{ id: 'asc' }` as a deterministic pagination tiebreaker (FR-030a).

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS
**Primary Dependencies**: NestJS 11, Prisma 6.19, ioredis (via `CacheService`), class-validator 0.15, class-transformer 0.5, @nestjs/throttler 6.5 — **all already installed**, no new deps
**Storage**: PostgreSQL via Prisma; Redis 7 via the existing `CacheService`
**Testing**: Jest unit (`*.spec.ts`) with `ioredis-mock`; Jest e2e (`*.e2e-spec.ts`) with `@nestjs/testing` + `supertest`; existing `test/content/test-app.ts` shared bootstrap
**Target Platform**: Linux server (containerized via existing `docker-compose.yml`); deployed behind the existing AWS pipeline
**Project Type**: web-service (NestJS REST API)
**Performance Goals**: Cold cache `<200ms` (detail) / `<300ms` (list, 20 items full payload); warm cache `<20ms` for both. ≥95% Redis hit rate after warmup.
**Constraints**: All decisions A–F from KAN-26 §2.2 are binding. Frozen-paths list from KAN-26 §14 is the authoritative no-touch list (includes `prisma/**`, `src/common/cache/**`, `src/content/tags/**`, `src/content/marketing/**`, and more — see plan §"Frozen paths"). No new npm dependencies. No schema migrations.
**Scale/Scope**: 5 new endpoints, ≈3 services, ≈8 DTOs, ≈30+ unit tests, 3 e2e specs. Estimated ≈25–35 source files added under `src/content/{categories,paths,courses}/`.

## Constitution Check

Awamer API constitution principles I–VI (`.specify/memory/constitution.md`) apply.

| Principle | How this feature complies |
|---|---|
| **I. Module Isolation** | Three new self-contained modules (`CategoriesModule`, `PathsModule`, `CoursesModule`) under `src/content/`. Each has its own controller, service, helpers, mappers, and DTOs. No DTO sharing across modules. Marketing data is consumed via the existing `PublicMarketingQueries` provider (imported through the marketing module) — not by direct instantiation. |
| **II. Security-First** | Endpoints are intentionally public (anonymous Discovery pages). No `passwordHash`, no internal-only IDs, no quiz `isCorrect` flags exposed. Helmet remains active globally. The DTO mappers explicitly allow-list the fields per FR-024–FR-027. |
| **III. Standard Response Contract** | All endpoints return raw payloads; the global `ResponseTransformInterceptor` (audited at `src/app.module.ts:114`) wraps single-item responses as `{ data, message: 'Success' }` and paginated responses as `{ data, meta, message }`. Error envelope is the existing global filter. |
| **IV. Transactional Integrity** | The list endpoint uses `prisma.$transaction([findMany, count])` to issue both queries in parallel within a transaction (consistency + halved latency). Detail endpoints are single `findUnique` calls — no multi-step writes, so no transaction needed. |
| **V. Data Validation & Type Safety** | All query DTOs use `class-validator` decorators (`@IsUUID(4)`, `@IsEnum`, `@IsInt`, `@Min/@Max`, `@MinLength/@MaxLength`, `@Transform`). Global `ValidationPipe` rejects malformed input with 400. UUIDs are strings; dates flow through Prisma → ISO. `Path.level` is normalized via `normalizeLevel()` (Decision D + FR-029). |
| **VI. Access Control Hierarchy** | Endpoints are public — no `JwtAuthGuard`, no `RolesGuard`, no `ContentAccessGuard`, no `EnrollmentGuard`. The absence is intentional (FR-006) and asserted in e2e tests (no `Authorization` header). The `isFree` override (FR-028) reflects the design rule that free paths grant unrestricted lesson previews. |

**Constitution Check result: PASS.** No violations. No carve-outs required.

## Project Structure

### Documentation (this feature)

```text
specs/013-public-discovery/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── categories.md
│   ├── paths.md
│   └── courses.md
└── tasks.md             # /speckit.tasks output
```

### Source code (repository root)

```text
src/content/
├── content.module.ts                ← EDIT: register 3 new modules
├── categories/                      ← NEW
│   ├── categories.module.ts
│   ├── categories.controller.ts
│   ├── categories.service.ts
│   ├── categories.service.spec.ts
│   └── dto/category-response.dto.ts
├── paths/                           ← NEW
│   ├── paths.module.ts
│   ├── paths.controller.ts
│   ├── paths.service.ts
│   ├── paths.service.spec.ts
│   ├── path-stats.helper.ts         ← computePathStats + applyIsFreeOverride + normalizeLevel + buildOrderBy
│   ├── path-stats.helper.spec.ts
│   ├── path-mapper.ts               ← entity → DTO + buildPathCertificate constant
│   ├── path-mapper.spec.ts
│   ├── query-hash.helper.ts         ← computeQueryHash wrapper
│   ├── query-hash.helper.spec.ts
│   └── dto/
│       ├── list-paths.query.dto.ts
│       ├── path-summary.dto.ts
│       └── path-detail.dto.ts
├── courses/                         ← NEW
│   ├── courses.module.ts
│   ├── courses.controller.ts
│   ├── courses.service.ts
│   ├── courses.service.spec.ts
│   ├── course-stats.helper.ts
│   ├── course-stats.helper.spec.ts
│   ├── course-mapper.ts             ← entity → DTO + buildCourseCertificate constant
│   ├── course-mapper.spec.ts
│   └── dto/
│       ├── list-courses.query.dto.ts
│       ├── course-summary.dto.ts
│       └── course-detail.dto.ts
├── tags/                            ← FROZEN (KAN-71)
└── marketing/                       ← FROZEN (KAN-72)

src/paths/                           ← DELETE entirely (Decision A — first task)
src/app.module.ts                    ← EDIT: remove legacy PathsModule import

test/content/
├── categories/categories.controller.e2e-spec.ts    ← NEW
├── paths/paths.controller.e2e-spec.ts              ← NEW
└── courses/courses.controller.e2e-spec.ts          ← NEW
```

**Structure Decision**: Single-project NestJS web-service layout already in use across awamer-api. New code lives under `src/content/{categories,paths,courses}/` to align with the existing `src/content/{tags,marketing}/` umbrella. Tests mirror under `test/content/`.

## Frozen paths (do NOT modify)

Authoritative list from KAN-26 §14. The implementation MUST not touch:

```
prisma/schema.prisma, prisma/migrations/**
src/auth/**, src/users/**, src/onboarding/**
src/enrollment/**, src/progress/**, src/certificates/**, src/learning/**
src/content/tags/**          ← KAN-71
src/content/marketing/**     ← KAN-72
src/common/cache/**          ← KAN-74 (entire module — including cache-keys.ts)
src/common/guards/**, src/common/filters/**
src/analytics/**, src/health/**
docker-compose.yml, .env, .env.example
test/auth.e2e-spec.ts, test/onboarding.e2e-spec.ts, test/app.e2e-spec.ts
test/content/tags/**, test/content/marketing/**
test/enrollment/**, test/certificates/**
```

The single allowed mutation outside the new directories: (a) deletion of `src/paths/`, (b) one-line removal of the legacy `PathsModule` import from `src/app.module.ts`, (c) registering the three new modules in `src/content/content.module.ts`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Deep `findUnique` with nested include exceeds 200ms cold budget | Decision C accepts this risk; cache absorbs warm traffic; follow-up `KAN-26-followup-indexes` ticket adds composite indexes if monitoring shows hot DB hits. TODO markers placed at every `findUnique` / `findMany`. |
| `Path.level` data integrity (free-form String) | DTO mapper `normalizeLevel()` returns `null` on garbage; query filter validates against canonical enum (FR-008, FR-029). |
| KAN-74 invalidation gap for new keys | FR-021 spot-check task (T043) verifies `TagsService` and marketing services already invalidate `paths:list:*`, `paths:detail:*`, `courses:list:*`, `courses:detail:*`. STOP-and-ask if a gap is found. |
| Categories cache becomes stale | Documented limitation #4; manual `redis-cli DEL categories:all` required; admin Categories CRUD ticket follow-up (Decision F). |
| Pagination non-determinism on tied `order` values | FR-030a mandates `{ id: 'asc' }` secondary sort in `buildOrderBy()` for both Paths and Courses. Unit + e2e tests assert page-to-page consistency. |
| New e2e suites flake on Redis state leakage | FR-038 mandates `await redis.flushdb()` in `beforeEach` — pattern proven in KAN-74. |
| `src/paths/` deletion forgotten → route conflict at runtime | Task T001 (FIRST) deletes it; Task T003 spot-checks via `ls`. |
| Certificate metadata absent from schema | Clarification 2026-04-15: hardcoded constants per type in mapper (`buildPathCertificate` / `buildCourseCertificate`) with TODO marker for future schema migration. |

## Phase 0 — Research

No external research required. All technical decisions are pre-decided in KAN-26 §2.2 (Decisions A–F) and the two `/speckit.clarify` answers above. `research.md` consolidates these for reference.

## Phase 1 — Design & Contracts

All artifacts already produced during the spec phase:

- ✅ `data-model.md` — read-only entity reference (this ticket adds no new entities)
- ✅ `contracts/categories.md`, `contracts/paths.md`, `contracts/courses.md`
- ✅ `quickstart.md` — manual smoke recipe

Agent context update is run as part of the `/speckit.plan` workflow.

## Phase 2 — Tasks

`tasks.md` already exists from the spec phase (44 tasks across 7 phases). It will be refreshed by `/speckit.tasks` after `/speckit.plan` completes, to incorporate:

- The certificate-constant helpers and their unit tests (Clarification 1).
- The pagination determinism FR-030a — `buildOrderBy` always appends `{ id: 'asc' }` and the corresponding e2e test for tied-`order` rows.

## Complexity Tracking

No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |

## Done definition

All gates from KAN-26 §15 must pass:

- `npm run build` clean
- `npm test` (unit) green — baseline 478, +30 new minimum
- `npm run test:schema` 48/48
- `npm run test:content:e2e` green with 3 new suites
- `npm run test:e2e` (full) green
- `git diff master --stat -- <every frozen path>` empty
- Manual smoke (curl all six endpoints) successful
- `git diff master..HEAD package.json | grep -E '^\+\s+"' | wc -l` → 0
