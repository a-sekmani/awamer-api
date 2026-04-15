# Phase 0 Research — KAN-74 Redis CacheModule

All technical decisions and alternatives. Each entry has Decision / Rationale / Alternatives.

---

## R1. Redis client library

**Decision**: Direct `ioredis` client, wrapped in a NestJS factory provider under token `REDIS_CLIENT`.

**Rationale**:
- Audit finding #3 — nothing is installed, so no pressure to reuse `@nestjs/cache-manager`.
- `nestjs-throttler-storage-redis` / `@nest-lab/throttler-storage-redis` require a raw `ioredis` instance regardless, so choosing `ioredis` lets the throttler storage share the exact same client (one connection, one pool, one lifecycle).
- Direct Redis access gives us `SCAN` + `UNLINK`/`DEL` for `delByPattern` without fighting an abstraction layer.
- Matches ticket §13.1 default assumption (Approach A).

**Alternatives considered**:
- `@nestjs/cache-manager` + `cache-manager-redis-store` — rejected: adds two layers of abstraction for a single backend, complicates sharing the client with throttler storage, and does not expose cursor-based pattern delete cleanly.
- `node-redis` (`redis` v4+) — rejected: `ioredis` has better community support in NestJS, and `throttler-storage-redis` packages expect `ioredis`.

---

## R2. Throttler Redis-storage package

**Decision**: `@nest-lab/throttler-storage-redis` as the primary target, with `nestjs-throttler-storage-redis` as a fallback if version incompatibility with `@nestjs/throttler ^6.5.0` surfaces during implementation.

**Rationale**:
- `@nest-lab/throttler-storage-redis` is the actively maintained fork and explicitly supports `@nestjs/throttler` v6.
- `nestjs-throttler-storage-redis` is older and marked as legacy but still functional with v6 per GitHub issues. Acceptable fallback.
- Both packages accept a raw `ioredis` client in the constructor, enabling single-connection reuse (R1).

**Alternatives considered**:
- Custom in-repo ThrottlerStorage implementation — rejected: reinventing a well-understood primitive for no gain. Revisited only if both packages fail installation.

**Installation contract**: package is added to `dependencies`, justified in the PR description per ticket §14.19.

---

## R3. In-memory Redis fake for unit tests

**Decision**: `ioredis-mock` as a devDependency. All `CacheService.*.spec.ts` and `cache-keys.spec.ts` construct `CacheService` with an `ioredis-mock` instance instead of a real client.

**Rationale**:
- `ioredis-mock` is a drop-in compatible fake supporting `SCAN`, `DEL`, `GET`, `SET`, `EXPIRE`, `PING`, etc.
- Allows deterministic unit tests with no external dependency — essential for CI hygiene.
- Required for simulating Redis-unreachable paths (the mock can be configured to throw on specific commands via jest spies).

**Alternatives considered**:
- In-memory `cache-manager` store — rejected: doesn't match `ioredis` API shape; abstraction mismatch defeats the test.
- Real Redis for unit tests — rejected: slow, requires Docker for every local run, violates unit-test hygiene.

---

## R4. Cache-aside pattern for tags `listPublic` (marker #1)

**Decision**: Standard cache-aside (lazy population).

```typescript
async listPublic(): Promise<TagResponseDto[]> {
  const cached = await this.cache.get<TagResponseDto[]>(CacheKeys.tags.all());
  if (cached !== null) return cached;

  const tags = await this.prisma.tag.findMany({
    where: { status: TagStatus.ACTIVE },
    // existing query unchanged
  });
  const dto = tags.map(mapToDto); // existing logic unchanged
  await this.cache.set(CacheKeys.tags.all(), dto, CacheTTL.TAGS);
  return dto;
}
```

**Rationale**:
- Ticket §11 table omits the read site; inferred from §4.3 invalidation rules that pair `tags:all` key reads with mutation invalidations.
- Cache-aside is the only pattern that respects FR-019 (no logic changes beyond wiring) — the DB query and DTO mapping stay byte-identical; only a `get` wrap and a `set` after the query are added.
- `CacheTTL.TAGS = null` (no automatic expiry, invalidation-only) matches the §4.2 policy.

**Alternatives considered**:
- Write-through on mutation — rejected: requires the mutation site to know the full public-list shape, which would be a logic change.
- Refresh-ahead — rejected: overkill for a low-cardinality tag list.

