# Data Model: NestJS Project Foundation Setup

**Feature**: `001-nestjs-project-setup`
**Date**: 2026-03-29

---

## Scope Note

This feature establishes the project infrastructure, not the business domain
entities. The full entity schema (User, Path, Course, Lesson, etc.) is defined
in `CLAUDE.md` and will be introduced in subsequent feature specs. This document
covers only:
1. The initial `schema.prisma` structure
2. The shared infrastructure types (JWT payload, response envelope, guards)

---

## 1. Prisma Schema (initial scaffold)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Domain models to be added in subsequent features ──────────────────────
// User, UserProfile, UserRole, OnboardingResponse
// Category, Path, Course, Section, Lesson, LessonContentBlock
// PathEnrollment, LessonProgress, SectionProgress, CourseProgress,
// PathProgress, LastPosition
// Quiz, Question, Option, QuizAttempt
// Project, ProjectSubmission
// SubscriptionPlan, Subscription, Payment
// Certificate
// RefreshToken
```

**Notes**:
- All future models will use `@id @default(uuid())` UUIDs (Principle V).
- All `DateTime` fields will be returned as ISO 8601 strings from the API.
- Migrations live in `prisma/migrations/` and MUST be committed to source control.

---

## 2. Shared TypeScript Types

### 2.1 JWT Payload

```typescript
// src/auth/interfaces/jwt-payload.interface.ts
export interface JwtPayload {
  sub: string;      // User UUID
  email: string;
  iat?: number;
  exp?: number;
}
```

**Validation rules**:
- `sub` MUST be a valid UUID.
- `exp` is set by `@nestjs/jwt` from the `JWT_EXPIRATION` env var (default: `900` = 15 min).

### 2.2 Standard API Response Envelope

```typescript
// src/common/interfaces/api-response.interface.ts
export interface ApiResponse<T> {
  data: T;
  message: string;
}

export interface PaginatedApiResponse<T> extends ApiResponse<T[]> {
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

**Validation rules**:
- `message` defaults to `"Success"` for 2xx responses.
- `meta.limit` MUST NOT exceed 100 (enforced at DTO level in paginated endpoints).

### 2.3 Error Envelope

```typescript
// src/common/interfaces/api-error.interface.ts
export interface ApiError {
  statusCode: number;
  message: string;
  errors?: string[] | Record<string, string[]>[];
}
```

**Validation rules**:
- `errors` is populated by `ValidationPipe`'s `exceptionFactory` for 400 responses.
- Stack traces and internal paths MUST never appear in `errors`.

---

## 3. Guard Stubs

The following guards are scaffolded at setup time. Full implementations arrive in
the features that introduce the relevant domain logic.

| Guard | Location | Status at Setup |
|-------|----------|-----------------|
| `JwtAuthGuard` | `src/auth/guards/jwt-auth.guard.ts` | Implemented (uses passport-jwt) |
| `RolesGuard` | `src/common/guards/roles.guard.ts` | Stub — returns `true` |
| `ContentAccessGuard` | `src/common/guards/content-access.guard.ts` | Stub — returns `true` |
| `EnrollmentGuard` | `src/common/guards/enrollment.guard.ts` | Stub — returns `true` |
| `StripeWebhookGuard` | `src/payments/guards/stripe-webhook.guard.ts` | Stub — returns `true` |

**State transitions** (guards evolve over feature iterations):
```
Stub (always allow) → Partial (type-checked) → Full (business rules enforced)
```

---

## 4. Environment Configuration Schema

All variables are validated at bootstrap via `@nestjs/config` + Joi.

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `DATABASE_URL` | string | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | string | ✅ | — | Access token signing secret |
| `JWT_REFRESH_SECRET` | string | ✅ | — | Refresh token signing secret |
| `JWT_EXPIRATION` | number | ❌ | `900` | Access token TTL in seconds |
| `JWT_REFRESH_EXPIRATION` | string | ❌ | `7d` | Refresh token TTL |
| `STRIPE_SECRET_KEY` | string | ✅ | — | Stripe API secret |
| `STRIPE_WEBHOOK_SECRET` | string | ✅ | — | Stripe webhook signing secret |
| `AWS_ACCESS_KEY_ID` | string | ✅ | — | AWS credential |
| `AWS_SECRET_ACCESS_KEY` | string | ✅ | — | AWS credential |
| `AWS_REGION` | string | ✅ | — | AWS region (e.g. `eu-west-1`) |
| `S3_BUCKET_NAME` | string | ✅ | — | S3 bucket for file storage |
| `SES_FROM_EMAIL` | string | ✅ | — | SES sender address |
| `POSTHOG_API_KEY` | string | ✅ | — | PostHog project API key |
| `FRONTEND_URL` | string | ❌ | `http://localhost:3000` | CORS allowed origin |
| `PORT` | number | ❌ | `3001` | HTTP server port |
| `THROTTLE_TTL` | number | ❌ | `60000` | Rate limit window in ms |
| `THROTTLE_LIMIT` | number | ❌ | `100` | Max requests per window |
