---
description: "Task list for KAN-74 — Redis CacheModule & invalidation sweep"
---

# Tasks: KAN-74 — Redis CacheModule & Invalidation Sweep

**Input**: Design documents from `/specs/012-redis-cache-module/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Included. The spec §FR-030–FR-033 and ticket §12 make tests a mandatory part of the Definition of Done. Unit and e2e tests are generated as first-class tasks, written before the implementation they cover (TDD) wherever practical.

**Organization**: Tasks grouped by the four user stories from `spec.md`. US1 (cache infra) and US2 (sweep) are both P1 and together constitute the MVP — either in isolation delivers partial value, but the ticket's Definition of Done requires both. US3 (throttler) is P2; US4 (dormant revalidation helper) is P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 / US4

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New dependencies, Docker Compose, environment config — all the scaffolding required before any code changes.

- [X] T001 Install runtime dependencies `ioredis` and `@nest-lab/throttler-storage-redis` via `npm install ioredis @nest-lab/throttler-storage-redis` and update `package.json` + `package-lock.json`. If `@nest-lab/throttler-storage-redis` fails to resolve against `@nestjs/throttler ^6.5.0`, fall back to `nestjs-throttler-storage-redis` per research R2.
- [X] T002 Install dev dependency `ioredis-mock` via `npm install --save-dev ioredis-mock` and update `package.json` + `package-lock.json`.
- [X] T003 [P] Create `/Users/ahmadsekmani/Desktop/Projects/awamer-api/docker-compose.yml` at the repository root with two services: `postgres` (image `postgres:16-alpine`, port 5432, volume `postgres_data`, env from `.env`, healthcheck `pg_isready`) and `redis` (image `redis:7-alpine`, container_name `awamer-redis`, port 6379, volume `redis_data`, `command: redis-server --appendonly yes`, healthcheck `redis-cli ping`). Declare both volumes at the bottom. Follow research R12.
- [X] T004 [P] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/.env.example` to append `REDIS_URL=redis://localhost:6379` and `FRONTEND_REVALIDATE_SECRET=` (empty) with inline comments matching the file's existing `KEY=value  # comment` format. Preserve every existing entry.
- [X] T005 Edit the Joi validation schema in `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/app.module.ts` (inside `ConfigModule.forRoot.validationSchema`) to add `REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required()` and `FRONTEND_REVALIDATE_SECRET: Joi.string().allow('').optional()`. Do not touch any other schema entry.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the CacheModule skeleton and register it globally. Everything in later phases (US1 verification, US2 sweep, US3 throttler, US4 helper) imports from these files, so no story can start until Phase 2 is complete.

**⚠️ CRITICAL**: No user story work may begin until this phase is complete.

