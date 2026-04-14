# Phase 0 — Research: Course Enrollment + Dual-Level Certificates

**Feature**: 011-enrollment-certificates
**Date**: 2026-04-14

Technical Context has no unresolved `NEEDS CLARIFICATION` markers — the `/speckit.clarify` session already captured the three material questions (learning-endpoint scope, holder-name shape, non-ACTIVE enrollment handling). The research below documents the concrete implementation decisions needed to execute without further iteration.

---

## Decision 1 — `ContentAccessGuard` extended in place (not renamed to `access.guard.ts`)

**Decision**: Rewrite `src/common/guards/content-access.guard.ts` with the full `isFree` cascade. Do NOT create a new `access.guard.ts`. The audit already captured this call; this is the implementation-side consequence.

**Rationale**: Two guards with overlapping names in `src/common/guards/` would guarantee future confusion. The ticket §8.2 allows either creation or extension; extension is cleaner. `roles.guard.ts` (frozen) lives in the same directory, so the precedent of "guards stay where they are" is already established.

**Alternatives considered**:
- *Create `access.guard.ts` as a thin re-export* — rejected: one file per concept is not optional in NestJS.
- *Delete `content-access.guard.ts` and create `access.guard.ts`* — rejected: renames in `src/common/` create churn for future `git blame` and nothing gains from the new name.

---

## Decision 2 — Cascade runs in one `prisma.$transaction(async (tx) => …)`

**Decision**: `ProgressService.completeLesson(userId, lessonId)` opens a single interactive transaction and passes `tx` (the `Prisma.TransactionClient`) to every helper and to `CertificatesService.checkCourseEligibility` / `checkPathEligibility`. Certificate issuance therefore runs inside the same transaction; a failure at any step rolls back everything.

**Rationale**: Constitution Principle IV mandates it; ticket §4.3 explicitly calls out atomicity. Passing `tx` down the call chain (rather than having each service open its own transaction) is the standard Nest/Prisma pattern for cross-service transactions.

**Alternatives considered**:
- *Separate transactions per step* — rejected: partial state on failure violates Principle IV.
- *Outbox pattern for certificate issuance* — rejected: over-engineered for a monolith with single-writer semantics.

---

## Decision 3 — Idempotency via fast-path pre-check before any writes

**Decision**: `completeLesson` starts with `SELECT` on `LessonProgress` for `(userId, lessonId)`. If the row exists with `status = COMPLETED`, the method returns the current aggregate state **without** opening a transaction or touching any row. All subsequent code paths assume they are on the "first-time completion" branch.

**Rationale**: Ticket §4.3 explicitly requires idempotency — no new timestamps, no re-issuance. The pre-check avoids the overhead of opening a transaction for a no-op and removes any risk of re-running the cert eligibility check and accidentally double-issuing on a race. The existing cert's unique `certificateCode` constraint is the last line of defense, but fast-path short-circuiting is cheaper.

**Alternatives considered**:
- *Rely on unique constraint on (userId, courseId, type) for certificates* — rejected: no such composite unique exists in v6 schema (only `certificateCode` is unique); adding one is out of scope (schema frozen).
- *Check inside the transaction* — acceptable but wastes a transaction slot on the common no-op case.

---

## Decision 4 — `LastPosition` uses `findFirst` + `create`/`update`, not `upsert`

**Decision**: Writing to `last_positions` uses an explicit two-step: `findFirst({ where: { userId, pathId? ?? null, courseId? ?? null } })` followed by `create` or `update`. No `upsert`.

**Rationale**: The `LastPosition` table has **partial unique indexes** (`last_positions_user_path_unique WHERE pathId IS NOT NULL`, `last_positions_user_course_unique WHERE courseId IS NOT NULL`) plus a `last_positions_exactly_one_scope` CHECK constraint — these were added as raw SQL in migration `20260414145648_v6_path_course_pages_alignment` because Prisma does not yet support partial unique indexes as `@@unique`. Prisma's `upsert` can only use declared uniques from the generated client, which means it does not know about the partial indexes and cannot target them. A manual find→create/update is the safe, portable approach.

**Alternatives considered**:
- *Raw SQL `INSERT … ON CONFLICT`* — possible but loses Prisma type safety and adds a SQL-string dependency.
- *Upsert on a synthetic composite key* — not available in this schema.

