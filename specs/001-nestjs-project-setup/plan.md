# Implementation Plan: NestJS Project Foundation Setup

**Branch**: `001-nestjs-project-setup` | **Date**: 2026-03-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-nestjs-project-setup/spec.md`

## Summary

Bootstrap the complete NestJS backend infrastructure for the Awamer educational
platform. This feature establishes the project skeleton: TypeScript configuration,
Prisma + PostgreSQL connection, 14 self-contained domain module stubs, Passport
JWT authentication (httpOnly cookies), global ValidationPipe, Helmet security
headers, rate limiting via @nestjs/throttler, CORS for localhost:3000, a standard
response/error envelope, and a `GET /api/v1/health` endpoint. No business logic is
implemented — this is pure infrastructure scaffolding.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS)
**Primary Dependencies**: NestJS 10, Prisma 5, @nestjs/passport, passport-jwt,
  @nestjs/jwt, class-validator, class-transformer, @nestjs/throttler 6,
  helmet, @nestjs/config, joi, cookie-parser
**Storage**: PostgreSQL 15+ via Prisma ORM
**Testing**: Jest (NestJS default, via @nestjs/testing)
**Target Platform**: Linux server (Node.js 20 LTS), local dev on macOS
**Project Type**: REST API web service
**Performance Goals**: Health endpoint < 50ms p95; simple API reads < 200ms p95
**Constraints**: All secrets via env vars; CORS restricted to FRONTEND_URL;
  no hardcoded credentials; httpOnly cookie JWT transport
**Scale/Scope**: 14 module stubs + shared infrastructure; ~60 files at completion

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Module Isolation | ✅ PASS | Each of 14 modules gets its own directory with module/controller/service. Cross-module access via NestJS imports only. PrismaModule is `@Global()`. |
| II. Security-First | ✅ PASS | Helmet active globally. JwtAuthGuard registered as APP_GUARD with `@Public()` bypass. Sensitive fields absent from stubs. ValidationPipe strips unknowns. Env validation at bootstrap. |
| III. Standard Response Contract | ✅ PASS | Global `ResponseTransformInterceptor` wraps all 2xx in `{ data, message }`. Global `HttpExceptionFilter` formats all errors as `{ statusCode, message, errors }`. Base path `/api/v1`. |
| IV. Transactional Integrity | ✅ PASS | PrismaService globally available; `$transaction` pattern documented in quickstart. No multi-step writes in this setup feature (stubs only). |
| V. Data Validation & Type Safety | ✅ PASS | ValidationPipe with `whitelist: true` + `forbidNonWhitelisted: true`. TypeScript strict mode in `tsconfig.json`. UUID + DateTime patterns documented in data-model.md. |
| VI. Access Control Hierarchy | ✅ PASS | JwtAuthGuard as APP_GUARD (global). RolesGuard, ContentAccessGuard, EnrollmentGuard, StripeWebhookGuard scaffolded as stubs. Health endpoint uses `@Public()`. |

**Post-Phase 1 re-check**: All gates confirmed ✅ — no violations. No Complexity
Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/001-nestjs-project-setup/
├── plan.md              ← This file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   └── api-contracts.md ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit.tasks — not yet created)
```

### Source Code (repository root)

```text
src/
├── main.ts                          ← Bootstrap: Helmet, CORS, ValidationPipe,
│                                      cookie-parser, global prefix /api/v1
├── app.module.ts                    ← Root: imports all 14 domain modules +
│                                      PrismaModule, ConfigModule, ThrottlerModule
│
├── common/
│   ├── filters/
│   │   └── http-exception.filter.ts ← Global error envelope { statusCode, message, errors }
│   ├── interceptors/
│   │   └── response-transform.interceptor.ts ← Global success envelope { data, message }
│   ├── guards/
│   │   ├── roles.guard.ts           ← Stub (returns true)
│   │   ├── content-access.guard.ts  ← Stub (returns true)
│   │   └── enrollment.guard.ts      ← Stub (returns true)
│   ├── decorators/
│   │   ├── public.decorator.ts      ← @Public() — bypasses JwtAuthGuard
│   │   └── roles.decorator.ts       ← @Roles(...) — used by RolesGuard
│   └── interfaces/
│       ├── api-response.interface.ts
│       └── api-error.interface.ts
│
├── prisma/
│   ├── prisma.module.ts             ← @Global() module exporting PrismaService
│   └── prisma.service.ts            ← Extends PrismaClient, OnModuleInit/$connect
│
├── health/
│   ├── health.module.ts
│   └── health.controller.ts         ← GET /api/v1/health → { status: 'ok' }
│
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts           ← Stub endpoints
│   ├── auth.service.ts              ← Stub
│   ├── strategies/
│   │   └── jwt.strategy.ts          ← passport-jwt; reads access_token cookie
│   ├── guards/
│   │   └── jwt-auth.guard.ts        ← Extends AuthGuard('jwt'); checks @Public()
│   └── interfaces/
│       └── jwt-payload.interface.ts
│
├── users/
│   ├── users.module.ts
│   ├── users.controller.ts
│   └── users.service.ts
│
├── paths/
│   ├── paths.module.ts
│   ├── paths.controller.ts
│   └── paths.service.ts
│
├── lessons/
│   ├── lessons.module.ts
│   ├── lessons.controller.ts
│   └── lessons.service.ts
│
├── progress/
│   ├── progress.module.ts
│   ├── progress.controller.ts
│   └── progress.service.ts
│
├── quizzes/
│   ├── quizzes.module.ts
│   ├── quizzes.controller.ts
│   └── quizzes.service.ts
│
├── projects/
│   ├── projects.module.ts
│   ├── projects.controller.ts
│   └── projects.service.ts
│
├── subscriptions/
│   ├── subscriptions.module.ts
│   ├── subscriptions.controller.ts
│   └── subscriptions.service.ts
│
├── payments/
│   ├── payments.module.ts
│   ├── payments.controller.ts
│   ├── payments.service.ts
│   └── guards/
│       └── stripe-webhook.guard.ts  ← Stub (returns true)
│
├── certificates/
│   ├── certificates.module.ts
│   ├── certificates.controller.ts
│   └── certificates.service.ts
│
├── admin/
│   ├── admin.module.ts
│   ├── admin.controller.ts
│   └── admin.service.ts
│
├── analytics/
│   ├── analytics.module.ts
│   ├── analytics.controller.ts
│   └── analytics.service.ts
│
├── mail/
│   ├── mail.module.ts               ← No controller (internal service)
│   └── mail.service.ts
│
└── storage/
    ├── storage.module.ts            ← No controller (internal service)
    └── storage.service.ts

prisma/
└── schema.prisma                    ← Generator + datasource; entities added later

.env.example                         ← All required variables with comments
```

**Structure Decision**: Single-project layout. `awamer-api` is the only deployable
unit in this repository. The Next.js frontend lives in a separate repo (`awamer-web`)
and communicates via REST. No monorepo tooling needed.

## Complexity Tracking

> No constitution violations — this table is intentionally empty.