- [X] T006 [P] Create `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/common/cache/cache-keys.ts` exporting `OwnerType`, `CacheKeys` (tags/categories/paths/courses/marketing helpers), `CacheTTL` (TAGS/CATEGORIES/LIST/DETAIL/MARKETING), and `buildQueryHash(params)` per `contracts/cache-keys.md`. Use `as const`, import `createHash` from `node:crypto`.
- [X] T007 [P] Create `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/common/cache/redis.provider.ts` exporting the `REDIS_CLIENT` injection token (`Symbol('REDIS_CLIENT')`) and a `redisProviderFactory` NestJS provider that reads `REDIS_URL` from `ConfigService`, enables TLS when the scheme is `rediss://` (research R7), and returns a new `Redis` instance from `ioredis`.
- [X] T008 Create `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/common/cache/cache.service.ts` implementing `CacheService` per `contracts/cache-service.md`: `get<T>`, `set<T>`, `del`, `delByPattern` (SCAN + UNLINK with COUNT 500), `invalidateOwner`, `isHealthy`. Every method except `isHealthy` swallows Redis errors and logs at `warn` per research R8. **Additionally**: add new method `slugFor(ownerType: 'path' | 'course', ownerId: string): Promise<string | null>` that queries Prisma for the owner's slug (`prisma.path.findUnique({where:{id:ownerId}, select:{slug:true}})` or the course equivalent based on `ownerType`) and returns the slug string or `null`. `CacheService` now injects `PrismaService` (already global via `PrismaModule`) in addition to its Redis client. The `slugFor` method swallows Prisma errors and returns `null` without throwing, matching the never-throw contract from FR-002. This centralizes slug-lookup logic per research R5 and honors FR-019 by avoiding new methods on marketing services. Depends on T006 and T007.
- [X] T009 Create `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/common/cache/revalidation.helper.ts` implementing `RevalidationHelper` per `contracts/revalidation-helper.md`. Dormancy gate is on `FRONTEND_REVALIDATE_SECRET` presence (NOT `FRONTEND_URL`). Use the native `fetch` API. Swallow and log all errors.
- [X] T010 Create `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/common/cache/cache.module.ts` as `@Global() @Module`. Providers: `redisProviderFactory`, `CacheService`, `RevalidationHelper`. Exports: `CacheService`, `RevalidationHelper`, `REDIS_CLIENT`. Implement `onModuleDestroy` to call `this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false }).quit()`. Depends on T006–T009.
- [X] T011 Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/app.module.ts` to import `CacheModule` from `./common/cache/cache.module` and add it to the `imports` array (exactly once). Do not yet switch the throttler — that lives in US3/T027.

**Checkpoint**: `CacheModule` boots with the app. `npm run start:dev` succeeds, `/api/v1/health` still returns the old `{ status: 'ok' }` (unchanged until US1), and nothing in the content modules is touched yet.

---

## Phase 3: User Story 1 — Cache Infrastructure Available (Priority: P1) 🎯 MVP part 1

**Goal**: The platform has a working, observable cache layer that degrades gracefully. `/health` reports cache connectivity; the `CacheService` has been proven end-to-end against real Redis.

**Independent Test**: Boot the app against `docker-compose up redis`, hit `/api/v1/health` and see `cache: "connected"`; stop the Redis container, hit `/health` again, see `cache: "disconnected"` with overall `status` still `"ok"`.

### Tests for User Story 1 (TDD — write first, expect RED)

- [X] T012 [P] [US1] Write `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/common/cache/cache.service.spec.ts` covering every assertion in `contracts/cache-service.md` "Test assertions" section: miss/hit/corrupt/error paths for `get`, TTL vs null-TTL for `set`, `del` true/false, `delByPattern` counting and 10k-key stress, `invalidateOwner` path/course expansion, `isHealthy` PING success/failure, plus verification that injected Redis errors never escape. Use `ioredis-mock` for the Redis client. **Additionally, add these `slugFor` test cases** (mock `PrismaService`): (a) `slugFor('path', validId)` returns the slug for a valid path owner; (b) `slugFor('course', validId)` returns the slug for a valid course owner; (c) `slugFor` returns `null` when the owner does not exist (Prisma returns `null`); (d) `slugFor` returns `null` when the mocked Prisma client throws, and the error does not propagate. Depends on T008.
- [X] T013 [P] [US1] Write `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/common/cache/cache-keys.spec.ts` covering determinism, charset grammar (`[a-z0-9:-]`), ownerType lowercase rule, `buildQueryHash` order-independence and 16-char hex output, and TTL constant values matching the data-model matrix. Depends on T006.
- [ ] T014 [P] [US1] Write `/Users/ahmadsekmani/Desktop/Projects/awamer-api/test/common/cache/cache.service.e2e-spec.ts` against real Redis: set/get round-trip, TTL expiry, `delByPattern` over 100 seeded keys, Arabic UTF-8 round-trip, `invalidateOwner` realistic scenario. Bootstraps NestJS via `test/content/test-app.ts`, calls `redis.flushdb()` in `beforeEach`. **Additionally, add a perf scenario**: seed 10,000 keys under a common pattern (e.g., `perf:key:{i}` for `i=0..9999`) using a Redis pipeline batch (`pipeline.set(...).exec()`), then call `delByPattern('perf:key:*')` wrapped in `performance.now()` measurements, and assert `expect(durationMs).toBeLessThan(500)`. This is the perf gate for SC-005 against real Redis (not the mock used in T012). Depends on T008.
- [ ] T015 [P] [US1] Write `/Users/ahmadsekmani/Desktop/Projects/awamer-api/test/common/cache/health-cache.e2e-spec.ts` asserting: with Redis up, `GET /api/v1/health` → `{ status:'ok', database:'connected', cache:'connected', uptime:<number> }`; with Redis pointed to a bad URL in test setup, `cache:'disconnected'` while `status` remains `'ok'`; with Postgres stubbed as unreachable, `database:'disconnected'` and `status:'degraded'`. **Additionally, add timing assertions**: wrap each supertest call in `const start = performance.now(); await request(...).get('/api/v1/health'); const duration = performance.now() - start;`. Assert `expect(duration).toBeLessThan(50)` for the healthy (Redis + Postgres up) case, and `expect(duration).toBeLessThan(500)` for the simulated-unhealthy (Redis down and/or Postgres down) case. This enforces SC-004 timing targets directly. TDD-style — written before T017 implementation; test starts in RED state and turns GREEN after T017 completes.

### Implementation for User Story 1

- [X] T016 [US1] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/health/health.module.ts` to import `PrismaModule` (for the database check) — `CacheService` is already globally available via `@Global()` `CacheModule`.
- [X] T017 [US1] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/health/health.controller.ts` to inject `PrismaService` and `CacheService`, implement `async check()` returning `{ status, database, cache, uptime }` per `contracts/health-endpoint.md`. Database check uses `prisma.$queryRaw\`SELECT 1\`` wrapped in a 500 ms `Promise.race` timeout. Cache check calls `this.cache.isHealthy()`. `uptime` is `Math.floor(process.uptime())`. Status is `'ok'` when database is connected, `'degraded'` otherwise. Keep `@Public()`. Depends on T016.
- [X] T018 [US1] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/health/health.controller.spec.ts` to add unit-level assertions for the new shape (mock `PrismaService.$queryRaw` and `CacheService.isHealthy`). Preserve every existing assertion.
- [X] T019 [US1] Run `npm test -- --testPathPattern='common/cache|health'` and `npm run test:content:e2e -- --testPathPattern='cache|health'`. All must be green. Fix issues until green before moving on.

**Checkpoint**: Cache infrastructure proven. `/health` reports the full four-field shape. Redis can be stopped mid-session and the app continues serving requests without 5xx leakage.

---

## Phase 4: User Story 2 — Cache Invalidation Sweep (Priority: P1) 🎯 MVP part 2

**Goal**: Zero `TODO(KAN-74)` markers remain in `src/`. Every tags and marketing mutation invalidates the correct caches and (for marketing) calls the dormant revalidation helper.

**Independent Test**: `grep -rn "TODO(KAN-74)" src/` returns zero. For each of the 17 sites + the `ReplaceTagAssociationsHelper` invocation path, a unit spec spy confirms the correct `CacheService` / `RevalidationHelper` method is called with the correct arguments.

### Tests for User Story 2 (TDD — write first, expect RED)

- [X] T020 [P] [US2] Extend `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/content/tags/tags.service.spec.ts` with new `describe('cache invalidation', ...)` blocks asserting: (a) `listPublic` calls `cache.get(CacheKeys.tags.all())` first, falls through to Prisma on miss, and writes back via `cache.set(..., CacheTTL.TAGS)`; (b) `create` / `update` / `remove` each call `cache.del(CacheKeys.tags.all())`, `cache.del(CacheKeys.tags.adminAll())`, `cache.delByPattern('paths:list:*')`, and `cache.delByPattern('courses:list:*')`. Do NOT modify existing assertions — add, don't replace. Depends on T008.
- [X] T021 [P] [US2] Extend `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/content/marketing/features/features.service.spec.ts` with assertions that every mutation (`create`, `update`, `remove`, `reorder`) calls `cache.invalidateOwner(ownerType, ownerId)` exactly once and calls `revalidation.revalidatePath('/${ownerType}s/${slug}')` with the DB-resolved slug. Mock the slug lookup. Add, don't replace existing assertions.
- [X] T022 [P] [US2] Extend `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/content/marketing/faqs/faqs.service.spec.ts` — same pattern as T021 for FaqsService.
- [X] T023 [P] [US2] Extend `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/content/marketing/testimonials/testimonials.service.spec.ts` — same pattern as T021 for TestimonialsService, including `updateStatus`.
- [ ] T024 [P] [US2] Write `/Users/ahmadsekmani/Desktop/Projects/awamer-api/test/common/cache/tags-cache-invalidation.e2e-spec.ts`: seed a tag, hit `GET /api/v1/admin/tags`, verify Redis has a populated key, create/update/delete a tag through the admin endpoints, verify the cache keys are gone, verify next read repopulates with fresh data. Bootstraps via `test/content/test-app.ts`, calls `redis.flushdb()` in `beforeEach`.
- [ ] T025 [P] [US2] Write `/Users/ahmadsekmani/Desktop/Projects/awamer-api/test/common/cache/marketing-cache-invalidation.e2e-spec.ts` as SPY-based per spec §FR-033c — create/update/delete/reorder features, faqs, testimonials against real endpoints, assert (via jest spy on `CacheService.invalidateOwner` and `RevalidationHelper.revalidatePath`) that the correct calls are made with the correct arguments. Mark the public-consumer scenario as a `TODO(KAN-26)` pending test per ticket §12.5.

### Implementation for User Story 2

- [X] T026 [US2] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/content/tags/tags.service.ts`:
   - **Preliminary discovery step**: run `grep -rn 'replaceTagAssociations\|TagAssociations\|applyTagAssociations' src/content/` to confirm the exact file and class location of the association-rewrite logic; the helper may be a standalone class OR a private method inside `TagsService`. Update the FR-017a bullet below with the concrete file:line before applying the invalidation. If the helper is a private method on `TagsService`, the constructor injection of `CacheService` is already in place from this task — no additional DI work needed in that case.
   - Inject `CacheService` via constructor (add as the last param).
   - **Marker #1 (line 27, `listPublic`)**: replace the TODO with the cache-aside pattern per research R4 — `cache.get<TagResponseDto[]>(CacheKeys.tags.all())` first, on miss execute the existing Prisma query + DTO mapping UNCHANGED, then `cache.set(CacheKeys.tags.all(), dto, CacheTTL.TAGS)` before returning.
   - **Markers #2, #3, #4 (lines 45, 73, 101 — `create`, `update`, `remove`)**: replace each TODO with four invalidation calls: `cache.del(CacheKeys.tags.all())`, `cache.del(CacheKeys.tags.adminAll())`, `cache.delByPattern('paths:list:*')`, `cache.delByPattern('courses:list:*')`. Do NOT wrap in try/catch (CacheService is already non-throwing).
   - **FR-017a un-marked helper**: at the location confirmed in the discovery step, inject `CacheService` (if it is a separate class) or reuse the already-injected `CacheService` (if it is a private method inside `TagsService`). At the end of the association-rewrite method, call `cache.delByPattern('paths:list:*')` and `cache.delByPattern('courses:list:*')`. This is the sole edit in this file beyond pure marker replacement; document it in a single inline comment referencing FR-017a.
   - Add the required `import { CacheService } from '../../common/cache/cache.service'` and `import { CacheKeys, CacheTTL } from '../../common/cache/cache-keys'`.
   - Verify FR-019: no logic changes, no renames, no signature changes.