---

## Decision 5 — Certificate code generation: `crypto.randomUUID()` → 12-char URL-safe slice

**Decision**: Use Node's built-in `crypto.randomUUID()` and take the first 12 hex characters (stripping dashes) as the certificate code. Retry up to 3 times on a unique-constraint collision before throwing `InternalServerErrorException`. **No new dependency.**

**Rationale**: Ticket §4.2 explicitly allows this fallback — "if `nanoid` is not installed, use `crypto.randomUUID()` and take the first 12 characters of its hex representation." `crypto.randomUUID` is in Node 20's core (no install needed), already used elsewhere in the codebase for refresh-token generation, and produces URL-safe output by construction (hex alphabet). Collision probability at 12 hex chars across a realistic platform lifetime is acceptable for a non-security-critical code.

**Alternatives considered**:
- *Add `nanoid`* — rejected: ticket §14 forbids new deps without justification, and this works without one.
- *Full UUID (36 chars)* — rejected: ticket §4.2 specifies 12 for URL ergonomics.
- *Custom base62 from `crypto.randomBytes`* — rejected: more code for no functional benefit.

---

## Decision 6 — Quiz-pass check deferred via a single helper that returns `true`

**Decision**: `CertificatesService.checkCourseEligibility` calls a private `allCourseQuizzesPassed(tx, userId, courseId): Promise<boolean>` helper. The current implementation of that helper is:

```ts
private async allCourseQuizzesPassed(...): Promise<boolean> {
  // TODO(KAN-quizzes): replace this with a real QuizAttempt check once
  // QuizzesService ships. For now, treat the quiz requirement as satisfied so
  // course eligibility can still be reached by completing all lessons.
  return true;
}
```

**Rationale**: Ticket §13.1 authorizes this fallback explicitly. Putting the check behind a named helper (rather than inlining `return true`) means the future KAN-quizzes diff is a one-method replacement: the caller's shape doesn't change.

**Alternatives considered**:
- *Check `QuizAttempt.status = PASSED` now* — rejected: `QuizzesService` has no `submitAttempt` flow, so no attempt rows ever exist. The check would always return `false`, blocking eligibility incorrectly.
- *Feature-flag via env var* — rejected: no feature-flag infra, and ticket says "TODO marker", not "flag".

---

## Decision 7 — `ContentAccessGuard` subscription branch stubs to "allow"

**Decision**: The subscription check in `ContentAccessGuard` is a private helper `hasActiveSubscription(userId): Promise<boolean>` that currently returns `true` with a `TODO(subscriptions)` comment.

**Rationale**: Ticket §13.3 authorizes this fallback. `SubscriptionsModule` exists but exposes no "is active" method, and creating one would drag `src/subscriptions/` into this ticket's scope. The default-allow is safe in development because `EnrollmentGuard` still rejects non-enrolled users — the paywall is effectively off but enrollment discipline remains.

**Alternatives considered**:
- *Default-deny* — rejected: would break every e2e test that seeds a user without a subscription row.
- *Hardcode a test user list* — rejected: leaks test concerns into production code.

---

## Decision 8 — `EnrollmentGuard` ACTIVE-only check via a single `hasAccessToCourse`

**Decision**: `EnrollmentService.hasAccessToCourse(userId, courseId)` resolves the course, checks its `pathId`, and then queries exactly one of `pathEnrollment.findUnique({ where: { userId_pathId: { userId, pathId }, status: 'ACTIVE' } })` or `courseEnrollment.findUnique({ where: { userId_courseId: { userId, courseId }, status: 'ACTIVE' } })`. Non-`ACTIVE` enrollments return `false` (per clarification Q3).

**Rationale**: Per spec FR-022 and clarification, only `ACTIVE` grants access. Keeping the check in the service (not the guard) is per ticket §8.1 ("delegates the check to `EnrollmentService.hasAccessToCourse`") and lets the unit tests hit the matrix without dragging a guard into the picture.

