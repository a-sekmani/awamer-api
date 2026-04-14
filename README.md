# Awamer API (أوامر)

## 1. Project Title & Description

**Awamer API** is the backend REST API for **Awamer (أوامر)**, an Arabic-first
educational platform specializing in high-value technical skills — AI,
Cybersecurity, and Cloud / DevOps. The platform targets the Saudi Arabia
market and is built around a four-step learner experience: register → verify
email → onboarding → dashboard.

This repository hosts only the backend. The Next.js 15 frontend lives in a
separate repo (`awamer-web`) and communicates with this API exclusively over
HTTP, using JWTs delivered via httpOnly cookies.

---

## 2. Tech Stack

| Category | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5.x |
| Framework | NestJS 11 |
| ORM | Prisma 6 |
| Database | PostgreSQL 14+ |
| Authentication | Passport JWT (`@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`) |
| Password hashing | bcryptjs (cost 12) |
| Validation | class-validator + class-transformer |
| Config validation | Joi |
| Rate limiting | `@nestjs/throttler` (global) + per-row DB tracking (per-email / per-IP) |
| Scheduling | `@nestjs/schedule` |
| HTTP security | Helmet, cookie-parser |
| GeoIP | geoip-lite |
| Email | AWS SES (logger stub for now) |
| File storage | AWS S3 (stub) |
| Payments | Stripe (stub) |
| Analytics | PostHog (logger stub for now) |
| Testing | Jest 29, Supertest, ts-jest |

---

## 3. Features

- **User registration & authentication** with email + password, JWT access /
  refresh tokens, refresh-token rotation, secure cookie delivery.
- **Email verification** via 6-digit OTP (SHA-256 hashed at rest, timing-safe
  compare, 5-attempt cap, 10-minute expiry).
- **Forgot / reset password** with single-use SHA-256-hashed tokens
  (1-hour expiry) and enumeration-safe responses.
- **Account lockout** after 10 failed login attempts (15-minute cooldown).
- **Onboarding flow** with strict, typed validation (background, interests
  array, goals) and atomic completion (TOCTOU-safe via conditional
  `updateMany`).
- **Profile management**: get / update user, update profile, change password.
- **GeoIP-based country detection** at registration time.
- **Layered rate limiting**: global IP throttler + per-email / per-IP DB
  tracking for sensitive endpoints (login, register, password reset, OTP).
- **Centralized error responses** with stable `errorCode` strings.
- **Global response envelope** (`{ data, message }`) via interceptor.
- **Stub modules** for paths, lessons, progress, quizzes, projects,
  subscriptions, payments, certificates, admin, analytics, mail, storage —
  these are wired into `AppModule` and ready for feature work.

---

## 4. Architecture Overview

Awamer API is a single NestJS process. Each business capability is its own
**self-contained module** with controller + service + DTOs, talking to
PostgreSQL via a single global `PrismaService`.

```
┌──────────────────────────────────────────────────────────────────────┐
│                          HTTP request                                │
│                              │                                       │
│            ┌─────────────────▼─────────────────┐                     │
│            │  Helmet · cookie-parser · CORS    │  (main.ts)          │
│            └─────────────────┬─────────────────┘                     │
│                              │                                       │
│            ┌─────────────────▼─────────────────┐                     │
│            │  Global ValidationPipe            │                     │
│            │  (whitelist + forbidNonWhitelisted│                     │
│            │   + transform)                    │                     │
│            └─────────────────┬─────────────────┘                     │
│                              │                                       │
│            ┌─────────────────▼─────────────────┐                     │
│            │  Global guards (APP_GUARD)        │                     │
│            │  1. ThrottlerGuard                │                     │
│            │  2. JwtAuthGuard (skipped on      │                     │
│            │     @Public() routes)             │                     │
│            └─────────────────┬─────────────────┘                     │
│                              │                                       │
│            ┌─────────────────▼─────────────────┐                     │
│            │  Route-level guards               │                     │
│            │  EmailVerifiedGuard /             │                     │
│            │  OnboardingCompletedGuard /       │                     │
│            │  RolesGuard                       │                     │
│            └─────────────────┬─────────────────┘                     │
│                              │                                       │
│            ┌─────────────────▼─────────────────┐                     │
│            │  Controller → Service → Prisma    │                     │
│            └─────────────────┬─────────────────┘                     │
│                              │                                       │
│            ┌─────────────────▼─────────────────┐                     │
│            │  ResponseTransformInterceptor     │                     │
│            │  ({ data, message: 'Success' })   │                     │
│            └─────────────────┬─────────────────┘                     │
│                              │                                       │
│            ┌─────────────────▼─────────────────┐                     │
│            │  HttpExceptionFilter (global)     │                     │
│            │  → { statusCode, message,         │                     │
│            │      errorCode, errors? }         │                     │
│            └─────────────────┬─────────────────┘                     │
│                              │                                       │
│                          HTTP response                               │
└──────────────────────────────────────────────────────────────────────┘
```

