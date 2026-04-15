# Feature Specification: KAN-74 — Redis CacheModule & Invalidation Sweep

**Feature Branch**: `012-redis-cache-module`
**Created**: 2026-04-15
**Status**: Draft — audit complete, clarifications in progress

## Clarifications

### Session 2026-04-15

- Q: `docker-compose.yml` scope — create full compose (Postgres + Redis), Redis only, or skip? → A: Full compose with both Postgres and Redis services
- Q: `ReplaceTagAssociationsHelper` has no `TODO(KAN-74)` marker — add invalidation anyway or skip? → A: Add invalidation; treat missing marker as a KAN-71 oversight
- Q: Health endpoint scope — add only `cache`, or also `database` and `uptime`? → A: Add `database`, `cache`, and `uptime` (full §13.5 extension)
**Source of Truth**: [docs/tickets/KAN-74.md](../../docs/tickets/KAN-74.md)
**Input**: "Use docs/tickets/KAN-74.md as the single source of truth. Audit §2 is mandatory and must report findings for all 9 items before implementation."

---

## §2 Audit Findings (MANDATORY — review before proceeding)

The ticket requires a pre-implementation audit of 9 items. Findings below were collected from the current `master` branch at commit `3754bd7`.

### 1. `docker-compose.yml`
**Does not exist.** There is no compose file at the repository root. The Redis service (and whatever existing Postgres service the ticket assumed) must be **created from scratch**, not extended. This is a scope expansion relative to §10.1 which said "Preserve all existing services." Local Postgres is currently provided by whatever the developer runs manually; adding a full compose file with both services is a reasonable widening but should be flagged to the operator.

### 2. `.env.example`
**Exists.** Current entries: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRATION`, `JWT_REFRESH_EXPIRATION`, Stripe keys, AWS keys, `S3_BUCKET_NAME`, `SES_FROM_EMAIL`, `POSTHOG_API_KEY`, `FRONTEND_URL=http://localhost:3000`, `ALLOWED_ORIGINS`, `PORT=3001`, `THROTTLE_TTL=60000`, `THROTTLE_LIMIT=100`.
- **No** `REDIS_URL` entry.
- **`FRONTEND_URL` already set** (to `http://localhost:3000`). The ticket §9 assumes leaving it empty keeps revalidation dormant; since it already has a value, the dormant-state gate must instead depend on `FRONTEND_REVALIDATE_SECRET` alone (which does not exist yet).
- No `FRONTEND_REVALIDATE_SECRET` entry.
- Format uses `KEY=value  # inline comment` convention.

### 3. Redis / cache libraries
- `ioredis` — **not installed**
- `cache-manager` — **not installed**
- `@nestjs/cache-manager` — **not installed**
- `cache-manager-redis-store` — **not installed**
- `ioredis-mock` — **not installed**

Per §13.1 decision rule: since nothing is installed, use **Approach A (direct `ioredis`)**.

### 4. `@nestjs/throttler`
**Installed at `^6.5.0`.** Configured in `src/app.module.ts` lines 55–65 via `ThrottlerModule.forRootAsync` with a `ConfigService` factory reading `THROTTLE_TTL` and `THROTTLE_LIMIT`. **Default in-memory store** (no storage option passed). `ThrottlerGuard` is registered globally via `APP_GUARD` at line 93–94. No Redis-backed throttler storage package is installed.

### 5. `src/common/cache/`
**Does not exist.** No CacheModule, CacheService, stub, or cache-keys file. This module is greenfield.

### 6. Health endpoint
**Exists at `src/health/health.controller.ts`** (registered via `src/health/health.module.ts`). Current implementation (entire file, 11 lines):

```typescript
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check() {
    return { status: 'ok' };
  }
}
```

Current response: `{ "status": "ok" }`. There is **no database check** and no uptime field. The ticket §8 assumes `{ status, database, uptime }` exists — it does not. The extension must add **both** the database field and the cache field, not just the cache field. Per §13.5, this is a small scope extension that must be documented in the PR.

