# Awamer API — Backend

## Project Overview

Awamer (أوامر) is an Arabic-first educational platform specializing in high-value technical skills (AI, Cybersecurity, Cloud/DevOps). The primary market is Saudi Arabia. This is the NestJS backend API serving the Next.js frontend (awamer-web).

## Architecture

- **This project**: `awamer-api` — NestJS backend (REST API)
- **Frontend project**: `awamer-web` — Next.js 15 (separate repo)
- **Communication**: REST API only. Frontend calls this API via fetch/React Query
- **Auth**: JWT via httpOnly cookies. Frontend at `localhost:3000`, backend at `localhost:3001`

## Tech Stack

- **Framework**: NestJS + TypeScript
- **ORM**: Prisma with PostgreSQL
- **Auth**: Passport JWT (access token 15min + refresh token 7 days stored in DB)
- **Validation**: class-validator + class-transformer
- **Rate Limiting**: @nestjs/throttler
- **Security**: Helmet middleware
- **File Storage**: AWS S3 (pre-signed URLs)
- **Email**: AWS SES
- **Payment**: Stripe (subscriptions with webhooks)
- **Analytics**: PostHog (server-side capture for critical events)

## API Conventions

- Base URL: `/api/v1/`
- URLs: kebab-case (`/api/v1/lesson-content`)
- Query params: snake_case (`?page=1&sort=created_at`)
- Request/Response bodies: camelCase (`{ "firstName": "..." }`)
- Success response: `{ "data": { ... }, "message": "Success" }`
- Paginated response: `{ "data": [...], "meta": { "total", "page", "limit", "totalPages" } }`
- Error response: `{ "statusCode": 400, "message": "...", "errors": [...] }`
- Pagination: `?page=1&limit=20` (max 100)
- Sorting: `?sort=created_at&order=desc`

## Module Structure

Each module follows the pattern: Controller + Service + DTOs + Entity references via Prisma.

| Module | Responsibility |
|--------|---------------|
| AuthModule | Register, login, logout, refresh, forgot/reset password |
| UsersModule | Profile CRUD, password change, onboarding |
| PathsModule | Categories, paths, courses, sections (public endpoints) |
| LessonsModule | Lessons, content blocks |
| ProgressModule | Lesson/section/course/path progress, last position |
| QuizzesModule | Quizzes, questions, options, attempts, auto-grading |
| ProjectsModule | Projects, submissions |
| SubscriptionsModule | Plans, subscriptions, Stripe checkout/portal |
| PaymentsModule | Payment records, Stripe webhook handler |
| CertificatesModule | Certificate generation and verification |
| AdminModule | Dashboard stats, content CRUD, user management |
| AnalyticsModule | PostHog event tracking |
| MailModule | Email sending via AWS SES |
| StorageModule | S3 file upload and pre-signed URLs |

## Data Model — Core Entities

### Content Hierarchy
```
Category (1) → Path (many) → Course (many) → Section (many) → Lesson (many) → LessonContentBlock (many)
```

### Key Entities

**User**: id (UUID), name, email (unique), passwordHash, country, locale (default "ar"), status, lastLoginAt
**UserProfile**: userId (1:1), displayName, avatarUrl, background, goals, interests, preferredLanguage, onboardingCompleted
**UserRole**: userId + role (enum: learner, admin). One user can have multiple roles.
**OnboardingResponse**: userId, questionKey, answer, stepNumber

**Category**: id, name, slug (unique), description, icon, order, status (active/hidden)
**Path**: id, categoryId, title, slug (unique), description, level, thumbnail, estimatedHours, is_free, status (draft/published/archived), order
**Course**: id, pathId, title, description, order, is_free, status
**Section**: id, courseId, title, order
**Lesson**: id, sectionId, title, type (text/video/interactive/mixed), order, is_free, estimatedMinutes
**LessonContentBlock**: id, lessonId, format (markdown/html/video/code/image/interactive), body, videoUrl, metadata (JSON), order, version

**PathEnrollment**: id, userId, pathId, status (active/completed/paused), enrolledAt
**LessonProgress**: userId, lessonId, status (not_started/in_progress/completed), completedAt
**SectionProgress**: userId, sectionId, completedLessons, totalLessons, percentage, status
**CourseProgress**: userId, courseId, completedSections, totalSections, percentage, status
**PathProgress**: userId, pathId, completedCourses, totalCourses, percentage, status
**LastPosition**: userId, pathId, courseId, sectionId, lessonId, accessedAt

**Quiz**: id, courseId, sectionId (nullable), title, type (section_quiz/course_exam), passingScore, timeLimitMinutes, questionCount, order
**Question**: id, quizId, body, type (single_choice/multiple_choice), explanation, order
**Option**: id, questionId, body, isCorrect, order
**QuizAttempt**: id, userId, quizId, score, status (in_progress/passed/failed), answers (JSON), startedAt, completedAt

**Project**: id, courseId, title, description, order
**ProjectSubmission**: id, userId, projectId, submissionData (JSON), status (submitted/reviewed), submittedAt

**SubscriptionPlan**: id, name, billingCycle (free/monthly/quarterly/yearly), price, currency (USD), durationDays, isDefault, stripePriceId, status
**Subscription**: id, userId, planId, status (active/cancelled/expired/past_due), stripeSubscriptionId, stripeCustomerId, currentPeriodStart, currentPeriodEnd
**Payment**: id, userId, subscriptionId, planId, amount, currency, status (completed/failed/refunded), stripePaymentIntentId, paidAt

**Certificate**: id, userId, pathId, certificateCode (unique), certificateUrl, issuedAt