The frontend (`awamer-web`, Next.js 15, port 3000) calls this API at
`http://localhost:3001/api/v1` with `credentials: 'include'`. Authentication
state lives in two httpOnly cookies (`access_token`, `refresh_token`); no
tokens are ever stored in `localStorage`.

---

## 5. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS | Required runtime |
| npm | 10+ | Comes with Node 20 |
| PostgreSQL | 14+ | Local server must be running |
| OpenSSL | any | For generating JWT secrets |

Optional:

| Tool | Why |
|---|---|
| Stripe CLI | Local webhook testing once subscriptions ship |
| Postman | The repo ships an API collection at `postman/awamer-api.postman_collection.json` |

---

## 6. Installation / Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd awamer-api
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env with your values (see section 7)

# 3. Create the database
createdb awamer

# 4. Apply migrations and generate Prisma client
npx prisma migrate dev
```

After step 4 the schema is up to date and `node_modules/.prisma/client` is
generated. You're ready to run the app (section 8).

---

## 7. Environment Variables

The full list of variables is in `.env.example`. Joi validates them on
startup — the app refuses to boot if a required value is missing or
malformed.

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:pw@localhost:5432/awamer` |
| `JWT_SECRET` | Access-token signing secret. Generate with `openssl rand -hex 32`. |
| `JWT_REFRESH_SECRET` | Refresh-token signing secret. **Must be different** from `JWT_SECRET`. |
| `STRIPE_SECRET_KEY` | Stripe API secret (use a `sk_test_…` key in dev) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_…`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM credentials for SES + S3 |
| `AWS_REGION` | e.g. `eu-west-1` |
| `S3_BUCKET_NAME` | e.g. `awamer-files` |
| `SES_FROM_EMAIL` | Verified sender, e.g. `noreply@awamer.com` |
| `POSTHOG_API_KEY` | PostHog project key |

### Optional (sensible defaults)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS allow list |
| `JWT_EXPIRATION` | `900` | Access token TTL in seconds (15 min) |
| `JWT_REFRESH_EXPIRATION` | `7d` | Refresh token TTL |
| `THROTTLE_TTL` | `60000` | Global throttler window in ms |
| `THROTTLE_LIMIT` | `100` | Global throttler max requests / window / IP |
| `NODE_ENV` | `development` | Controls cookie `secure` flag and logging |

> **Tip:** never commit a real `.env`. Use `.env.example` as the template
> and store production secrets in your secret manager.

---

## 8. Running the Application

```bash
# Development (watch mode, auto-reload on file changes)
npm run start:dev

# Production
npm run build
npm run start:prod

# Debug mode (Chrome DevTools)
npm run start:debug
```

The API listens on `http://localhost:3001` and exposes everything under the
`/api/v1` global prefix. Verify with:

```bash
curl http://localhost:3001/api/v1/health
# → {"data":{"status":"ok"},"message":"Success"}
```

---

## 9. API Overview (Endpoints)

**Base URL:** `http://localhost:3001/api/v1`
**Response envelope:** every success response is `{ data: T, message: string }`.
**Error envelope:** see section 15.

### Health (public)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |

### Auth — public

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register new user (returns `requiresVerification: true`, sends OTP) |
| POST | `/auth/login` | Login with email + password |
| POST | `/auth/refresh` | Rotate access + refresh tokens (cookie-based) |
| POST | `/auth/forgot-password` | Request password reset email (always 200, no enumeration) |
| GET | `/auth/verify-reset-token` | Validate a reset token before showing the form |
| POST | `/auth/reset-password` | Set a new password using a valid reset token |

