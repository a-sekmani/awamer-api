# awamer-api — Backend Documentation

Technical reference for the Awamer (أوامر) NestJS backend. Every
document is grounded in the code on `master` — if a doc and the
code disagree, the code wins and the doc is the bug.

Start with **[api-conventions.md](./api-conventions.md)** if you
are new to the project — it covers the response envelope, error
envelope, auth cookies, guards, throttler, validation pipe, and
transactional write pattern that every endpoint doc assumes as
background.

---

## Top-level references

| File | Purpose |
|------|---------|
| [api-conventions.md](./api-conventions.md) | Response/error envelopes, JWT cookies, guards, throttler, pagination, validation pipe, transactional writes |
| [error-codes.md](./error-codes.md) | Full `ErrorCode` enum catalog with HTTP statuses and thrower methods |
| [development/testing.md](./development/testing.md) | Jest configurations, test npm scripts, Redis-state and reflect-metadata footguns |

---

## Feature areas

| Folder | Purpose |
|--------|---------|
| [auth/](./auth/) | Register, login, verify-email, forgot/reset password, check-email, logout/refresh |
| [onboarding/](./onboarding/) | 3-step onboarding flow + final submit |
| [schema/](./schema/) | Prisma schema v6 — conventions, migration history, v6 entities (tags, marketing, course enrollment, polymorphic certificate) |
| [cache/](./cache/) | `CacheService`, cache keys + TTLs, Redis provider, throttler storage, revalidation helper, full invalidation flow |
| [health/](./health/) | `GET /health` endpoint with degraded-status logic |
| [infrastructure/](./infrastructure/) | Docker Compose for local dev |
| [tags/](./tags/) | Public list + admin CRUD for tags; `ReplaceTagAssociationsHelper` |
| [marketing/](./marketing/) | Features, FAQs, Testimonials (polymorphic ownership); shared helpers (`OwnerValidator`, `ReorderHelper`, `MarketingCleanupHelper`, `PublicMarketingQueries`) |
| [enrollment/](./enrollment/) | Path + standalone-course enrollment; `EnrollmentGuard` (polymorphic) |
| [learning/](./learning/) | `POST /learning/lessons/:lessonId/complete`; `ContentAccessGuard`; progress cascade flow |
| [progress/](./progress/) | `ProgressService` helper class (no HTTP surface) |
| [certificates/](./certificates/) | List/verify endpoints; dual-level issuance flow |
| [content-discovery/](./content-discovery/) | Public discovery: categories, paths, courses |
| [admin/](./admin/) | Admin foundation (KAN-78): `@AdminEndpoint()` composite decorator, `RolesGuard`, `AuditLogInterceptor`, shared `ReorderItemsDto`, role-string conventions, sub-module registration pattern, the `/admin/__ping` smoke test |

---

## Reading order for a new developer

1. [api-conventions.md](./api-conventions.md) — how every
   endpoint is shaped.
2. [error-codes.md](./error-codes.md) — how errors are
   classified and when to introduce a new code (rarely).
3. [schema/README.md](./schema/README.md) — the data model;
   read the conventions file first, then the entity files for
   the domain you are working in.
4. The endpoint docs for the module you are touching.
5. The relevant flow doc (progress cascade, dual-level
   issuance, cache invalidation, marketing ownership) if your
   change crosses more than one endpoint.

---

## Flow documents (cross-cutting business logic)

These live next to the module that owns them but span more than
one endpoint:

- [learning/progress-cascade.md](./learning/progress-cascade.md) —
  lesson completion → section/course/path recalculation →
  certificate eligibility.
- [certificates/dual-level-issuance.md](./certificates/dual-level-issuance.md) —
  course-cert and path-cert eligibility rules + structural
  analytics idempotency.
- [cache/invalidation-flow.md](./cache/invalidation-flow.md) —
  full map of every cache invalidation call site (18 service
  entry points across tags and marketing).
- [marketing/polymorphic-ownership.md](./marketing/polymorphic-ownership.md) —
  the `(ownerType, ownerId)` convention shared across features,
  FAQs, and testimonials.

---

## Ground rules for edits to these docs

- **Never invent.** Every method name, constant, error
  message, and field must be verbatim from the source file it
  cites.
- **Line numbers must travel with a symbol anchor.** A line
  range or `:N` reference is fine when paired with a method,
  class, or constant name (`AuthService.register()` in
  `src/auth/auth.service.ts` around lines 56–133;
  `MUTATING_METHODS` at `audit-log.interceptor.ts:12`). Bare
  line numbers without a symbol anchor are forbidden — they
  rot silently when surrounding code shifts. When in doubt,
  prefer the symbol name and drop the number.
- **Update instead of duplicating.** When a rule changes, fix
  the one doc that states it (usually `api-conventions.md` or
  `schema/conventions.md`) and leave the endpoint docs linking
  to it.
- **Keep the existing `docs/auth/` and `docs/onboarding/`
  frozen.** They are the canonical style reference. Changes
  there are their own coordinated edits.