## Access Control — 5 Guards

1. **JwtAuthGuard**: Validates JWT token → all non-public endpoints
2. **RolesGuard**: Checks user role (learner/admin) → role-specific endpoints
3. **ContentAccessGuard**: Checks access hierarchy:
   - Path.is_free = true? → allow
   - Course.is_free = true? → allow
   - Lesson.is_free = true? → allow
   - User has active paid subscription? → allow
   - Otherwise → deny (403 with `{ reason: "subscription_required", upgradeUrl }`)
4. **EnrollmentGuard**: Checks user is enrolled in the path → learning/progress endpoints
5. **StripeWebhookGuard**: Validates Stripe webhook signature → webhook endpoint only

## Progress Update Logic (Transactional)

When `POST /learning/lessons/:lessonId/complete` is called:
1. Update LessonProgress → completed
2. Recalculate SectionProgress (completedLessons / totalLessons)
3. Recalculate CourseProgress (completedSections / totalSections)
4. Recalculate PathProgress (completedCourses / totalCourses)
5. Update LastPosition
6. If PathProgress = 100% AND all quizzes passed → trigger CertificateService

All steps are in a single Prisma transaction.

## Authentication Flow

1. Register → create User + UserProfile + UserRole(learner) + Subscription(free plan) → hash password with bcrypt → issue JWT
2. Login → validate credentials → issue access token (15min) + refresh token (7 days) → set httpOnly cookies → store refresh in DB
3. Refresh → validate refresh token → rotate (issue new pair, delete old)
4. Logout → clear cookies → delete refresh token from DB
5. Forgot password → always return 200 (prevent enumeration) → send reset email via SES
6. Reset password → validate token → update password hash

## Stripe Integration

- **Product**: Awamer Plus (one product, 3 prices: monthly/quarterly/yearly)
- **Checkout**: `POST /subscriptions/checkout` → create Stripe Checkout Session → return URL
- **Portal**: `POST /subscriptions/portal` → create Stripe Customer Portal session
- **Webhook** at `POST /webhooks/stripe`:
  - `checkout.session.completed` → create/update Subscription + Payment
  - `invoice.payment_succeeded` → record Payment, extend Subscription
  - `invoice.payment_failed` → update Subscription status
  - `customer.subscription.updated` → sync Subscription
  - `customer.subscription.deleted` → cancel Subscription

## Coding Rules

- Every module is self-contained: controller + service + DTOs
- All DTOs use class-validator decorators for validation
- NestJS ValidationPipe is globally enabled
- All endpoints return the standard response format: `{ data, message }`
- Errors use NestJS built-in exception filters
- Use Prisma's `$transaction` for multi-step operations
- Never expose `passwordHash`, `isCorrect` (quiz options), or internal IDs unnecessarily
- Use UUIDs for all primary keys
- Dates stored as DateTime, returned as ISO strings

## Environment Variables

```
DATABASE_URL=postgresql://user:password@localhost:5432/awamer
JWT_SECRET=<your-jwt-secret>
JWT_REFRESH_SECRET=<your-jwt-refresh-secret>
STRIPE_SECRET_KEY=<your-stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-secret>
AWS_ACCESS_KEY_ID=<your-aws-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key>
AWS_REGION=eu-west-1
S3_BUCKET_NAME=awamer-files
SES_FROM_EMAIL=noreply@awamer.com
POSTHOG_API_KEY=<your-posthog-api-key>
FRONTEND_URL=http://localhost:3000
PORT=3001
```

## Documentation References

- Data Model: https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/28835841
- API Design: https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/27754532
- Tech Stack: https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/29458433
- PRD: https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/26607617
- User Flows: https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/27656193
- Jira Board: https://awamer.atlassian.net/jira/software/projects/KAN/boards/1

## PostHog Events to Track (Server-Side)

- user_signed_up, onboarding_completed
- path_started, lesson_completed, section_completed, course_completed, path_completed
- quiz_started, quiz_completed, project_submitted
- upgrade_clicked, checkout_started, payment_completed
- certificate_issued

## Recent Changes
- 015-categories-admin-crud: Added TypeScript 5.9 on Node.js 20 LTS + NestJS 11, Prisma 6.19 (`@prisma/client`), ioredis (via the existing `CacheService`), `class-validator` 0.15, `class-transformer` 0.5, `reflect-metadata`, RxJS 7. **No new dependencies — all required libraries are already installed** (KAN-78 + KAN-26 left them in place).
- 014-admin-foundation: Added TypeScript 5.9 on Node.js 20 LTS + NestJS 11, `@nestjs/passport` + `passport-jwt` (existing JWT auth), `class-validator` 0.15, `class-transformer` 0.5, `reflect-metadata`, RxJS 7. No new dependencies — all required libraries are already installed.
- 013-public-discovery: Added TypeScript 5.9 on Node.js 20 LTS + NestJS 11, Prisma 6.19, ioredis (via `CacheService`), class-validator 0.15, class-transformer 0.5, @nestjs/throttler 6.5 — **all already installed**, no new deps

## Active Technologies
- TypeScript 5.9 on Node.js 20 LTS + NestJS 11, Prisma 6.19 (`@prisma/client`), ioredis (via the existing `CacheService`), `class-validator` 0.15, `class-transformer` 0.5, `reflect-metadata`, RxJS 7. **No new dependencies — all required libraries are already installed** (KAN-78 + KAN-26 left them in place). (015-categories-admin-crud)
- PostgreSQL via Prisma. Redis (existing, used only for invalidating the `categories:all` key). (015-categories-admin-crud)