### Auth — authenticated

| Method | Path | Description |
|---|---|---|
| POST | `/auth/logout` | Clear cookies, invalidate refresh token in DB |
| POST | `/auth/send-verification` | Send email verification OTP |
| POST | `/auth/resend-verification` | Resend OTP (subject to internal rate limit) |
| POST | `/auth/verify-email` | Verify email with 6-digit code |

### Users — authenticated

| Method | Path | Guards | Description |
|---|---|---|---|
| GET | `/users/me` | JWT | Get current user + profile + role + active subscription |
| PATCH | `/users/me` | JWT | Update name / locale |
| PATCH | `/users/me/profile` | JWT | Update displayName / avatar |
| PATCH | `/users/me/password` | JWT | Change password (requires current password) |
| GET | `/users/me/onboarding` | JWT + EmailVerified | Get onboarding status |
| POST | `/users/me/onboarding` | JWT + EmailVerified | Submit onboarding (atomic, single-shot) |

### Content — Tags (KAN-71)

The `ContentModule` (at `src/content/`) exposes the public taxonomy and admin
curation surfaces for tags. The tag vocabulary is a second, descriptive axis
that runs in parallel with the mandatory Category hierarchy.

| Method | Path | Guards | Description |
|---|---|---|---|
| GET | `/tags` | Public | List all `ACTIVE` tags with live `pathCount` and `courseCount` (`PUBLISHED` only); sorted alphabetically; `Cache-Control: public, max-age=60`. |
| GET | `/admin/tags` | JWT + Admin | List all tags (including `HIDDEN`) with admin fields (`status`, `createdAt`). |
| POST | `/admin/tags` | JWT + Admin | Create a tag (`name`, `slug`, optional `status`). Returns 201, or 409 on duplicate slug. |
| PATCH | `/admin/tags/:id` | JWT + Admin | Partial update; 404 if unknown, 409 on slug collision, 400 on empty body. |
| DELETE | `/admin/tags/:id` | JWT + Admin | Hard delete; cascades `PathTag`/`CourseTag` rows. Returns 204, or 404 if unknown. |

`ContentModule` also exports the `ReplaceTagAssociationsHelper` injectable
for use by future Path/Course admin edit flows (KAN-72, KAN-73). It runs
inside a Prisma transaction, dedupes input, validates that every tag exists
and is `ACTIVE`, and atomically replaces the owner's tag set.

### Content — Marketing (Features, FAQs, Testimonials) (KAN-72)

`ContentModule` also wires the marketing submodule at
`src/content/marketing/`, which owns the admin CRUD surface for the three
polymorphic marketing entities that appear on public Path and Course detail
pages. Every entity belongs to exactly one owner, identified by
`(ownerType, ownerId)` where `ownerType ∈ { PATH, COURSE }`. Ownership has no
Prisma `@relation`, so referential integrity is enforced in the service
layer via `OwnerValidator`.

| Method | Path | Guards | Description |
|---|---|---|---|
| GET | `/admin/{paths\|courses}/:ownerId/features` | JWT + Admin | List features for an owner, sorted by `order` ASC. |
| POST | `/admin/{paths\|courses}/:ownerId/features` | JWT + Admin | Create a feature (`icon`, `title`, `description`, optional `order` → append). |
| PATCH | `/admin/features/:id` | JWT + Admin | Partial update. |
| PATCH | `/admin/{paths\|courses}/:ownerId/features/reorder` | JWT + Admin | Atomic reorder (`{ itemIds: string[] }` = full set). |
| DELETE | `/admin/features/:id` | JWT + Admin | Delete. |
| GET/POST/PATCH/DELETE | `/admin/.../faqs[...]` | JWT + Admin | Same shape, with `question` / `answer`. |
| GET/POST/PATCH/DELETE | `/admin/.../testimonials[...]` | JWT + Admin | Same shape, plus the moderation endpoint below. Admin list returns all statuses. |
| PATCH | `/admin/testimonials/:id/status` | JWT + Admin | Moderation endpoint: `{ status: PENDING \| APPROVED \| HIDDEN }`. New testimonials are always created with `PENDING` regardless of input. |