---

## R5. Slug lookup for marketing revalidation (ticket §13.3)

**Decision**: **Option A** — one Prisma lookup per mutation to resolve `ownerType + ownerId → slug` before invoking `RevalidationHelper.revalidatePath`. **Slug lookup is centralized in `CacheService.slugFor(ownerType, ownerId)`** to avoid duplicating the lookup across three marketing services and to keep marketing service edits to DI + marker replacement only (FR-019 mechanical-sweep guarantee).

**Rationale**:
- Clean public URL contract — revalidation paths stay `/paths/{slug}` / `/courses/{slug}`, never leaking UUIDs.
- One extra read per admin mutation is negligible compared to the mutation write cost.
- Ticket §13.3 default.
- Centralizing in `CacheService` means marketing services only gain DI additions — no new private methods — honoring FR-019 literally.
- Future modules (path detail pages, course detail pages, any owner-scoped mutation) can consume the same helper.

**Alternatives considered**:
- UUID-in-URL revalidation — rejected per ticket §13.3.
- Cache the owner slug alongside every mutation — rejected: adds a cache-write on a path that already has cache-invalidation; churn.
- Private `lookupOwnerSlug` method on each marketing service — rejected: duplicates identical code three times and violates FR-019's "no new methods" rule.

**Implementation note**: `CacheService.slugFor` injects `PrismaService` (already globally available via `PrismaModule`), queries `prisma.path.findUnique` or `prisma.course.findUnique` based on `ownerType`, and returns `slug | null`. Errors are swallowed and `null` is returned — matches the CacheService never-throw contract from FR-002. Callers treat `null` as "skip revalidation, best-effort."

---

## R6. `delByPattern` implementation

**Decision**: Cursor-based `SCAN` with `COUNT 500`, accumulating keys and issuing `UNLINK` (non-blocking delete) in batches of 500.

**Rationale**:
- `KEYS` blocks Redis and is forbidden in production (O(N) on the keyspace).
- `UNLINK` (Redis ≥ 4.0) reclaims memory asynchronously, avoiding frontend stalls on large deletes.
- COUNT 500 balances scan overhead against single-scan latency; SC-005 target (10k keys < 500 ms) is easily achievable.

**Alternatives considered**:
- `FLUSHDB` / `FLUSHALL` — rejected: destroys unrelated keys (throttler counters, future refresh tokens).
- Lua script server-side scan+delete — rejected: adds operational complexity for marginal gain; only worth revisiting if SC-005 is missed.

---

## R7. TLS auto-detection from URL scheme

**Decision**: `new Redis(url, { tls: url.startsWith('rediss://') ? {} : undefined })`.

**Rationale**:
- Production AWS ElastiCache with in-transit encryption uses `rediss://`.
- Local Docker Compose Redis uses `redis://` (no TLS).
- A single env var switches behavior — no code change between environments.

**Alternatives considered**:
- Hardcoded `tls: {}` — rejected: breaks local dev where the container does not serve TLS.
- Separate `REDIS_TLS` env var — rejected: redundant with the URL scheme; two sources of truth.

---

## R8. Error handling philosophy

**Decision**: Every public `CacheService` method except `isHealthy` wraps its Redis call in a try/catch that logs at `warn` and returns a neutral sentinel (`null` / `void` / `false` / `0`). `isHealthy` is the only method that may surface the failure to callers (the health endpoint needs to know).

**Rationale**:
- Ticket §5.2 is explicit and emphatic: Redis is non-critical; cache failures must never produce 5xx.
- Consistency with FR-002 and FR-024.

**Alternatives considered**:
- Per-method opt-in error suppression — rejected: introduces hidden footguns at every call site; safer to bake it into the service once.
- Circuit breaker (open/closed state) — rejected: overengineering for a local cache layer; `ioredis` already reconnects with exponential backoff.

---

## R9. Joi env schema additions

**Decision**: Extend the existing `ConfigModule.forRoot` Joi schema in `src/app.module.ts` to validate:
- `REDIS_URL` — required `string().uri({ scheme: ['redis', 'rediss'] })`
- `FRONTEND_REVALIDATE_SECRET` — optional `string().allow('')`
- `FRONTEND_URL` — already validated; no change