### 7. `TODO(KAN-74)` marker sweep — **AUTHORITATIVE LIST**

**Count: 17 markers** across 4 files (matches the ticket's rough guess exactly):

| # | File | Line | Method | Context |
|---|---|---|---|---|
| 1 | `src/content/tags/tags.service.ts` | 27 | `listPublic` | `// TODO(KAN-74): wire CacheService here — cache key 'tags:public:list'` (**READ/SET site**) |
| 2 | `src/content/tags/tags.service.ts` | 45 | `create` | invalidate `'tags:public:list'` |
| 3 | `src/content/tags/tags.service.ts` | 73 | `update` | invalidate `'tags:public:list'` |
| 4 | `src/content/tags/tags.service.ts` | 101 | `remove` | invalidate `'tags:public:list'` |
| 5 | `src/content/marketing/features/features.service.ts` | 47 | `create` | invalidate cache for owner |
| 6 | `src/content/marketing/features/features.service.ts` | 69 | `update` | invalidate cache for owner |
| 7 | `src/content/marketing/features/features.service.ts` | 95 | `remove` | invalidate cache for owner |
| 8 | `src/content/marketing/features/features.service.ts` | 115 | `reorder` | invalidate cache for owner |
| 9 | `src/content/marketing/faqs/faqs.service.ts` | 47 | `create` | invalidate cache for owner |
| 10 | `src/content/marketing/faqs/faqs.service.ts` | 65 | `update` | invalidate cache for owner |
| 11 | `src/content/marketing/faqs/faqs.service.ts` | 88 | `remove` | invalidate cache for owner |
| 12 | `src/content/marketing/faqs/faqs.service.ts` | 108 | `reorder` | invalidate cache for owner |
| 13 | `src/content/marketing/testimonials/testimonials.service.ts` | 50 | `create` | invalidate cache for owner |
| 14 | `src/content/marketing/testimonials/testimonials.service.ts` | 76 | `update` | invalidate cache for owner |
| 15 | `src/content/marketing/testimonials/testimonials.service.ts` | 109 | `updateStatus` | invalidate cache for owner |
| 16 | `src/content/marketing/testimonials/testimonials.service.ts` | 128 | `remove` | invalidate cache for owner |
| 17 | `src/content/marketing/testimonials/testimonials.service.ts` | 148 | `reorder` | invalidate cache for owner |

**Important deviations from ticket §11 table**:
- **Marker #1 is a READ site, not an invalidation site.** It lives inside `TagsService.listPublic`. The ticket's §11 table only enumerates mutation markers and does not describe what to do at a read site. The correct replacement is a cache-aside pattern: `get` first, on miss query Prisma and `set` the result with `CacheTTL.TAGS` (null / no expiry).
- **No `ReplaceTagAssociationsHelper` marker was found.** Ticket §11 lists it as one of the invalidation sites, but `grep` finds no `TODO(KAN-74)` inside it. It may never have received a marker in KAN-71. **Operator decision needed** (see Q2): add invalidation anyway, or skip.

### 8. `AnalyticsService` pattern
`src/analytics/analytics.module.ts` is a **plain `@Module`, NOT `@Global()`**. It imports nothing, declares `AnalyticsController` + `AnalyticsService` providers, and exports `AnalyticsService`. Consumers must import `AnalyticsModule` explicitly. This **contradicts** the ticket's §6 claim that "CacheService needed by many modules… matches the pattern used by `PrismaModule` and `AnalyticsModule`." AnalyticsModule is not global today. CacheModule will still be `@Global()` because the design calls for it explicitly; the cited precedent is simply inaccurate and should not be treated as authoritative.

### 9. Next.js `/api/revalidate` endpoint
**Unknown — assume dormant.** This audit has no visibility into the `awamer-web` repository. No evidence in env vars (`FRONTEND_REVALIDATE_SECRET` absent) that the endpoint has shipped. Proceed on the assumption the helper remains dormant and is gated on `FRONTEND_REVALIDATE_SECRET` being set (NOT on `FRONTEND_URL`, which already has a value).

### Audit summary — open questions for operator

1. Docker Compose file does not exist. Create from scratch with both Postgres and Redis, Redis only, or skip? (Q1)
2. `ReplaceTagAssociationsHelper` has no `TODO(KAN-74)` marker. Add invalidation anyway, or skip? (Q2)
3. Health endpoint has no database check today. Adding one is a minor scope extension. Confirm in scope? (Q3)

---

## User Scenarios & Testing

### User Story 1 — Cache Infrastructure Available (Priority: P1)

The platform has a centralized, non-critical cache layer that every current and future module can use via a single injectable service. When the cache is unavailable, the application continues serving requests directly from the database.

**Why this priority**: Without this foundation, no subsequent caching work (KAN-26 public discovery endpoints, path/course detail pages) can ship. It is the enabling infrastructure for every downstream performance optimization.

**Independent Test**: Boot the application locally against a running Redis container, exercise `CacheService` through a test path, stop Redis, observe that the application continues serving requests without 500 errors and that `/health` reports `cache: "disconnected"`.

**Acceptance Scenarios**:

1. **Given** Redis is running locally and the application is started, **When** a caller stores a value under a key and reads it back, **Then** the same value is returned (round trip succeeds).
2. **Given** Redis becomes unreachable mid-request, **When** a caller attempts a cache read or write, **Then** the operation degrades silently (returns a miss or no-op), logs a warning, and the caller's business logic proceeds unaffected.
3. **Given** the application is running, **When** the operator inspects `GET /api/v1/health`, **Then** the response reports both database and cache connectivity status, and the overall status remains `"ok"` even if only the cache is disconnected.

---

### User Story 2 — Cache Invalidation Sweep (Priority: P1)

All 17 existing `TODO(KAN-74)` placeholders in tags and marketing services are replaced with real invalidation calls so that future public-read endpoints can safely consume cached data without serving stale content after a mutation.

**Why this priority**: The markers exist because KAN-71 and KAN-72 shipped write paths expecting this ticket to wire up invalidation. Until they are resolved, any caching added to public reads would serve stale data after admin edits — a correctness bug.

**Independent Test**: Run `grep -rn "TODO(KAN-74)" src/` — must return zero matches. For each mutation endpoint in the tags and marketing modules, unit-test that the appropriate cache invalidation method is called (via spy).

**Acceptance Scenarios**:

1. **Given** the tag list cache has been populated, **When** an admin creates, updates, or deletes a tag, **Then** the tag list cache entries and any affected public list caches (paths, courses) are invalidated.
2. **Given** a path owns features, faqs, and testimonials and their caches exist, **When** an admin mutates any of those marketing items (create, update, delete, reorder, or status change), **Then** the path's marketing caches and path detail/list caches are invalidated via a single owner-scoped helper call.
3. **Given** a marketing mutation has just completed, **When** the revalidation helper is invoked, **Then** a best-effort call to the frontend revalidation endpoint is issued only if `FRONTEND_REVALIDATE_SECRET` is configured; otherwise the call is skipped and logged at debug level.
4. **Given** the codebase is built, **When** the engineer runs `grep -rn "TODO(KAN-74)" src/`, **Then** the command returns zero matches.

---

### User Story 3 — Rate Limiting Works Across Instances (Priority: P2)

Rate limiting is enforced globally across multiple application instances, not per-process, so a single user cannot multiply their allowed request rate by the number of instances.

**Why this priority**: Correct once AWS App Runner scales beyond one instance. Until then, the in-memory store works functionally; the fix is a hardening step, not a blocker.

**Independent Test**: Drive two independent supertest clients against a rate-limited endpoint (e.g., `/certificates/verify/:code` at 30/60s). Under the Redis store, the 31st aggregate request returns 429 regardless of which client sent it.

**Acceptance Scenarios**:

1. **Given** two separate HTTP clients share a single throttled endpoint, **When** they collectively issue more than the allowed number of requests within the window, **Then** excess requests are rejected with HTTP 429 because the counter is shared across both clients.
2. **Given** the throttle window has elapsed, **When** either client issues a new request, **Then** it is accepted and the counter resets.

---

### User Story 4 — Dormant ISR Revalidation Helper (Priority: P3)

A helper is available that will notify the Next.js frontend to regenerate static pages after content changes. It ships in a dormant state so that activating it later is a configuration change, not a code change.

**Why this priority**: The consuming frontend endpoint does not exist yet. This is a pre-wiring convenience.

**Independent Test**: Unit-test the helper with `FRONTEND_REVALIDATE_SECRET` unset (no HTTP call issued) and with it set (POST issued, errors swallowed).

**Acceptance Scenarios**:

1. **Given** `FRONTEND_REVALIDATE_SECRET` is unset, **When** a mutation triggers the helper, **Then** no outbound HTTP call is made and a debug log line records the skip.
2. **Given** both `FRONTEND_URL` and `FRONTEND_REVALIDATE_SECRET` are set, **When** a mutation triggers the helper, **Then** a POST request is issued to `${FRONTEND_URL}/api/revalidate` with `{ secret, path }` as the body, and any network failure is logged and swallowed.

---

### Edge Cases

- **Redis unreachable at boot**: application must start successfully and log warnings. `/health` reports `cache: "disconnected"`. Requests that would have used the cache fall through to the database.
- **Redis becomes unreachable mid-session**: ongoing and new cache operations return miss / no-op; no 5xx leaks to clients.
- **Corrupted JSON in a cached value**: reader receives `null` (treated as a miss), warning logged, next write overwrites.
- **Large key-set invalidation**: pattern deletions must use cursor-based scanning and batching to avoid blocking Redis; any single invalidation should complete in sub-second time for realistic key counts (< 100k keys per pattern).
- **Marketing mutation on a just-deleted owner**: slug lookup for revalidation may fail; the helper must swallow this and continue.
- **UTF-8 content (Arabic text)**: cache values must round-trip Arabic strings byte-identical.
- **TLS Redis (`rediss://`)**: connection must auto-enable TLS based on URL scheme.
- **Concurrent mutations on the same owner**: invalidation is idempotent; last-writer-wins is acceptable.

---

## Requirements

### Functional Requirements

**Cache service (FR-001 – FR-010)**

- **FR-001**: System MUST expose a globally injectable `CacheService` with methods `get<T>`, `set<T>`, `del`, `delByPattern`, `invalidateOwner`, and `isHealthy`.
- **FR-002**: `CacheService.get`, `set`, `del`, and `delByPattern` MUST NEVER throw on Redis connection, serialization, or protocol errors. They MUST log the error and return a sentinel value (`null`, `void`, `false`, or `0` respectively) so that callers treat failures as cache misses.
- **FR-003**: `CacheService.isHealthy` is the single method permitted to surface connection failure, returning `false` when Redis does not respond to PING.
- **FR-004**: All values MUST be JSON-serialized on write and JSON-parsed on read. Binary values are not supported.
- **FR-005**: `delByPattern` MUST use cursor-based scanning and delete in bounded batches so that large key sets do not block Redis.
- **FR-006**: `invalidateOwner(type, id)` MUST delete all marketing caches for that owner plus all detail and list caches for the scope (`paths:detail:*`, `paths:list:*` for `type='path'`; course equivalents for `type='course'`).
- **FR-007**: The Redis client MUST be created via a factory provider reading `REDIS_URL`, with TLS auto-enabled when the scheme is `rediss://`.
- **FR-008**: The Redis client MUST close cleanly on module shutdown.
- **FR-009**: `CacheModule` MUST be declared global and registered once in `AppModule`.
- **FR-010**: Cache keys MUST be produced exclusively via helper functions declared in a single `cache-keys` constants file. No module may concatenate cache keys inline; this is verifiable by static grep.

**Cache key and TTL policy (FR-011 – FR-014)**

- **FR-011**: Cache keys MUST follow `{scope}:{subcategory}:{identifier-or-hash}`, lowercase, colon-separated, containing only `a-z0-9`, `:`, and `-`.
- **FR-012**: Query-hash keys MUST be deterministic (query parameter order-independent), produced by hashing the normalized parameter set and truncating to 16 hex characters.
- **FR-013**: TTLs MUST be declared as named constants co-located with the key helpers. Tags, categories, detail, and marketing families default to no-expiry (invalidation-only); list families default to 5 minutes.
- **FR-014**: Every `set()` call MUST pass a TTL sourced from the constants object. Raw numeric literals are forbidden except in isolated debug utilities which MUST document the deviation inline.

**Invalidation sweep (FR-015 – FR-019)**

- **FR-015**: System MUST replace all **17** `TODO(KAN-74)` markers identified in §2 audit task 7 plus the un-marked helper site from FR-017a (**18 invalidation sites total**) with real `CacheService` (and where applicable `RevalidationHelper`) calls. Post-sweep, `grep -rn "TODO(KAN-74)" src/` MUST return zero matches.
- **FR-016**: The tags `listPublic` read site (marker #1) MUST implement the cache-aside pattern: read from cache, on miss query the database and populate the cache with the tags TTL before returning. The cache key used is `CacheKeys.tags.all()` (= `'tags:all'`), NOT the placeholder string `'tags:public:list'` from the original KAN-71 TODO comment text.
- **FR-017**: The three tags mutation sites (markers #2, #3, #4) MUST invalidate `tags:all`, `tags:admin:all`, and `paths:list:*` + `courses:list:*` via pattern delete.
- **FR-017a**: `ReplaceTagAssociationsHelper` MUST also invalidate `paths:list:*` and `courses:list:*` on every invocation, even though no `TODO(KAN-74)` marker exists inside it today. This addition is treated as a KAN-71 oversight correction; it is the only permitted edit beyond marker replacement in `src/content/tags/` and is constrained to adding cache invalidation calls plus the required dependency injection (no logic changes).
- **FR-018**: All 13 marketing mutation sites (markers #5–#17) MUST call `CacheService.invalidateOwner(ownerType, ownerId)` and `RevalidationHelper.revalidatePath` with the path/course slug resolved via `CacheService.slugFor(ownerType, ownerId)`. Slug lookup for revalidation is provided by `CacheService.slugFor(ownerType, ownerId)`. Marketing services call this helper rather than implementing private slug-lookup methods, preserving the FR-019 mechanical-sweep guarantee.
- **FR-019**: The only permitted edits to files under `src/content/tags/` and `src/content/marketing/` are (a) replacing `TODO(KAN-74)` comments with cache/revalidation calls, (b) adding the required dependency injections to constructors, and (c) adding relevant imports. No logic changes, renames, signature changes, or new methods are permitted, except for the edits required by FR-017a (the `ReplaceTagAssociationsHelper` invalidation site). Verifiable by diff review.

**Throttler integration (FR-020 – FR-021)**

- **FR-020**: `@nestjs/throttler` MUST be reconfigured to use a Redis-backed storage sharing the same Redis client instance, replacing the default in-memory store currently configured in `src/app.module.ts`.
- **FR-021**: An end-to-end test MUST demonstrate that two independent HTTP clients hitting a throttled endpoint share a single counter window.

**Health check (FR-022 – FR-024)**

- **FR-022**: `GET /api/v1/health` MUST return a JSON body containing `status`, `database`, `cache`, and `uptime` fields. The current endpoint (which returns only `{ status: 'ok' }`) MUST be extended in this ticket per §13.5.
- **FR-022a**: The `database` field MUST reflect a live database connectivity check (e.g., `SELECT 1`): `"connected"` on success, `"disconnected"` on failure.
- **FR-022b**: The `uptime` field MUST report the process uptime in seconds since application start.
- **FR-023**: The `cache` field MUST reflect `CacheService.isHealthy()`: `"connected"` on success, `"disconnected"` on failure.
- **FR-024**: A disconnected cache MUST NOT change the top-level `status` from `"ok"`; a disconnected database MUST change overall `status` (preserve whatever degraded/error convention is introduced by the new database check).

**Revalidation helper (FR-025 – FR-027)**

- **FR-025**: System MUST provide `RevalidationHelper.revalidatePath(path)` that POSTs `{ secret, path }` to `${FRONTEND_URL}/api/revalidate`.
- **FR-026**: The helper MUST be dormant — i.e., make no outbound call — whenever `FRONTEND_REVALIDATE_SECRET` is unset. Because `FRONTEND_URL` already has a value in the current `.env.example`, the gate MUST be on the secret, not the URL.
- **FR-027**: The helper MUST swallow all network errors and log them at warn level; failure MUST NOT propagate to the caller.

**Local environment (FR-028 – FR-029)**

- **FR-028**: A new `docker-compose.yml` MUST be created at the repository root containing BOTH a Postgres service (matching the version currently used in local dev) AND a Redis service (`redis:7-alpine`, port 6379, persistent volume `redis_data`, healthcheck via `redis-cli ping`). Both services MUST start successfully with `docker-compose up` and the application MUST connect to both out of the box.
- **FR-029**: `.env.example` MUST gain `REDIS_URL=redis://localhost:6379` and `FRONTEND_REVALIDATE_SECRET=` (empty), preserving all existing entries.

**Testing (FR-030 – FR-033)**

- **FR-030**: Unit tests MUST cover all `CacheService` methods against an in-memory Redis fake, including happy paths, Redis-unreachable paths, and serialization-error paths.
- **FR-031**: Unit tests MUST assert each key-builder in the cache-keys file is deterministic and produces the expected format.
- **FR-032**: Existing `tags.service.spec.ts`, `features.service.spec.ts`, `faqs.service.spec.ts`, and `testimonials.service.spec.ts` MUST gain new `it()` blocks (added, not replacing) asserting the correct cache invalidation calls on every mutation.
- **FR-033**: End-to-end tests MUST cover (a) CacheService round-trip against real Redis, (b) tag mutation invalidation observed through the public list endpoint, (c) marketing mutation invalidation observed via spy (consumer endpoints ship in KAN-26), (d) throttler sharing across two clients, (e) health endpoint reporting cache state with Redis up and with Redis simulated-down.

**Scope guardrails (FR-034)**

- **FR-034**: `prisma/`, `src/auth`, `src/users`, `src/onboarding`, `src/enrollment`, `src/progress`, `src/certificates`, `src/learning`, `src/common/guards`, `src/common/filters`, `src/analytics`, and `prisma/seed.ts` MUST NOT be modified. A clean `git diff` against those paths is a merge gate.

### Key Entities

- **CacheService**: a globally injectable service offering typed get / set / del / pattern-delete / owner-invalidate / health methods over Redis. Non-critical — failures degrade to cache misses.
- **CacheKeys registry**: a single source-of-truth object whose properties are pure functions that build cache keys. Enforces that keys cannot be constructed ad-hoc anywhere else in the codebase.
- **CacheTTL registry**: named constants co-located with `CacheKeys` declaring the TTL for each cache family (null means no expiry).
- **RevalidationHelper**: an injectable best-effort HTTP client that notifies the frontend to regenerate ISR pages. Dormant unless the revalidation secret is configured.
- **CacheModule**: a global module that wires the Redis client (factory provider from `REDIS_URL`), `CacheService`, and `RevalidationHelper` and manages client lifecycle.
- **Redis**: external key-value store reached over `REDIS_URL`. Local dev uses a Docker container; production will use AWS ElastiCache (provisioning out of scope).

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: `grep -rn "TODO(KAN-74)" src/` returns **zero** matches after the sweep.
- **SC-002**: With Redis stopped, the application continues to serve every public endpoint successfully, and no request returns HTTP 5xx that would have returned 2xx with Redis running.
- **SC-003**: Two independent HTTP clients collectively limited to 30 requests per 60 seconds observe the 31st aggregate request returning HTTP 429, confirming shared rate-limit state.
- **SC-004**: `GET /api/v1/health` returns a body containing `cache: "connected"` within 50 ms of a healthy-Redis request, and `cache: "disconnected"` within 500 ms when Redis is unreachable.
- **SC-005**: A pattern-based invalidation of up to 10,000 keys completes in under 500 ms without blocking Redis against other clients.
- **SC-006**: Every existing test suite (`test:schema`, `test:content:e2e`, `test`) remains green — zero behavior regressions in KAN-70/71/72/73.
- **SC-007**: The full tags/marketing mutation → invalidation → next-read cycle produces fresh content on the very next read, measured by an integration test that seeds, reads, mutates, and re-reads.
- **SC-008**: Exactly zero new production dependencies beyond `ioredis` and one community Redis-throttler-storage package, plus `ioredis-mock` as a devDependency. Any addition is justified in the PR description.

---

## Assumptions

1. Local development uses Docker for Postgres and Redis. If no `docker-compose.yml` exists today (audit finding #1), this ticket will create one unless the operator directs otherwise (Q1).
2. Production Redis will be provisioned as AWS ElastiCache via separate DevOps work; this ticket only delivers code that connects to `REDIS_URL` and assumes the URL will be populated at deploy time.
3. `AnalyticsModule` precedent cited in the ticket §6 is inaccurate — it is not declared `@Global()` today. CacheModule will be global anyway because the design calls for it explicitly.
4. The frontend `/api/revalidate` endpoint does not exist and will ship in a later frontend ticket. The helper is dormant by default, gated on `FRONTEND_REVALIDATE_SECRET` presence rather than `FRONTEND_URL` (which already has a value in the current `.env.example`).
5. Slug lookup on marketing mutations (one extra DB query per mutation) is acceptable, per §13.3 Option A.
6. `ReplaceTagAssociationsHelper` has no `TODO(KAN-74)` marker in the current code despite the ticket table claiming it should. Default action is to add invalidation there regardless, treating the missing marker as an oversight — operator confirmation requested in Q2.
7. The current `/health` endpoint has no database check today; adding one is a small scope extension covered by §13.5 and included here. Operator confirmation requested in Q3.
8. `ioredis-mock` is the standard in-memory fake for unit tests and is acceptable as a new devDependency.
9. `nestjs-throttler-storage-redis` or `@nest-lab/throttler-storage-redis` is acceptable as the Redis-backed throttler storage package; exact package is a plan-phase decision based on maintenance status at implementation time.
10. No refresh-token storage, session storage, per-user caching, or caching of KAN-73 user-specific endpoints is in scope — explicitly deferred per ticket §3.

---

## Out of Scope (reiterated from ticket §3 and §15)

- AWS ElastiCache provisioning
- Frontend `/api/revalidate` endpoint
- Refresh token / session storage in Redis
- Per-user caching of KAN-73 endpoints
- Any modification to Prisma schema, migrations, auth/users/onboarding, enrollment/progress/certificates/learning, common guards/filters, or `src/analytics`
- Any logic change, rename, or refactor in `src/content/tags` or `src/content/marketing` beyond the mechanical marker sweep and DI additions
- New npm dependencies beyond `ioredis`, one Redis-backed throttler storage package, and `ioredis-mock` (dev)