`ContentModule` re-exports `MarketingModule`, which in turn exports four
reusable injectables for consumers in other modules:

- `OwnerValidator` — throws `NotFoundException` if a referenced Path or
  Course does not exist.
- `ReorderHelper` — generic atomic reorder over any of the three marketing
  models; validates set equality and runs inside `prisma.$transaction`.
- `MarketingCleanupHelper` — `deleteAllForPath(id)` / `deleteAllForCourse(id)`
  wipe all marketing content for the given owner in a single transaction.
  Future Path/Course admin delete endpoints will call these.
- `PublicMarketingQueries` — `getFeaturesByOwner`, `getFaqsByOwner`, and
  `getApprovedTestimonialsByOwner` for KAN-26 to assemble public detail
  responses without re-querying marketing tables.

Only `APPROVED` testimonials are returned by the public query helper;
`PENDING` and `HIDDEN` are visible only to admins. Cache invalidation hooks
are stubbed with `TODO(KAN-74)` comments at every mutation site pending the
Redis `CacheModule` landing.

### Enrollment + Certificates (KAN-73)

Three tightly-coupled modules deliver the learner loop introduced by Data
Model v6: `EnrollmentModule` handles both path and standalone-course
enrollment; `ProgressModule` owns the transactional lesson-completion
cascade; `CertificatesModule` issues course- and path-level certificates
automatically when eligibility is reached. A thin `LearningModule` exposes
the single `POST /learning/lessons/:lessonId/complete` route protected by
the full guard chain.

| Method | Path | Guards | Description |
|---|---|---|---|
| POST | `/enrollments/paths/:pathId` | JWT | Enroll the current learner in a path. Creates `PathEnrollment`, `PathProgress`, and a zeroed `CourseProgress` for every course in the path, all in one transaction. |
| POST | `/enrollments/courses/:courseId` | JWT | Enroll in a standalone course. Rejects path-attached courses with a 400 carrying `parentPathId` so the frontend can redirect. |
| GET | `/enrollments/me` | JWT | List the current learner's enrollments grouped as `{ paths, courses }`. Path-attached courses never appear under `courses`. |
| GET | `/enrollments/me/courses/:courseId` | JWT | Return a specific course enrollment with progress and last position. 404 for missing-or-not-enrolled (identical response to avoid leaking course existence). |
| POST | `/learning/lessons/:lessonId/complete` | JWT + Enrollment + ContentAccess | Mark a lesson complete. Runs the full atomic cascade: lesson progress → section → course → (path) → last position → course-cert eligibility → path-cert eligibility. Idempotent on re-completion. |
| GET | `/certificates/me` | JWT | List the current learner's certificates, most recent first, with subject relation (path or course). |
| GET | `/certificates/verify/:code` | Public + tightened throttle (30/60s) | Third-party certificate verification. Returns a minimal allow-listed DTO — `{ valid, type, issuedAt, holder: { fullName }, subject }` — and 404 on unknown codes. No email, no enrollment date, no progress. |

**Access control** — `EnrollmentGuard` runs before `ContentAccessGuard` per
Constitution Principle VI: non-enrolled callers are rejected before any
paywall evaluation can leak free/paid state. Only `ACTIVE` enrollments grant
access; `COMPLETED`, `PAUSED`, and `DROPPED` all return 403. The `isFree`
cascade follows the constitutional order `Path → Course → Lesson → active
subscription → deny`; for standalone courses the `Path` step is skipped.

**Observability** — certificate issuance fires a `certificate_issued` event
via `AnalyticsService.capture()` per FR-030. The event carries `userId`,
`certificateId`, `certificateType`, `pathId`/`courseId`, `certificateCode`,
and `issuedAt`. The event is emitted exactly once at genuine new-issuance
(never when `checkCourseEligibility` / `checkPathEligibility` returns an
existing certificate). The underlying PostHog client wiring inside
`AnalyticsService` itself remains a pre-existing `TODO` owned by a future
analytics ticket — this feature is compliant at the contract level, and
events will automatically reach PostHog the moment the service gets its
real client with zero changes to certificate code.

