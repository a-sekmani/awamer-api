<!--
SYNC IMPACT REPORT
==================
Version change: [TEMPLATE] → 1.0.0 (initial constitution, first fill of template)

Modified principles: N/A (initial creation from template placeholders)

Added sections:
  - I. Module Isolation
  - II. Security-First
  - III. Standard Response Contract
  - IV. Transactional Integrity
  - V. Data Validation & Type Safety
  - VI. Access Control Hierarchy
  - API Conventions (Section 2)
  - Development Workflow (Section 3)
  - Governance

Templates requiring updates:
  - ✅ .specify/memory/constitution.md — this file (updated)
  - ✅ .specify/templates/plan-template.md — Constitution Check section references
    principles by name; plan-template already has a placeholder gate that will
    resolve correctly once principles are filled. No structural changes needed.
  - ✅ .specify/templates/spec-template.md — no constitution-specific gates; aligns
    with Validation principle (FR- format, acceptance scenarios). No changes needed.
  - ✅ .specify/templates/tasks-template.md — task phases align with Module Isolation
    and Transactional Integrity principles. No structural changes needed.
  - ✅ .specify/templates/agent-file-template.md — generic template; no outdated
    agent-specific references found.
  - ⚠ No commands/ directory found under .specify/templates/commands/ — skipped.

Deferred TODOs:
  - TODO(RATIFICATION_DATE): Using 2026-03-29 as initial ratification (date of first
    constitution creation). Update if the team has an earlier governance adoption date.
-->

# Awamer API Constitution

## Core Principles

### I. Module Isolation

Every feature MUST live in a self-contained NestJS module with its own
Controller, Service, and DTOs. Cross-module dependencies are allowed only via
imported NestJS modules — never via direct service instantiation. Modules MUST
NOT share DTOs; each module owns its request/response shapes.

**Rationale**: Awamer API is structured around 14+ independent domain modules
(Auth, Users, Paths, Lessons, Progress, Quizzes, etc.). Strict isolation ensures
each module can be developed, tested, and reviewed independently without
unintended side effects elsewhere.

### II. Security-First

Sensitive fields MUST never be exposed in API responses. This includes:
`passwordHash`, `isCorrect` (quiz options), raw Stripe secrets, and internal
relational IDs not needed by the client. All non-public endpoints MUST be
protected by `JwtAuthGuard`. Role-restricted endpoints MUST additionally apply
`RolesGuard`. The Stripe webhook endpoint MUST validate signatures via
`StripeWebhookGuard`. Helmet middleware MUST be active for all routes.

**Rationale**: The platform handles payments (Stripe), personal data (learner
profiles), and exam integrity (quiz answers). A breach of any of these damages
user trust irreparably. Security controls are non-negotiable.

### III. Standard Response Contract

All successful API responses MUST follow:
```
{ "data": { ... }, "message": "Success" }
```
Paginated responses MUST follow:
```
{ "data": [...], "meta": { "total", "page", "limit", "totalPages" } }
```
All error responses MUST follow:
```
{ "statusCode": <HTTP code>, "message": "...", "errors": [...] }
```
URL paths MUST use kebab-case. Query parameters MUST use snake_case.
Request/response bodies MUST use camelCase. Base path is `/api/v1/`.
Pagination defaults: `?page=1&limit=20`, maximum limit is 100.

**Rationale**: The Next.js frontend (awamer-web) consumes this API exclusively via
fetch/React Query. A consistent envelope eliminates per-endpoint parsing logic and
allows shared client utilities.

### IV. Transactional Integrity

All multi-step write operations that span multiple database tables MUST execute
inside a single `prisma.$transaction(...)` call. This is especially critical for:
progress updates (LessonProgress → SectionProgress → CourseProgress → PathProgress
→ LastPosition → Certificate), registration flows (User + UserProfile + UserRole
+ Subscription), and any payment state changes.

**Rationale**: Partial writes leave the database in an inconsistent state. Learner
progress and subscription status are core product data; inconsistency here directly
harms user experience and revenue.

### V. Data Validation & Type Safety

All incoming request data MUST be validated via DTOs decorated with
`class-validator` decorators. `ValidationPipe` is globally enabled — no endpoint
may bypass it. All primary keys MUST be UUIDs. Dates MUST be stored as `DateTime`
in Prisma and returned as ISO 8601 strings. TypeScript strict mode is the
baseline — `any` types are forbidden without explicit justification.