- [X] T027 [US2] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/content/marketing/features/features.service.ts`:
   - Inject `CacheService` and `RevalidationHelper` at the end of the constructor params.
   - **Markers #5–#8 (lines 47, 69, 95, 115)**: replace each TODO with `await this.cache.invalidateOwner(ownerType, ownerId)` followed by `const slug = await this.cache.slugFor(ownerType, ownerId); if (slug) await this.revalidation.revalidatePath(\`/\${ownerType}s/\${slug}\`);`. Skip the `revalidatePath` call if `slug` is null (best-effort). **No private slug-lookup method is added to the marketing service** — slug lookup is centralized in `CacheService.slugFor` per research R5. These calls go AFTER the DB operation succeeds (post-commit).
   - Add imports for `CacheService` and `RevalidationHelper`.
   - Verify FR-019 compliance: the only net-new code is the DI additions, the new imports, and the invalidation + revalidation calls at the marker sites. No new methods are added to the service.
- [X] T028 [P] [US2] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/content/marketing/faqs/faqs.service.ts` applying the identical pattern as T027 to markers #9–#12 (lines 47, 65, 88, 108). Same DI additions; same post-mutation invalidation + revalidation calls using `this.cache.slugFor(ownerType, ownerId)`. No private slug-lookup method is added — FR-019 preserved.
- [X] T029 [P] [US2] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/content/marketing/testimonials/testimonials.service.ts` applying the identical pattern to markers #13–#17 (lines 50, 76, 109, 128, 148 — including `updateStatus`). Same DI additions; same calls using `this.cache.slugFor(ownerType, ownerId)`. No private slug-lookup method is added — FR-019 preserved.
- [X] T030 [US2] Run `grep -rn "TODO(KAN-74)" src/` — must return **zero** matches. If any remain, fix before proceeding. This is SC-001.
- [X] T031 [US2] Run `grep -rn "'tags:" src/ | grep -v src/common/cache/cache-keys.ts` and the same for `'paths:`, `'courses:`, `'marketing:`, `'categories:`. Each must return zero matches outside `cache-keys.ts`. This is DoD §14.16 — no inline cache key construction anywhere.
- [X] T031a [US2] Run `grep -rnE "'EX',\s*[0-9]+" src/ | grep -v 'src/common/cache/'` and assert **zero matches**. This enforces FR-014 the same way T031 enforces FR-010 for cache keys. If any matches are found, the task fails — all TTL values must come from `CacheTTL` constants in `cache-keys.ts`, never as raw numeric literals at call sites. The only permitted location for `'EX', <number>` literals is inside `CacheService.set` in `src/common/cache/cache.service.ts` (and its spec file), which the `grep -v` above excludes.
- [X] T032 [US2] Run `npm test -- --testPathPattern='content/(tags|marketing)'` and `npm run test:content:e2e`. All tags/marketing unit and e2e tests must stay green (no KAN-71/KAN-72 regressions) and the new assertions from T020–T025 must pass.

**Checkpoint**: All 17 markers resolved, FR-017a un-marked helper invalidated, `grep` gates green, tags/marketing mutations verifiably invalidate caches, marketing mutations call the (still-dormant) revalidation helper.

---

## Phase 5: User Story 3 — Rate Limiting Works Across Instances (Priority: P2)

**Goal**: `@nestjs/throttler` uses the same Redis client as `CacheService` so rate-limit counters are shared across App Runner instances.

**Independent Test**: Two independent supertest agents hit a throttled endpoint; the 31st aggregate request returns 429.

### Tests for User Story 3 (TDD)

- [ ] T033 [P] [US3] Write `/Users/ahmadsekmani/Desktop/Projects/awamer-api/test/common/cache/throttler-redis.e2e-spec.ts` per spec §FR-033d and ticket §12.5 `throttler-redis.e2e-spec.ts`: two distinct supertest agents (`request.agent(app.getHttpServer())` twice) hit `/api/v1/certificates/verify/any-nonexistent-code` (rate-limited at 30/60s per KAN-73), first 30 from agent A succeed (404 or 429 depending on implementation behavior), additional requests from agent B start receiving 429, window reset confirmed by waiting and hitting again. Bootstraps via `test/content/test-app.ts`. Depends on T034.

### Implementation for User Story 3

- [X] T034 [US3] Edit `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/app.module.ts` to:
   - Convert `ThrottlerModule.forRootAsync` from a plain `useFactory: (config: ConfigService)` signature to one that also injects `REDIS_CLIENT` alongside `ConfigService`.
   - Add `CacheModule` to the `imports` array for `ThrottlerModule.forRootAsync` (so the `REDIS_CLIENT` token is resolvable).
   - In the `useFactory`, construct `new ThrottlerStorageRedisService(redis)` (or the equivalent from the chosen package) and pass it as `storage` alongside the existing `throttlers` array built from `THROTTLE_TTL` and `THROTTLE_LIMIT`.
   - Preserve the global `APP_GUARD → ThrottlerGuard` registration unchanged.
- [ ] T035 [US3] Run `npm run test:e2e -- --testPathPattern='throttler-redis'`. The test must show HTTP 429 triggered across two separate agents. If the chosen storage package is incompatible with `@nestjs/throttler ^6.5.0`, fall back to the alternative per research R2 and rerun.

**Checkpoint**: Rate limiting is globally correct. SC-003 achieved.

---

## Phase 6: User Story 4 — Dormant Revalidation Helper Verified (Priority: P3)

**Goal**: `RevalidationHelper` is proven dormant by default and proven active under env-var configuration, even though no consumer endpoint exists in awamer-web yet.

**Independent Test**: Unit spec exercises both env-var branches; e2e marketing-cache spec (T025) already confirms the helper is invoked from the real call sites.

### Tests for User Story 4 (TDD)

- [X] T036 [P] [US4] Write `/Users/ahmadsekmani/Desktop/Projects/awamer-api/src/common/cache/revalidation.helper.spec.ts` per `contracts/revalidation-helper.md` test assertions: dormant when `FRONTEND_REVALIDATE_SECRET` unset (no `fetch` call, debug log emitted), dormant when `FRONTEND_URL` unset, active when both set (exact POST with method/URL/headers/body matched), swallows rejected fetch promise without throwing, logs warn on failure. Mock `ConfigService` and stub the global `fetch`. Depends on T009.

### Implementation for User Story 4

> No new implementation — T009 already delivered the helper. This phase is test-only and confirms the dormancy contract.

- [X] T037 [US4] Run `npm test -- --testPathPattern='revalidation.helper'`. All assertions must pass.

**Checkpoint**: Dormant helper contract verified. When the frontend ticket ships `/api/revalidate` and the operator sets `FRONTEND_REVALIDATE_SECRET` in production, activation is a configuration change with no code change.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T038 [P] Update `/Users/ahmadsekmani/Desktop/Projects/awamer-api/README.md` with a short "Caching" section covering: key conventions (`{scope}:{subcategory}:{identifier}`), TTL policy table, invalidation rules, the `docker-compose up` local setup, and a pointer to `src/common/cache/cache-keys.ts` as the single source of truth. Ticket §14.17.
- [ ] T039 Run the full Definition of Done gate locally:
   - `npm run build` — zero TypeScript errors (§14.1)
   - `npx prisma validate` — still passes (§14.2)
   - `npm run test:schema` — green (§14.3)
   - `npm run test:content:e2e` — green (§14.4)
   - `npm test` — all unit specs green (§14.5)
   - `grep -rn "TODO(KAN-74)" src/` — zero matches (§14.6, already checked in T030)
   - `git diff prisma/` — empty (§14.9)
   - `git diff src/auth src/users src/onboarding src/enrollment src/progress src/certificates src/learning src/common/guards src/common/filters src/analytics` — empty (§14.10)
   - `docker-compose up -d && curl http://localhost:3001/api/v1/health` — returns `cache: 'connected'` (§14.11, §14.12)
- [ ] T040 Run the `quickstart.md` verification checklist end-to-end (12 steps) against a fresh checkout of the branch. Fix any doc drift before PR.
- [X] T041 Prepare the PR description summarizing: (a) scope deviation from ticket §10 (full compose created from scratch per Q1), (b) FR-017a exception in `ReplaceTagAssociationsHelper` per Q2, (c) health endpoint database + uptime extension per Q3, (d) all new dependencies justified (`ioredis`, `@nest-lab/throttler-storage-redis`, `ioredis-mock`). **Dependency budget gate**: after all dependency installations are complete, run `git diff master..HEAD package.json | grep -E '^\+\s+"' | wc -l` and assert the count is exactly **3** (or 4 if `@nestjs/throttler` was not pre-installed — but the audit confirmed it IS installed at v6.5.0, so the expected count is 3). Allowed additions: `ioredis`, `ioredis-mock` (devDep), `@nest-lab/throttler-storage-redis`. Any other addition must be explicitly justified in the PR description or the gate fails. Enforces SC-008.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)** has no dependencies; T003–T005 can be parallelized after T001/T002 complete.
- **Phase 2 (Foundational)** depends on Phase 1. Within Phase 2, T006 and T007 are `[P]` (independent files), T008 depends on both, T009 depends on `ConfigService` (already in the app — can start alongside T006/T007), T010 depends on T006–T009, T011 depends on T010.
- **Phase 3 (US1)** depends on Phase 2 complete.
- **Phase 4 (US2)** depends on Phase 2 complete. Can run **in parallel with Phase 3** (different files — content services vs. health controller).
- **Phase 5 (US3)** depends on Phase 2 complete. Edits `app.module.ts` which Phase 2 already touched (T011), so T034 must come after T011.
- **Phase 6 (US4)** depends on T009 only. Can run in parallel with any of Phases 3–5.
- **Phase 7 (Polish)** depends on Phases 3–6 complete.