**Deferred fallbacks** — two `TODO(...)` markers are intentional:
`TODO(KAN-quizzes)` inside `CertificatesService.allCourseQuizzesPassed`
(course eligibility treats the quiz requirement as satisfied until the
quiz subsystem ships), and `TODO(subscriptions)` inside
`ContentAccessGuard.hasActiveSubscription` (paid content is temporarily
allowed until `SubscriptionsService.isActive()` exists — enrollment
discipline still applies, so the paywall is effectively off but access
control is not).

A live Postman collection is at
`postman/awamer-api.postman_collection.json` — import it and set the
`base_url` variable to `http://localhost:3001/api/v1`.

---

## 10. Project Structure

```
src/
├── app.module.ts                  # Root module — wires every feature module
├── main.ts                        # Bootstrap (Helmet, CORS, ValidationPipe, prefix)
│
├── common/
│   ├── decorators/                # @Public, @Roles, @SkipEmailVerification
│   ├── filters/                   # HttpExceptionFilter (global error envelope)
│   ├── guards/                    # EmailVerifiedGuard, OnboardingCompletedGuard, RolesGuard
│   ├── interceptors/              # ResponseTransformInterceptor
│   ├── interfaces/                # ApiResponse<T>, ApiError
│   ├── error-codes.enum.ts        # Stable, frontend-facing error codes
│   └── geoip.service.ts           # IP → country lookup (geoip-lite)
│
├── auth/
│   ├── auth.controller.ts         # 10 endpoints (register, login, OTP, …)
│   ├── auth.service.ts            # Bcrypt, JWT, OTP, lockout, internal rate limits
│   ├── dto/                       # RegisterDto, LoginDto, ForgotPasswordDto, …
│   ├── guards/                    # JwtAuthGuard (registered globally)
│   ├── strategies/                # JwtStrategy (cookie + Bearer header extraction)
│   └── interfaces/                # JwtPayload
│
├── users/
│   ├── users.controller.ts        # /users/me + /users/me/onboarding
│   ├── users.service.ts           # Profile CRUD, password change, onboarding
│   └── dto/                       # UpdateUserDto, ChangePasswordDto, OnboardingResponseItemDto
│
├── prisma/                        # @Global PrismaService
├── health/                        # GET /health
├── tasks/                         # CleanupService (cron-driven)
├── mail/                          # AWS SES adapter (currently logger stub)
├── analytics/                     # PostHog adapter (currently logger stub)
│
├── paths/, lessons/, progress/, quizzes/, projects/,
│ subscriptions/, payments/, certificates/, admin/, storage/
│   └── …                          # Stub modules — wired into AppModule, ready for feature work
│
prisma/
├── schema.prisma                  # Data model (16 enums, 20+ models)
└── migrations/                    # SQL migration history
test/
├── app.e2e-spec.ts                # App-shell smoke tests
├── auth.e2e-spec.ts               # 107 auth endpoint tests
├── onboarding.e2e-spec.ts         # 82 onboarding tests + 1 todo
└── jest-e2e.json                  # Jest e2e config
postman/
└── awamer-api.postman_collection.json
specs/                             # Feature specs and design docs
docs/                              # Module-level documentation
```

---

## 11. Database & Migrations

The schema is managed with **Prisma** against PostgreSQL. The data model is
defined in `prisma/schema.prisma` and contains ~20 models covering users,
content hierarchy, learning progress, quizzes, subscriptions, and
certificates.

The Prisma schema is driven by the Awamer Data Model on Confluence. For
details on the most recent schema changes, see
[`prisma/MIGRATION_NOTES.md`](./prisma/MIGRATION_NOTES.md).

### Common commands

```bash
# Apply pending migrations to your local DB and regenerate the Prisma client
npx prisma migrate dev

# Create a new migration after editing schema.prisma
npx prisma migrate dev --name describe_your_change

# Reset the database (drops everything, re-applies migrations) — DEV ONLY
npx prisma migrate reset

# Open Prisma Studio (browser-based DB inspector)
npx prisma studio   # http://localhost:5555

# Regenerate the Prisma client without changing the DB
npx prisma generate
```

### Migration history

