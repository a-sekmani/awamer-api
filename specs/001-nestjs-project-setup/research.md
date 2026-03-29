# Research: NestJS Project Foundation Setup

**Feature**: `001-nestjs-project-setup`
**Date**: 2026-03-29

---

## R-001: NestJS Project Structure for a Large REST API

**Decision**: Single `src/` root with flat domain-module directories, shared
infrastructure in `src/common/` and `src/prisma/`.

**Rationale**: NestJS recommends co-locating each domain module's controller,
service, and DTOs in a single directory. At 14 modules a monorepo workspace
would add unnecessary build complexity. A flat module layout is the de-facto
standard for NestJS REST APIs at this scale.

**Structure chosen**:
```
src/
  app.module.ts          ← root module
  main.ts                ← bootstrap
  common/
    filters/             ← global HTTP exception filter
    interceptors/        ← global response-transform interceptor
    guards/              ← shared guard stubs (roles, content-access, etc.)
    decorators/          ← @Public(), @Roles(), etc.
  prisma/
    prisma.module.ts
    prisma.service.ts
  health/
    health.module.ts
    health.controller.ts
  auth/  users/  paths/  lessons/  progress/  quizzes/
  projects/  subscriptions/  payments/  certificates/
  admin/  analytics/  mail/  storage/
```

**Alternatives considered**:
- Monorepo (Nx/Turborepo) — rejected; no separate deployable packages at this stage.
- Nested sub-domain directories (e.g., `features/auth/`) — rejected; adds nesting
  without benefit when all modules live in the same process.

---

## R-002: Prisma as a Global NestJS Module

**Decision**: Create a dedicated `PrismaModule` marked `@Global()` that exports
`PrismaService`. `PrismaService` extends `PrismaClient` and implements
`OnModuleInit` to call `$connect()` and `OnModuleDestroy` to call `$disconnect()`.

**Rationale**: Marking the module global eliminates the need to import
`PrismaModule` in every domain module while keeping a single connection pool.
This is the official NestJS + Prisma recommended pattern.

**Alternatives considered**:
- Importing `PrismaService` directly in each module — rejected; violates Module
  Isolation principle (modules must import, not directly instantiate).
- Using a repository layer — rejected; over-engineering for this project's scale.
  Prisma Client already provides a clean query API.

---

## R-003: Fail-Fast Environment Variable Validation

**Decision**: Use `@nestjs/config` with `Joi` validation schema (or
`class-validator` + `class-transformer` plain-object validation) applied in
`ConfigModule.forRoot({ validationSchema })`. The app throws and exits if any
required variable is missing.

**Rationale**: `@nestjs/config` provides first-class support for `Joi`-based env
validation. Running validation at bootstrap ensures `DATABASE_URL`, `JWT_SECRET`,
`JWT_REFRESH_SECRET` are present before any module initialises, satisfying FR-012
and the constitution's Security-First principle.

**Required variables** (from CLAUDE.md):
```
DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET,
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
S3_BUCKET_NAME, SES_FROM_EMAIL, POSTHOG_API_KEY,
FRONTEND_URL, PORT
```

**Alternatives considered**:
- Manual `process.env` checks in `main.ts` — rejected; does not scale and misses
  module-level injections.

---

## R-004: JWT Authentication via httpOnly Cookies

**Decision**: Use `@nestjs/passport` + `passport-jwt` with a custom
`cookieExtractor` function that reads the `access_token` cookie, NOT the
`Authorization` header. The `JwtStrategy` validates the token and populates
`req.user`. A `JwtAuthGuard` extending `AuthGuard('jwt')` is registered globally
with a `@Public()` decorator bypass.

**Rationale**: CLAUDE.md specifies httpOnly cookies as the JWT transport. Browser
clients cannot access httpOnly cookies via JavaScript, preventing XSS token theft.
The `@Public()` decorator pattern (checking `IS_PUBLIC_KEY` metadata in the guard)
allows opting out of auth per-endpoint cleanly.

**Alternatives considered**:
- Authorization Bearer header — rejected per CLAUDE.md specification.
- Session-based auth — rejected; the spec explicitly uses JWT.

---

## R-005: Rate Limiting with @nestjs/throttler v6

**Decision**: Install `@nestjs/throttler` and register `ThrottlerModule.forRootAsync()`
in `AppModule` reading TTL and limit from environment variables (defaults: 60s TTL,
100 requests). Apply `APP_GUARD` with `ThrottlerGuard` globally. Use
`@SkipThrottle()` or `@Throttle()` decorators for per-endpoint overrides.

**Rationale**: Global guard application via `APP_GUARD` is the simplest approach
and ensures no endpoint is accidentally unprotected. ThrottlerModule v6 is the
current stable version for NestJS 10.

**Defaults**: `THROTTLE_TTL=60000` (ms), `THROTTLE_LIMIT=100`

**Alternatives considered**:
- Per-route throttle decorators only — rejected; too easy to forget on new endpoints.
- Express-rate-limit middleware — rejected; not idiomatic NestJS; misses guard
  integration with throttler skip decorators.

---

## R-006: Global HTTP Exception Filter (Standard Error Envelope)

**Decision**: Create `HttpExceptionFilter` implementing `ExceptionFilter<HttpException>`.
It intercepts all `HttpException` instances and formats the response as:
```json
{ "statusCode": 400, "message": "Validation failed", "errors": [...] }
```
Register via `APP_FILTER` in `AppModule` providers. `ValidationPipe` uses
`exceptionFactory` to throw `BadRequestException` with the structured errors array
so `HttpExceptionFilter` can forward the `errors` field cleanly.

**Alternatives considered**:
- NestJS default exception layer — rejected; returns inconsistent shapes for
  different error types, violating the Standard Response Contract principle.

---

## R-007: Global Response Interceptor (Standard Success Envelope)

**Decision**: Create `ResponseTransformInterceptor` implementing
`NestInterceptor`. It wraps controller return values in:
```json
{ "data": <original return>, "message": "Success" }
```
Register via `APP_INTERCEPTOR` in `AppModule` providers. Controllers return plain
objects/arrays; the interceptor handles envelope wrapping automatically.

**Alternatives considered**:
- Returning the envelope directly from every controller — rejected; repetitive,
  error-prone, violates DRY, and couples controllers to the response shape.

---

## R-008: CORS Configuration

**Decision**: Enable CORS in `main.ts` via `app.enableCors()` with
`origin: process.env.FRONTEND_URL` (defaults to `http://localhost:3000`),
`credentials: true` (required for httpOnly cookies), and appropriate methods/headers.

**Rationale**: `credentials: true` is mandatory when using cookies as the auth
transport. The `FRONTEND_URL` env var makes this deployable without code changes.

---

## R-009: Health Check Endpoint Design

**Decision**: A minimal `HealthModule` with a `HealthController` that handles
`GET /api/v1/health` (with `@Public()` decorator bypassing JwtAuthGuard). Returns:
```json
{ "data": { "status": "ok" }, "message": "Success" }
```
No database ping in v1 — shallow health check only.

**Rationale**: The global `ResponseTransformInterceptor` handles envelope wrapping.
The controller just returns `{ status: 'ok' }`. No `@nestjs/terminus` dependency
needed for this simple case.

**Alternatives considered**:
- `@nestjs/terminus` — deferred; adds health indicators for DB/Redis/external
  services. Appropriate for a future deep health check endpoint.
