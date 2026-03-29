# Implementation Plan: Complete Auth Module

**Branch**: `003-auth-module` | **Date**: 2026-03-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-auth-module/spec.md`

## Summary

Implement all 6 authentication endpoints (register, login, logout, refresh, forgot-password, reset-password) in the existing NestJS AuthModule. Uses Passport JWT strategy (already scaffolded), bcrypt for password hashing, class-validator DTOs, httpOnly cookies, and Prisma transactions for atomic user creation. Requires a schema migration to add password reset fields to the User model.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS)
**Primary Dependencies**: NestJS 10, @nestjs/passport, @nestjs/jwt, passport-jwt, bcrypt, class-validator, class-transformer, @nestjs/throttler, cookie-parser
**Storage**: PostgreSQL 15+ via Prisma 6.19
**Testing**: Jest 29 (unit), Supertest (e2e)
**Target Platform**: Linux/macOS server (Node.js runtime)
**Project Type**: Web service (REST API backend)
**Performance Goals**: Registration < 5s, Login < 3s, Refresh < 1s
**Constraints**: httpOnly/secure/sameSite cookies; access token 15min, refresh token 7 days; bcrypt 12 rounds; password min 8 chars + upper + lower + digit
**Scale/Scope**: 6 endpoints, 6 DTOs, 1 service, 1 controller, 1 strategy (existing), 1 guard (existing), schema migration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Module Isolation | PASS | Auth module is self-contained with its own controller, service, and DTOs. Depends on PrismaModule (global) and MailModule (imported). No shared DTOs. |
| II. Security-First | PASS | passwordHash never exposed in responses. Cookies are httpOnly/secure/sameSite. Generic error messages prevent credential enumeration. Refresh token rotation prevents reuse. bcrypt 12 rounds for hashing. |
| III. Standard Response Contract | PASS | All responses follow `{ data, message }` envelope. Errors use `{ statusCode, message, errors }`. Validation errors return field-level details. |
| IV. Transactional Integrity | PASS | Registration creates User + UserProfile + UserRole + Subscription in a single Prisma `$transaction`. Password reset updates hash and clears token atomically. |
| V. Data Validation & Type Safety | PASS | All 6 endpoints have class-validator DTOs. ValidationPipe globally enabled. UUIDs for all PKs. Dates as DateTime/ISO strings. |
| VI. Access Control Hierarchy | N/A | Auth module handles authentication, not content access. JwtAuthGuard already exists and is applied to protected endpoints. |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-auth-module/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma                    # Add passwordResetToken + passwordResetExpires to User
└── migrations/
    └── YYYYMMDDHHMMSS_add_password_reset_fields/

src/
├── auth/
│   ├── auth.module.ts               # Update: import MailModule, add bcrypt provider
│   ├── auth.controller.ts           # Rewrite: 6 endpoints
│   ├── auth.service.ts              # Rewrite: full implementation
│   ├── dto/
│   │   ├── register.dto.ts          # New
│   │   ├── login.dto.ts             # New
│   │   ├── forgot-password.dto.ts   # New
│   │   └── reset-password.dto.ts    # New
│   ├── guards/
│   │   └── jwt-auth.guard.ts        # Existing (no changes)
│   ├── interfaces/
│   │   └── jwt-payload.interface.ts  # Existing (no changes)
│   └── strategies/
│       └── jwt.strategy.ts           # Existing (no changes)
├── mail/
│   ├── mail.module.ts               # Existing (no changes)
│   └── mail.service.ts              # Update: add sendPasswordReset method
└── common/
    └── decorators/
        └── public.decorator.ts       # Existing (used for public auth routes)
```

**Structure Decision**: All auth code stays within `src/auth/`. New DTOs go in `src/auth/dto/`. MailService gets a password reset method. No new modules created.

## Complexity Tracking

> No constitution violations — table intentionally left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