| Migration | What it adds |
|---|---|
| `20260329120744_init` | Initial schema (users, profile, roles, content hierarchy, progress, quizzes, subscriptions, …) |
| `20260329130229_add_password_reset_fields` | `passwordResetToken`, `passwordResetExpires` on `User` |
| `20260401180957_add_email_verification` | `EmailVerification` model + `emailVerified` flag |
| `20260404200000_add_password_reset_request_tracking` | `RateLimitedRequest` model with type enum |
| `20260405090000_add_account_lockout_fields` | `failedLoginAttempts`, `lockedUntil` on `User` |
| `20260405140000_hash_otp_code_varchar64` | OTP column expanded to 64 chars (SHA-256 hex) |
| `20260405143000_add_registration_ip_detected_country` | `registrationIp`, `detectedCountry` on `User` |

> **Production migrations** — never run `migrate reset` or `migrate dev`
> against production. Use `npx prisma migrate deploy` from your CI/CD
> pipeline.

---

## 12. Testing (Unit + End-to-End)

The project has **two test tiers**: fast unit tests with mocked Prisma, and
slower e2e tests that bootstrap the full app and hit a real PostgreSQL.

### Unit tests — `npm run test`

- 17 suites, **306 tests**, runs in ~6 seconds.
- Live alongside source files as `*.spec.ts` (e.g. `users.service.ts` →
  `users.service.spec.ts`).
- Every collaborator (Prisma, JwtService, ConfigService, AnalyticsService,
  MailService) is mocked. No DB, no network.

```bash
npm run test                                    # full unit suite
npm run test:watch                              # watch mode
npm run test:cov                                # coverage report → ./coverage
npx jest src/auth/auth.service.spec.ts          # single file
```

### End-to-end tests — `npm run test:e2e`

- 3 suites, **192 tests + 1 todo**, runs in ~40 seconds.
- Bootstrap the real `AppModule`, hit endpoints with `supertest`, and run
  against the **real local database**. Only `ThrottlerGuard.canActivate`
  is mocked at the prototype level.
- Covers: 107 auth endpoint tests, 82 onboarding tests (including
  rate-limiting, transaction rollback, analytics, JWT cookie shape,
  TOCTOU concurrency), and 3 app-shell smoke tests (health route, global
  prefix, JwtAuthGuard wiring).

```bash
npm run test:e2e                                # full e2e suite
npx jest --config test/jest-e2e.json test/onboarding.e2e-spec.ts   # single file
```

> **Heads up** — the e2e tests write to the real DB you point
> `DATABASE_URL` at. Use a dedicated test database, not your dev DB,
> if you want isolation.

---

## 13. Security

This is a defense-in-depth setup. Highlights:

- **Helmet** sets sane HTTP security headers (X-Frame-Options, X-Content-Type-Options,
  Strict-Transport-Security, …).
- **CORS** is locked to `ALLOWED_ORIGINS` (defaults to `http://localhost:3000`
  in dev). `credentials: true` is required for cookie auth.
- **Cookies** are `httpOnly`, `secure: true` in production, `sameSite: 'strict'`,
  with `path: '/api/v1/auth'` on the refresh token to keep it scoped to
  auth routes only.
- **Password requirements**: 8–128 chars, must contain upper + lower +
  digit + special character (enforced in DTO).
- **Bcrypt** at cost 12 for password hashing AND for storing the hashed
  refresh token.
- **Account lockout**: 10 failed login attempts → 15-minute lockout (per
  user, not per IP).
- **OTP security**: 6-digit codes, SHA-256 hashed at rest, **timing-safe
  compare**, max 5 attempts per code, 10-minute expiry.
- **Reset tokens**: SHA-256 hashed, 1-hour expiry, single-use.
- **Timing-attack resistance**: a dummy bcrypt compare runs on logins for
  non-existent emails so the response time doesn't reveal account
  existence.
- **Enumeration resistance**: forgot-password always returns 200 regardless
  of whether the email exists.
- **Atomic onboarding flip**: TOCTOU-safe via a conditional
  `updateMany({ where: { onboardingCompleted: false } })`. Refresh-token
  rotation is folded into the same transaction.
- **No reflected user input** in error messages (audit M-2 fix). Validation
  failures use stable `errorCode` strings instead.
- **Input validation**: global `ValidationPipe` with `whitelist: true`,
  `forbidNonWhitelisted: true`, `transform: true`. Extra fields are
  rejected, not silently dropped.
