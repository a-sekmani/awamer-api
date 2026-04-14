# Phase 0 — Research: Marketing Content Module

**Feature**: 010-marketing-content
**Date**: 2026-04-14

Technical Context had no unresolved `NEEDS CLARIFICATION` markers (the spec + ticket fully specify the problem). The research below consolidates the design decisions needed to implement without further iteration.

---

## Decision 1 — Polymorphic owner integrity is enforced at the service layer

**Decision**: `OwnerValidator.ensureOwnerExists(ownerType, ownerId)` performs a `findUnique({ where: { id } })` against `prisma.path` or `prisma.course` before every admin create/update. On miss, throw `NotFoundException("Path 'xyz' does not exist")` / `"Course 'xyz' does not exist"`. Unknown `ownerType` (defensive, shouldn't happen under `@IsEnum`) also throws `NotFoundException`.

**Rationale**: The Prisma schema (KAN-70) deliberately stores ownership as two scalar columns (`ownerType`, `ownerId`) with no `@relation`, so `onDelete: Cascade` is not available. The ticket (§3) explicitly mandates application-layer validation, and the existing `src/content/tags/` module established the `NotFoundException` convention.

**Alternatives considered**:
- *Database CHECK constraint* — rejected: requires schema change (out of scope per §15), and CHECK can't express existence in another table.
- *A single polymorphic lookup via raw SQL* — rejected: loses type safety and doesn't reuse Prisma's connection pool cleanly.
- *Trigger-based cascade* — rejected: schema change, Prisma doesn't manage triggers natively, and operational complexity outweighs the benefit for 3 tables.

---

## Decision 2 — Generic atomic reorder helper over a Prisma model delegate

**Decision**: `ReorderHelper.reorder<T>(delegate, ownerType, ownerId, itemIds)` is a single generic function shared by all three services. It:

1. Fetches `delegate.findMany({ where: { ownerType, ownerId }, select: { id: true } })`.
2. Verifies set equality (same size, same elements, no duplicates) against `itemIds`; on failure throws `BadRequestException` with a precise message (missing / extra / duplicate).
3. Runs `prisma.$transaction(itemIds.map((id, i) => delegate.update({ where: { id }, data: { order: i } })))`.
4. Returns the fresh sorted list via a post-transaction `findMany` using the canonical sort (order ASC, createdAt ASC).

The helper receives the Prisma delegate (e.g., `this.prisma.feature`) and the client itself so the services never duplicate the loop/validation logic.

**Rationale**: The ticket (§5) explicitly calls out "avoid duplicating the algorithm three times." A single generic helper is testable in isolation (`reorder.helper.spec.ts`), and Prisma delegates share a common shape for `findMany`/`update`. Set equality rejects duplicates, missing, and foreign ids in one pass.

**Alternatives considered**:
- *Raw SQL `UPDATE ... FROM (VALUES ...)`* — rejected: marginal perf gain on ≤50 rows isn't worth losing Prisma's type safety.
- *Per-service copies* — rejected by the ticket directly.
- *Locking (`SELECT ... FOR UPDATE`)* — rejected: the ticket accepts optimistic behavior; the set-equality check converts lost updates into clean 400s rather than partial orders.

---

## Decision 3 — Reuse admin guard pattern from Tags module verbatim

**Decision**: Each admin controller is annotated with `@UseGuards(JwtAuthGuard, RolesGuard)` at the class level and `@Roles('admin')` either at the class or method level, exactly matching `src/content/tags/admin-tags.controller.ts`. No new guards.

**Rationale**: Constitution Principle II + ticket §10 both mandate reusing existing auth patterns. Tags is the most recent reference module and is frozen, so mirroring it minimizes review surface and keeps audit trails consistent.

**Alternatives considered**: None — the ticket forbids introducing a new guard mechanism.

---

## Decision 4 — Testimonial creation always forces `status = PENDING`

**Decision**: `TestimonialsService.create(...)` explicitly sets `status: TestimonialStatus.PENDING` in the Prisma `create` call and ignores any `status` field on the incoming DTO (the DTO simply doesn't include it). Status changes go only through `PATCH /:id/status` which uses a dedicated `UpdateTestimonialStatusDto` with `@IsEnum(TestimonialStatus)`.

**Rationale**: Moderation workflow (ticket §3) requires that only admins transition status, and that new items always start at PENDING for review. Two-DTO separation prevents accidental status mutation via the normal update path.

**Alternatives considered**:
- *Single DTO with optional status* — rejected: accidental status updates via the normal `PATCH /:id` path; harder to audit.
- *Forbid status on the DTO and 400 if present* — rejected: noisier UX than silently omitting; a field that isn't in the DTO is stripped by `ValidationPipe({ whitelist: true })` which is already global.

---

## Decision 5 — Public query helpers as a providers-only file, not endpoints

**Decision**: `public-queries.helper.ts` exports `PublicMarketingQueries` as an `@Injectable()` provider with three methods: `getFeaturesByOwner`, `getFaqsByOwner`, `getApprovedTestimonialsByOwner`. The provider is exported from `MarketingModule` → `ContentModule` so KAN-26 can inject it directly. No controller wires them up in this feature.

**Rationale**: Ticket §6 is unambiguous — KAN-26 consumes these helpers and will own the public HTTP surface. Exposing them as NestJS providers (not loose functions) preserves DI, testability, and the ability to mock `PrismaService`.

**Alternatives considered**:
- *Static functions taking a `PrismaClient` arg* — rejected: breaks DI, harder to mock in Jest.
- *Expose via a public controller now* — rejected: out of scope per §2 and would conflict with KAN-26.

---

## Decision 6 — Cleanup helper runs a three-delete transaction

**Decision**: `MarketingCleanupHelper.deleteAllForPath(pathId)` and `.deleteAllForCourse(courseId)` each wrap three `deleteMany` calls (`feature`, `faq`, `testimonial`) in a single `prisma.$transaction`. Idempotent by virtue of `deleteMany` returning `{ count: 0 }` when no rows match. Exported from `MarketingModule` → `ContentModule` for future Path/Course admin delete endpoints.

**Rationale**: Constitution Principle IV requires multi-table writes to be transactional. `deleteMany` is already atomic per call, but wrapping all three ensures no half-cleaned owner if one delete fails.

**Alternatives considered**:
- *Emit a domain event and let each service listen* — rejected: adds event infra that doesn't exist yet; over-engineered.
- *Loose helper without transaction* — rejected: violates Principle IV.

---

## Decision 7 — Cache invalidation is deferred with explicit TODO markers

**Decision**: Implement without cache wiring. At every mutation site (create, update, delete, reorder, status change) add a single-line comment:

```ts
// TODO(KAN-74): invalidate cache key `path:detail:${ownerId}` or `course:detail:${ownerId}`
```

When KAN-74 lands, a follow-up diff replaces each TODO with the actual `cacheManager.del(...)` call.

**Rationale**: Ticket §9 explicitly permits this when `CacheModule` is not yet present. Checking `src/content/` and the module graph confirms no Cache provider exists today. Implementing phantom cache calls would create dead code; TODO markers are greppable by KAN-74's author.

**Alternatives considered**:
- *Introduce a no-op cache interface now* — rejected: out-of-scope abstraction that KAN-74 would rewrite anyway.
- *Skip even the TODO comments* — rejected: loses the audit trail KAN-74 will need.

---

## Decision 8 — Test harness reuses Tags module patterns wholesale

**Decision**:
- Unit tests: colocated `*.service.spec.ts` with mocked `PrismaService` (same style as `src/content/tags/tags.service.spec.ts`).
- E2E tests: `test/content/marketing/*.e2e-spec.ts` using the existing `test/content/tags/test-app.ts` bootstrap (move it to `test/content/test-app.ts` if it's not already shared, otherwise import from tags — **check during implementation, prefer lift-and-share only if tags still works unchanged**). Reuse `awamer_test` DB and `global-setup.ts` truncation.
- The existing `test/content-e2e-jest.config.js` already matches `test/content/.*\.e2e-spec\.ts$`, so new files are picked up automatically by `npm run test:content:e2e` — no new script needed.
- Each e2e test truncates `feature`, `faq`, `testimonial` (plus `path`/`course` seeds it creates) in `beforeEach`.

**Rationale**: Ticket §13.3 mandates reusing the Tags harness. Verifying the jest config regex confirms zero-config pickup. Staying on `test-app.ts` means real JWTs through the NestJS pipeline — same as Tags e2e.

**Alternatives considered**:
- *New dedicated `test:marketing:e2e` script* — rejected: the existing `test:content:e2e` already covers the directory.
- *Supertest fixtures without the NestJS app* — rejected: Tags uses the real app; parity matters.

---

## Decision 9 — DTO ownership stays inside each submodule (no shared reorder DTO)

**Decision**: Each of the three submodules ships its own `reorder-items.dto.ts` even though the shape is identical (`{ itemIds: string[] }`). No shared DTO under `helpers/`.

**Rationale**: Constitution Principle I forbids DTO sharing across modules. While marketing submodules are children of the same `ContentModule`, treating them as peer submodules keeps boundaries crisp and avoids future coupling if one validator needs to diverge.

**Alternatives considered**:
- *Single `ReorderItemsDto` under `helpers/dto/`* — rejected for strict Principle I compliance.

---

## Open items

None. All decisions are implementable with files currently in the repo + the Prisma models delivered by KAN-70.