**Rationale**:
- Fails fast at boot if `REDIS_URL` is missing or malformed in prod (clearer than a runtime connection error).
- `FRONTEND_REVALIDATE_SECRET` is optional because dormancy is expected in dev and pre-frontend-ticket environments (FR-026).

**Alternatives considered**:
- Read raw `process.env` in the factory provider — rejected: bypasses the existing validation pipeline and diverges from the project pattern.

---

## R10. Health database check (Q3 resolution)

**Decision**: Inject `PrismaService` into `HealthController` (via `PrismaModule` import in `HealthModule`) and run `await this.prisma.$queryRaw\`SELECT 1\`` inside a try/catch. Success → `"connected"`, failure → `"disconnected"`. When `"disconnected"`, the top-level `status` changes from `"ok"` to `"degraded"`.

**Rationale**:
- Per Q3 answer: add `database`, `cache`, `uptime` together in this ticket.
- `SELECT 1` is the standard postgres liveness probe; `prisma.$queryRaw` wraps it cleanly.
- `process.uptime()` (native Node.js API) powers the `uptime` field — no dependency cost.
- Preserves ticket §8 rule: cache disconnection does NOT degrade overall status; database disconnection does.

**Alternatives considered**:
- `prisma.$executeRaw` — rejected: intended for mutations.
- Separate `@Health()` decorator / `@nestjs/terminus` — rejected: adds a dependency for a 10-line controller. §13.5 explicitly permits a minimal inline implementation.

---

## R11. Scope of un-marked `ReplaceTagAssociationsHelper` edit (Q2 resolution)

**Decision**: Treat the un-marked helper as an invalidation site. Edit is constrained to: (a) inject `CacheService` into the helper (or the class that owns it) via constructor, (b) add two `delByPattern` calls (`paths:list:*` and `courses:list:*`) at the end of the existing association-rewrite method. No logic change, no rename, no new methods.

**Rationale**:
- Q2 answer: add invalidation despite missing marker.
- Staying minimal (two cache calls + DI) keeps the spirit of FR-019's "no logic changes" rule intact.
- FR-017a documents this as an explicit, spec-sanctioned exception to the pure-marker-sweep rule.

**Alternatives considered**:
- Open a follow-up ticket instead — rejected by operator in Q2.
- Refactor the helper to route through tags service mutation path — rejected: violates FR-019.

---

## R12. Docker Compose file shape (Q1 resolution)

**Decision**: Create a new root-level `docker-compose.yml` containing both `postgres` (pg 16-alpine, port 5432, persistent `postgres_data` volume, healthcheck) and `redis` (`redis:7-alpine`, port 6379, persistent `redis_data` volume, healthcheck). Postgres version will match whatever the developer's local setup currently uses; pg 16 is the conservative modern default and aligns with Prisma 6.19 supported ranges.

**Rationale**:
- Q1 answer: full compose.
- `docker-compose up` is a stated DoD item (ticket §14.11); the file must make that command work end-to-end.
- Passwords/user in Postgres service default to `awamer / awamer / awamer` matching the current `.env.example` `DATABASE_URL` default shape.

**Alternatives considered**:
- Separate `docker-compose.dev.yml` — rejected: adds a second file for no gain.
- Reference an external pinned Postgres version via env var — rejected: overengineering for dev infra.

---

## R13. Test infrastructure for e2e cache tests

**Decision**: Reuse `test/content-e2e-jest.config.js` + its `test/content/test-app.ts` bootstrap where possible. Add a new `test/common/cache/` directory for the five new e2e specs. Each spec sets `REDIS_URL=redis://localhost:6379` via `beforeAll` (using `@nestjs/testing`'s `ConfigModule.forFeature` override) and calls `redis.flushdb()` in `beforeEach` to isolate state.

**Rationale**:
- Avoid duplicating test bootstrap logic.
- `flushdb()` isolation is cheap (< 10 ms) and prevents cross-test state bleed.
- Throttler e2e test uses two distinct supertest agents against the same NestJS app instance; the shared Redis counter is the proof.

**Alternatives considered**:
- Spinning up an ephemeral Redis via `testcontainers` — rejected: adds a heavy dependency and Docker-in-CI complexity; Docker Compose already provides a Redis container for local + CI.

---

All NEEDS CLARIFICATION items from Technical Context are resolved. Proceed to Phase 1.