- **GeoIP** (`geoip-lite`) resolves the registration IP to a country code
  server-side and stores it on the user.
- **Helmet, ValidationPipe, CORS, cookie-parser** are all bootstrapped in
  `main.ts`.

Sensitive fields are never returned: `passwordHash`, `refreshToken` (the
hashed copy), `passwordResetToken`, `emailVerification.code`, and quiz
`isCorrect` flags are scrubbed via service-level sanitization.

---

## 14. Authentication & Authorization

### JWTs & sessions

- **Access token** — short-lived (15 min by default), signed with
  `JWT_SECRET`. Carried in the `access_token` httpOnly cookie OR an
  `Authorization: Bearer` header. Extracted by `JwtStrategy`.
- **Refresh token** — longer-lived (7d default; 30d for "remember me" on
  login), signed with `JWT_REFRESH_SECRET`. Stored in the `refresh_token`
  httpOnly cookie scoped to `path=/api/v1/auth`. The bcrypt-hashed copy
  is persisted on `User.refreshToken`.
- **Token rotation** — `POST /auth/refresh` issues a new access + refresh
  pair every time, replacing the stored hash. Old refresh tokens are
  rejected immediately.
- **Logout** clears both cookies and sets `User.refreshToken = null` so
  the previous refresh token can no longer rotate.
- **Onboarding completion** also rotates tokens — the new payload carries
  `onboardingCompleted: true` so the frontend's middleware can let the user
  through to `/dashboard` without an extra round-trip.

### JWT payload

```ts
{
  sub: string;              // user UUID
  email: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  roles: string[];          // e.g. ['LEARNER'] or ['ADMIN', 'LEARNER']
  iat: number;
  exp: number;
}
```

### Guards

| Guard | Scope | Purpose |
|---|---|---|
| `JwtAuthGuard` | Global (`APP_GUARD`) | Validates JWT on every request, except handlers decorated with `@Public()` |
| `EmailVerifiedGuard` | Per-route | Blocks users whose email is not yet verified |
| `OnboardingCompletedGuard` | Per-route | Blocks users who haven't finished onboarding |
| `RolesGuard` | Per-route | Checks `@Roles('admin')` etc. against the JWT payload |
| `ThrottlerGuard` | Global (`APP_GUARD`) | Global IP rate limit (see section 17) |

### Roles

Roles are stored in the `UserRole` table (a user can have multiple). The
JWT payload includes a flat `roles: string[]` for fast guard checks.
Currently only `LEARNER` and `ADMIN` are defined.

---

## 15. Error Handling

All errors flow through a single global filter:
`src/common/filters/http-exception.filter.ts`. The filter normalizes every
exception — whether it came from a controller `throw`, a guard, the
ValidationPipe, or an unhandled crash — into one stable response shape.

### Error response shape

```jsonc
{
  "statusCode": 400,
  "message": "Onboarding already completed",
  "errorCode": "ONBOARDING_ALREADY_COMPLETED",   // optional
  "errors": [ /* class-validator messages, when present */ ]  // optional
}
```

- `statusCode` — HTTP status code, mirrored in the body for clients that
  can't read headers easily.
- `message` — human-readable, **never contains user-supplied input** (audit
  M-2 fix). Frontend uses it as a fallback only.
- `errorCode` — stable string the frontend switches on. Defined in
  `src/common/error-codes.enum.ts`. Examples:
  `INVALID_CREDENTIALS`, `EMAIL_ALREADY_EXISTS`, `WEAK_PASSWORD`,
  `WRONG_CURRENT_PASSWORD`, `ONBOARDING_ALREADY_COMPLETED`,
  `INVALID_BACKGROUND`, `INVALID_GOALS`, `RATE_LIMIT_EXCEEDED`,
  `VALIDATION_FAILED`, `INTERNAL_ERROR`.
- `errors` — when class-validator rejects a payload, the array of
  per-field constraint messages is included here and `errorCode` is set
  to `VALIDATION_FAILED`.

### How to throw structured errors from a service

```ts
throw new BadRequestException({
  message: 'Invalid background value',
  errorCode: ErrorCode.INVALID_BACKGROUND,
  field: 'background',           // optional, currently dropped by the filter
});
```