### File contention

- `src/app.module.ts` is edited in **T005** (Phase 1 — Joi schema) → **T011** (Phase 2 — register `CacheModule`) → **T034** (Phase 5 — switch `ThrottlerModule` to Redis storage). Even when stories otherwise parallelize, these three tasks must serialize their edits to this file to avoid merge conflicts. If two developers are working in parallel, the developer owning a later edit must rebase onto the earlier edit before starting.

### User story dependencies

- **US1** and **US2** are both P1 and form the MVP; they are file-disjoint and can be implemented in parallel by two developers.
- **US3** depends only on Phase 2 (the Redis client factory) but edits `src/app.module.ts`, which also had Phase 2 edits — coordinate if developers overlap.
- **US4** depends only on T009 and is pure test work.

### Within each user story

- Tests MUST be written before implementation (TDD — research expects RED first, GREEN after).
- The three marketing service edits (T027–T029) are structurally identical: inject `CacheService` + `RevalidationHelper`, call `this.cache.invalidateOwner(...)` + `this.cache.slugFor(...)` + `this.revalidation.revalidatePath(...)` at each marker. No private helpers are added to any marketing service — slug lookup is centralized in `CacheService.slugFor` (delivered in T008). T027, T028, T029 can run in parallel on independent files.

---

## Parallel Execution Examples

