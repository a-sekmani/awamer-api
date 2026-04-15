# Implementation Plan: KAN-74 — Redis CacheModule & Invalidation Sweep

**Branch**: `012-redis-cache-module` | **Date**: 2026-04-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-redis-cache-module/spec.md`
**Ticket**: [docs/tickets/KAN-74.md](../../docs/tickets/KAN-74.md)

## Summary

Introduce Redis as a first-class infrastructure dependency and deliver a global `CacheModule` exposing a `CacheService` (get / set / del / delByPattern / invalidateOwner / isHealthy) plus a dormant `RevalidationHelper`. Sweep the 17 authoritative `TODO(KAN-74)` markers in `src/content/tags/` and `src/content/marketing/` with real invalidation calls (including one cache-aside read site and one un-marked helper per Q2). Switch `@nestjs/throttler` to a Redis-backed store sharing the same client, extend `/api/v1/health` to report `{ status, database, cache, uptime }`, and create a new `docker-compose.yml` with Postgres + Redis. No Prisma, auth, users, onboarding, enrollment, progress, certificates, or learning files are touched.

**Technical approach**: direct `ioredis` client (Approach A per ticket §13.1) behind a NestJS factory provider; cache-aside pattern for the tags read site; owner-scoped `invalidateOwner` + slug-lookup-based revalidation for marketing mutations (Option A per §13.3); `delByPattern` uses SCAN + batched DEL; all cache operations are non-throwing and degrade silently.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS
**Framework**: NestJS 11 (existing)
**Primary Dependencies (new)**: `ioredis` (prod), `@nest-lab/throttler-storage-redis` (prod, maintained fork — fallback to `nestjs-throttler-storage-redis` if incompatible with throttler v6), `ioredis-mock` (dev)
**Primary Dependencies (existing, reused)**: `@nestjs/throttler ^6.5.0`, `@nestjs/config ^4.0.3`, `@nestjs/common ^11.1.18`, `@prisma/client ^6.19.3`, `class-validator`, `joi`
**Storage**: Redis 7 (local via Docker Compose `redis:7-alpine`; production via AWS ElastiCache — provisioning out of scope). Postgres unchanged.
**Testing**: Jest 29 + `ioredis-mock` for unit tests; real Redis from Docker Compose for e2e tests via `test/content-e2e-jest.config.js` bootstrap (extended as needed)
**Target Platform**: Linux server (AWS App Runner in production, Docker Compose locally)
**Project Type**: Single NestJS backend service (`awamer-api`)
**Performance Goals**:
- Cache round-trip p95 < 5 ms local, < 20 ms production
- `delByPattern` over 10,000 keys < 500 ms without blocking Redis (SC-005)
- `/health` response < 50 ms with healthy Redis, < 500 ms with unreachable Redis (SC-004)
**Constraints**:
- Cache is non-critical — every cache method except `isHealthy` MUST NEVER throw (FR-002)
- No modifications to frozen paths (FR-034): `prisma/`, `src/auth`, `src/users`, `src/onboarding`, `src/enrollment`, `src/progress`, `src/certificates`, `src/learning`, `src/common/guards`, `src/common/filters`, `src/analytics`
- Content files under `src/content/tags` and `src/content/marketing` accept ONLY marker-replacement edits + DI additions (FR-019)
- Dormant revalidation gate on `FRONTEND_REVALIDATE_SECRET` presence, not `FRONTEND_URL` (FR-026)
**Scale/Scope**:
- 7 new files under `src/common/cache/`, 1 extended file in `src/health/`, 4 touched files in `src/content/**` (17 markers + 1 un-marked helper), 1 edited `src/app.module.ts` (throttler config), 1 new `docker-compose.yml`, 1 edited `.env.example`
- ~6 new unit spec files + 4 extended existing specs + 5 new e2e spec files
- Zero Prisma schema changes, zero guard changes, zero auth changes

## Constitution Check

*Gate: must pass before Phase 0 research. Re-checked after Phase 1.*

| Principle | Compliance | Evidence |
|---|---|---|
| **I. Module Isolation** | ✅ | `CacheModule` is a self-contained NestJS module at `src/common/cache/` with Controller-less service + DTOs-free contract. Declared `@Global()` so consumers inject via the global scope without direct instantiation; this is explicitly how `PrismaModule` is already structured. No module shares DTOs — cache values are plain generic types owned by the caller. |
| **II. Security-First** | ✅ | No sensitive fields are introduced into API responses (cache stores internal DTO shapes that are already public per their consumers). Redis URL comes from env var (no hardcoded secrets). `FRONTEND_REVALIDATE_SECRET` is a new secret sourced only from env. Helmet unchanged. `/health` remains `@Public()` (acceptable for liveness; no sensitive data). |
| **III. Standard Response Contract** | ✅ | `/health` retains its `@Public()` envelope-free shape per NestJS convention (health endpoints are intentionally flat for load-balancer compatibility). No new controllers introduced; no new endpoints to wrap in `{ data, message }`. |
| **IV. Transactional Integrity** | ✅ | Cache invalidation is explicitly OUTSIDE Prisma transactions (cache is non-critical; a failed cache op must not roll back a successful DB write). Marketing mutations still write to DB transactionally unchanged; cache + revalidation calls run after the DB commit on the same async path, wrapped with their own error swallowing. No multi-step DB writes are introduced. |
| **V. Data Validation & Type Safety** | ✅ | `CacheService.get<T>` and `set<T>` are generic; callers own type safety. `ioredis` is typed. No `any` types. New env vars (`REDIS_URL`, `FRONTEND_REVALIDATE_SECRET`) validated via the existing Joi schema in `AppModule.ConfigModule.forRoot`. |
| **VI. Access Control Hierarchy** | ✅ | Not applicable — no content-access changes. `ContentAccessGuard` and `EnrollmentGuard` are in the frozen `src/common/guards` path (FR-034) and explicitly not touched. |

**Initial gate**: **PASS** — no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/012-redis-cache-module/
├── spec.md              # Completed
├── plan.md              # This file
├── research.md          # Phase 0 — technical decisions
├── data-model.md        # Phase 1 — cache key / TTL / entity mapping
├── quickstart.md        # Phase 1 — local run + test instructions
├── contracts/
│   ├── cache-service.md       # CacheService API contract
│   ├── cache-keys.md          # Key helper signatures + TTL constants
│   ├── revalidation-helper.md # RevalidationHelper contract
│   └── health-endpoint.md     # Extended /health response shape
└── checklists/
    └── requirements.md        # Completed by /speckit.specify
```

### Source Code (repository root)

**Single-project NestJS backend** (`awamer-api`). Existing layout preserved; new files confined to `src/common/cache/` and `src/health/` extensions.

```text
awamer-api/
├── docker-compose.yml                              # NEW (Postgres + Redis, per Q1)
├── .env.example                                    # EDITED (add REDIS_URL, FRONTEND_REVALIDATE_SECRET)
├── package.json                                    # EDITED (add ioredis, throttler-storage-redis, ioredis-mock)
├── src/
│   ├── app.module.ts                               # EDITED (import CacheModule; switch ThrottlerModule to Redis storage)
│   ├── common/
│   │   └── cache/                                  # NEW module (greenfield)
│   │       ├── cache.module.ts                     # @Global() module, factory provider + lifecycle
│   │       ├── cache.service.ts                    # CacheService implementation
│   │       ├── cache-keys.ts                       # CacheKeys + CacheTTL registries
│   │       ├── redis.provider.ts                   # REDIS_CLIENT token + factory
│   │       ├── revalidation.helper.ts              # Dormant frontend revalidation client
│   │       ├── cache.service.spec.ts               # Unit tests (ioredis-mock)
│   │       ├── cache-keys.spec.ts                  # Unit tests (pure functions)
│   │       └── revalidation.helper.spec.ts         # Unit tests (mocked fetch)
│   ├── health/
│   │   ├── health.controller.ts                    # EDITED — return { status, database, cache, uptime }
│   │   ├── health.module.ts                        # EDITED — import PrismaModule for DB check
│   │   └── health.controller.spec.ts               # EDITED — new assertions
│   └── content/
│       ├── tags/
│       │   └── tags.service.ts                     # EDITED — marker #1 (read-aside), #2-4 (invalidation), plus ReplaceTagAssociationsHelper (FR-017a)
│       └── marketing/
│           ├── features/features.service.ts        # EDITED — markers #5-8
│           ├── faqs/faqs.service.ts                # EDITED — markers #9-12
│           └── testimonials/testimonials.service.ts # EDITED — markers #13-17
└── test/
    ├── content-e2e-jest.config.js                  # REUSED (no structural change)
    └── common/cache/
        ├── cache.service.e2e-spec.ts               # NEW — real Redis round-trip
        ├── tags-cache-invalidation.e2e-spec.ts     # NEW — tag mutation → invalidation observable
        ├── marketing-cache-invalidation.e2e-spec.ts # NEW — spy-based per §12.5
        ├── throttler-redis.e2e-spec.ts             # NEW — two-client shared counter
        └── health-cache.e2e-spec.ts                # NEW — /health cache field scenarios
```

**Structure Decision**: Single backend project; CacheModule is a new sibling under `src/common/cache/` mirroring the existing `src/common/*` utility layout. E2E tests live under a new `test/common/cache/` directory to keep cache coverage discoverable separate from content-module e2e specs.

## Phase 0: Research

See [research.md](./research.md) for all technical decisions, alternatives considered, and resolution of each NEEDS CLARIFICATION from the spec and ticket §13.

Outstanding NEEDS CLARIFICATION from the spec: **none** (all three §2 audit questions resolved via `/speckit.clarify` session 2026-04-15).

## Phase 1: Design Artifacts

- [data-model.md](./data-model.md) — Cache key registry, TTL matrix, and the non-DB "entities" (CacheService, CacheKeys, CacheTTL, RevalidationHelper, CacheModule) along with their relationships and lifecycle.
- [contracts/cache-service.md](./contracts/cache-service.md) — Method signatures, error-handling contract, serialization rules.
- [contracts/cache-keys.md](./contracts/cache-keys.md) — Key helper signatures, key-format grammar, TTL constants.
- [contracts/revalidation-helper.md](./contracts/revalidation-helper.md) — HTTP contract, dormancy gate, error semantics.
- [contracts/health-endpoint.md](./contracts/health-endpoint.md) — Extended `/health` response shape, status semantics.
- [quickstart.md](./quickstart.md) — Local bring-up (Docker Compose), test commands, verification checklist.

## Constitution Check (post-Phase 1)

Re-verified after Phase 1 artifacts drafted. No deviations introduced during design. **PASS**. Complexity Tracking remains empty.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| — | — | — |