### Unhandled exceptions

Anything that isn't an `HttpException` is logged via `Logger.error` (with
stack trace) and returns:

```json
{
  "statusCode": 500,
  "errorCode": "INTERNAL_ERROR",
  "message": "An unexpected error occurred"
}
```

Internal details (DB connection strings, stack traces, etc.) are **never**
leaked to the client.

---

## 16. Logging & Monitoring

### Logging

- The project uses NestJS's built-in `Logger` with the default text
  formatter — there's no Winston / Pino layer (yet).
- Each service and the global `HttpExceptionFilter` instantiate their own
  `Logger` with a component name, so log lines are tagged
  (`[AuthService]`, `[HttpExceptionFilter]`, etc.).
- Unhandled exceptions are logged with stack traces; HTTP exceptions are
  not noisy by design.

### Tracing

Not configured yet. When you add OpenTelemetry, the natural seams are
`main.ts` (SDK init) and an interceptor for span tagging.

### Metrics

Not configured yet. PostHog is wired up via `AnalyticsModule` for
**product-level** events (see PostHog event list in `CLAUDE.md`):
`user_signed_up`, `onboarding_completed`, `lesson_completed`,
`payment_completed`, etc. The current `AnalyticsService` is a logger
stub — implementing it against the real PostHog SDK is a one-file change.

### Health

`GET /api/v1/health` returns `{ status: 'ok' }` and is `@Public()`. Use
this for load-balancer health checks. The endpoint does **not** currently
verify DB connectivity — extend `HealthController` if you need that.

---

## 17. Rate Limiting & Throttling

There are **two layers**, by design:

### Layer 1 — global IP throttler

- Implementation: `@nestjs/throttler`, registered as `APP_GUARD` in
  `AppModule`.
- Defaults: `THROTTLE_TTL=60000` (60s), `THROTTLE_LIMIT=100` (req/IP/window).
- Per-route overrides via `@Throttle({ default: { limit, ttl } })`. Examples
  in use:
  - `POST /auth/login` — 5 / 60s
  - `POST /auth/register` — 10 / 60s
  - `POST /users/me/onboarding` — 5 / 60s
  - `GET /users/me/onboarding` — 20 / 60s
- Returns HTTP `429 Too Many Requests` with a `Retry-After` header when
  exceeded.

### Layer 2 — application-level DB tracking

For sensitive endpoints we track requests in a dedicated
`RateLimitedRequest` table (with a `type` enum) so we can apply per-user /
per-email limits that the IP-based throttler can't enforce. This catches
abuse from behind shared NATs and across IP rotations.

| Endpoint | Per-target limits |
|---|---|
| `POST /auth/forgot-password` | Per-IP daily cap (10/24h) |
| `POST /auth/send-verification` / `resend-verification` | 60s cooldown per email + hourly cap per email + daily cap per IP |
| `POST /auth/reset-password` | Single-use token (effectively rate-limited by token validity) |

### Rate limit reset

Old `RateLimitedRequest` rows are deleted by a cron job (see section 18).

---

## 18. Background Jobs / Scheduling

Scheduling uses `@nestjs/schedule`. Cron jobs live under `src/tasks/`.

### Active jobs

| Job | Schedule | Source | What it does |
|---|---|---|---|
| `cleanupExpiredRateLimits` | `EVERY_HOUR` | `src/tasks/cleanup.service.ts` | Deletes `RateLimitedRequest` rows older than 24 h to keep the table small and queries fast |

### How a job is wired

```ts
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredRateLimits() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.prisma.rateLimitedRequest.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    this.logger.log(`Cleaned up ${result.count} expired rate limit records`);
  }
}
```

### Queues

There is **no message queue** in the project today (no BullMQ, no Redis,
no SQS). All work is synchronous. When you need async processing for
emails, webhooks, or long-running jobs, the natural addition is BullMQ
backed by Redis — wire it up under a new `src/queues/` module and
register it in `AppModule`.

### Future scheduled work

Likely candidates as the platform grows: nightly progress recalculation,
expired-subscription sweeps, certificate generation retries, PostHog
event flush. Add them as new methods on `CleanupService` or as their
own services under `src/tasks/`.

---

## License

UNLICENSED — internal Awamer project. Do not distribute.