### Phase 1 — Setup (after T001+T002)
```
T003  Create docker-compose.yml
T004  Edit .env.example
T005  Edit Joi schema in app.module.ts   # sequential with T011 later
```

### Phase 2 — Foundational skeleton
```
T006  Create cache-keys.ts
T007  Create redis.provider.ts
(then) T008  cache.service.ts  → depends on T006, T007
(parallel) T009  revalidation.helper.ts
(then) T010  cache.module.ts   → depends on T006-T009
(then) T011  Register in app.module.ts
```

### Phase 3 — User Story 1 tests (parallel)
```
T012  cache.service.spec.ts
T013  cache-keys.spec.ts
T014  cache.service.e2e-spec.ts
T015  health-cache.e2e-spec.ts    # depends on T017 implementation-side
```
Implementation: T016 → T017 → T018 → T019.

### Phase 4 — User Story 2 tests (parallel)
```
T020  tags.service.spec.ts
T021  features.service.spec.ts
T022  faqs.service.spec.ts
T023  testimonials.service.spec.ts
T024  tags-cache-invalidation.e2e-spec.ts
T025  marketing-cache-invalidation.e2e-spec.ts
```
Implementation: T026 (tags) is independent of T027/T028/T029 (marketing).
T028 and T029 are `[P]` with each other once T027 establishes the pattern.
T030, T031 are gates — run after T026–T029.