**Prisma composite key note**: Neither `PathEnrollment` nor `CourseEnrollment` has `@@unique([userId, pathId])` declared — only `@@index`. The `CourseEnrollment` schema DOES have `@@unique([userId, courseId])`. For `PathEnrollment` we use `findFirst` with `{ where: { userId, pathId, status: 'ACTIVE' } }` instead of `findUnique`. Duplicate-prevention on enrollment creation relies on the `CourseEnrollment` composite unique plus an explicit `findFirst` check (inside the transaction) for `PathEnrollment`.

**Alternatives considered**:
- *Accept any non-DROPPED status* — rejected by clarification Q3.
- *Separate guards for path vs. course* — rejected: duplicates logic; the service helper already handles both.

---

## Decision 9 — Guard chain order and placement

**Decision**: Apply to `LearningController.completeLesson` as `@UseGuards(JwtAuthGuard, EnrollmentGuard, ContentAccessGuard)` at the method level. Order matters: JWT first (so `req.user` is populated), Enrollment second (so non-enrolled users are rejected before any paywall evaluation leaks free/paid state), Access third.

**Rationale**: Matches spec FR-025 and ticket §8.3. `JwtAuthGuard` is already a global `APP_GUARD` in `AppModule`, so listing it in `@UseGuards` is arguably redundant — but explicit listing here makes the order of custom guards deterministic. NestJS evaluates class-level guards before method-level guards, but since we apply everything at the method, the order in the decorator array is the authoritative order.

**Alternatives considered**:
- *Apply at class level* — acceptable, but the class only has one route, so method-level is more explicit.
- *Merge enrollment + access into a single guard* — rejected by Constitution Principle VI.

---

## Decision 10 — Test harness reuse: import `test-app.ts` directly

**Decision**: Each new e2e file imports `createTestApp` from `../content/tags/test-app.ts`. No new bootstrap file is created. The helper's JWT payload is generic enough (`sub`, `email`, `roles: ['admin']`) to work for learner scenarios; the `roles: ['admin']` doesn't interfere because learner endpoints do not check roles.

**Rationale**: Zero-churn reuse, ticket §11.6 mandates it. A fresh `test/enrollment/test-app.ts` that's a near-copy would bit-rot.

**Per-test JWT signing**: For scenarios that need a distinct `userId` (the `progress-cascade.e2e-spec.ts` seeds its own users and must sign tokens with their real UUIDs), each test obtains the `JwtService` from the Nest app and signs ad-hoc tokens inside `beforeEach`. This pattern already exists in `test/content/tags/admin-tags.controller.e2e-spec.ts`.

**Alternatives considered**:
- *Add a `createTestAppAs(userId)` helper* — possible later; not needed now.

---

## Decision 11 — `progress.controller.ts` stub deletion

**Decision**: Delete `src/progress/progress.controller.ts`. The `ProgressModule` becomes a service-only module with no HTTP surface. `LearningModule` owns the single route.

**Rationale**: Ticket §14 does not freeze `src/progress/`. The stub is `findAll() { return {}; }` — noise. Keeping it would register an unused route `GET /progress` that nothing should hit. Deleting is cleaner than leaving dead code.

**Alternatives considered**:
- *Leave the stub* — rejected: dead code + misleading route.
- *Move progress endpoints into the controller instead of LearningModule* — rejected: ticket §5 has no progress endpoints, and LearningModule is conceptually the "learner interaction" surface.

---

## Decision 12 — E2E test config: widen the existing regex

**Decision**: Edit `test/content-e2e-jest.config.js` and change `testRegex: 'test/content/.*\\.e2e-spec\\.ts$'` to `testRegex: 'test/(content|enrollment|certificates)/.*\\.e2e-spec\\.ts$'`. No new npm script.

**Rationale**: Ticket §11.6 says "add `test:learning:e2e` OR extend `test:content:e2e` — use the simpler option." Extending the regex is one line; adding a new script requires a new jest config file. One line wins.

**DoD alignment**: `npm run test:content:e2e` in the DoD now transparently covers the new tests.

**Alternatives considered**:
- *New `test:learning:e2e` script + new jest config* — rejected: more files.
- *Fold everything into the global `npm test`* — rejected: `npm test` uses `--testRegex='.*\.spec\.ts$'` which picks up co-located unit specs but not the e2e `.e2e-spec.ts` files in `test/`.

---

## Open items

None. All 12 decisions are implementable with files currently in the repo plus the Prisma models delivered by KAN-70.