**Rationale**: The platform targets Arabic-speaking learners in Saudi Arabia, where
payment and personal data correctness is legally and reputationally sensitive.
Type safety and runtime validation prevent bad data from entering the system.

### VI. Access Control Hierarchy

Content access MUST be evaluated in this exact order:
1. `Path.is_free = true` → allow
2. `Course.is_free = true` → allow
3. `Lesson.is_free = true` → allow
4. User has an active paid subscription → allow
5. Otherwise → 403 with `{ reason: "subscription_required", upgradeUrl }`

The `ContentAccessGuard` MUST enforce this hierarchy. The `EnrollmentGuard` MUST
confirm path enrollment before any learning or progress endpoint is accessed. These
two guards are distinct and MUST NOT be merged.

**Rationale**: Awamer's monetization model depends on subscription gating. Free
previews (is_free flags) drive conversion; the guard hierarchy ensures correct
access without over-blocking or under-blocking.

## API Conventions

- **Base path**: `/api/v1/`
- **URL casing**: kebab-case paths (`/api/v1/lesson-content`)
- **Query params**: snake_case (`?sort=created_at&order=desc`)
- **Body fields**: camelCase (`{ "firstName": "..." }`)
- **Auth**: JWT via httpOnly cookies; access token 15 min, refresh token 7 days
  stored in DB and rotated on each refresh
- **Rate limiting**: `@nestjs/throttler` MUST be configured on public endpoints
- **File storage**: AWS S3 via pre-signed URLs only — files are never streamed
  through the API server
- **Email**: AWS SES via `MailModule` — forget-password flows MUST always return
  HTTP 200 to prevent email enumeration
- **Analytics**: PostHog server-side capture for the following critical events:
  `user_signed_up`, `onboarding_completed`, `path_started`, `lesson_completed`,
  `section_completed`, `course_completed`, `path_completed`, `quiz_started`,
  `quiz_completed`, `project_submitted`, `upgrade_clicked`, `checkout_started`,
  `payment_completed`, `certificate_issued`

## Development Workflow

- **Feature planning**: All features MUST have a `spec.md` before implementation
  begins. Non-trivial features MUST also have a `plan.md` with a Constitution Check
  gate.
- **Schema changes**: All database schema changes MUST go through Prisma migrations
  (`prisma migrate dev`). Direct SQL mutations to a shared database are forbidden.
- **Stripe integration**: Webhook handlers MUST be idempotent — duplicate event
  delivery MUST NOT create duplicate records. Event types handled:
  `checkout.session.completed`, `invoice.payment_succeeded`,
  `invoice.payment_failed`, `customer.subscription.updated`,
  `customer.subscription.deleted`.
- **Code review**: PRs touching `AuthModule`, `SubscriptionsModule`,
  `PaymentsModule`, or any guard MUST receive explicit security review.
- **Environment config**: All secrets and environment-specific values MUST be
  sourced from environment variables (see CLAUDE.md for the full list). No
  hardcoded secrets, keys, or connection strings in source code.
- **Observability**: Every critical business event listed in the API Conventions
  section MUST fire a PostHog server-side event. Progress calculations and payment
  state changes MUST be logged at INFO level.

## Governance

This constitution supersedes any informal convention, README note, or verbal
agreement. When a conflict arises between the constitution and other documentation,
the constitution takes precedence.

**Amendment procedure**: Any change to this file constitutes an amendment. The
version MUST be bumped following semantic versioning:
- **MAJOR**: Removal or redefinition of an existing principle.
- **MINOR**: New principle or section added, or materially expanded guidance.
- **PATCH**: Clarifications, wording, or non-semantic refinements.

All amendments MUST update the Sync Impact Report (HTML comment at top of this
file) and check dependent templates for required propagation.

**Compliance**: Every plan.md Constitution Check gate MUST verify alignment with
all six principles above before Phase 0 research begins, and re-verify after
Phase 1 design. Any justified deviation MUST be documented in the plan's
Complexity Tracking table.

**Runtime guidance**: See `CLAUDE.md` at the repository root for live development
reference (tech stack details, entity schemas, module responsibilities, and
environment variable definitions).

---

**Version**: 1.0.0 | **Ratified**: 2026-03-29 | **Last Amended**: 2026-03-29