---

## Implementation Strategy

### MVP = US1 + US2

Both are P1. The ticket's Definition of Done requires both — shipping only one delivers no observable value (cache infra with no consumers, or invalidation calls with no cache to invalidate).

1. Complete **Phase 1 (Setup)** — all five tasks.
2. Complete **Phase 2 (Foundational)** — the cache skeleton boots with the app.
3. In parallel (if two developers): **Phase 3 (US1)** and **Phase 4 (US2)**.
4. **STOP AND VALIDATE**: run T030, T031, T032 gates. Run `docker-compose up`, hit `/health`, confirm `cache: connected`, run the full test suite.
5. Demo-ready.

### Incremental delivery after MVP

- **Phase 5 (US3)** — rate-limit correctness hardening for multi-instance deployment. Ship when App Runner scales > 1.
- **Phase 6 (US4)** — no shipped behavior change; tests lock in the dormancy contract so the frontend can activate it later with zero code change.
- **Phase 7 (Polish)** — docs + full DoD gate + PR prep.

### Parallel team strategy

With two developers:
- Dev A: Phases 1 → 2 → 3 (US1 cache infra + health).
- Dev B: joins at Phase 2 checkpoint, takes Phase 4 (US2 sweep).
- Either developer: Phase 5 (US3) and Phase 6 (US4) after the MVP is green.
- Both: Phase 7 polish together.

---

## Notes

- Every content-service edit in Phase 4 (T026–T029) must respect FR-019: the ONLY permitted changes are (a) marker replacement, (b) constructor DI additions, (c) new imports, and (d) T026's FR-017a exception for `ReplaceTagAssociationsHelper`. **No new methods** are added to any content service — slug lookup is centralized in `CacheService.slugFor` (T008), not duplicated as private helpers per service. Any other change fails review.
- Cache key strings MUST come from `CacheKeys` helpers everywhere outside `cache-keys.ts` and its spec file. T031 is the enforcement gate.
- Unit tests for content services (T020–T023) ADD new `it()` blocks — they never remove or replace existing assertions. KAN-71/KAN-72 coverage must stay intact.
- All new files live under `src/common/cache/` or `test/common/cache/` — no sprawl into unrelated directories.
- Commit after each task or logical group. Use commit messages of the form `feat(cache): KAN-74 — <task summary>`.
- Stop at any Checkpoint to validate story independence before proceeding.
- **Do not touch** any path listed in FR-034 / ticket §15. A clean `git diff` against those paths is a merge gate (T039).
