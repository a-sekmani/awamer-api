# Implementation Plan: Email Verification

**Branch**: `007-email-verification` | **Date**: 2026-04-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-email-verification/spec.md`

## Summary

Add mandatory email verification (6-digit OTP) between registration and onboarding. Three new endpoints (send-verification, verify-email, resend-verification), two modified endpoints (register, login), a new `EmailVerification` Prisma model, a new `emailVerified` flag on User, and a new `EmailVerifiedGuard` that blocks unverified users from onboarding/learning/enrollment endpoints.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS)
**Primary Dependencies**: NestJS 10, Prisma 6.19, @nestjs/jwt, @nestjs/passport, bcryptjs, class-validator, class-transformer, @nestjs/throttler, cookie-parser
**Storage**: PostgreSQL via Prisma ORM
**Testing**: Jest 29, @nestjs/testing, ts-jest
**Target Platform**: Linux server (Node.js)
**Project Type**: Web service (REST API)
**Performance Goals**: Standard web API response times (<500ms for all verification endpoints)
**Constraints**: OTP generation must use `crypto.randomInt` (cryptographically secure); rate limit 3 sends/15min; max 5 attempts/code; 10min expiry
**Scale/Scope**: Single module addition within AuthModule; 1 new Prisma model, 1 field addition, 1 new guard, 3 new endpoints, 2 modified endpoints

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Phase 0 Check

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. Module Isolation | PASS | Verification logic lives within AuthModule (same auth domain). New guard in `src/common/guards/` following existing pattern. No cross-module DTO sharing. |
| II. Security-First | PASS | OTP uses `crypto.randomInt` (CSPRNG). Codes expire after 10min. Max 5 attempts prevents brute force. Rate limiting prevents abuse. `emailVerified` never exposes sensitive data. All verification endpoints behind JwtAuthGuard. |
| III. Standard Response Contract | PASS | All new endpoints return `{ data, message }` format. Error responses follow `{ statusCode, message, errors }`. Paths use kebab-case under `/api/v1/auth/`. |
| IV. Transactional Integrity | PASS | `verify-email` updates both `EmailVerification` and `User.emailVerified` in a single `prisma.$transaction`. Code invalidation (marking old codes as used) is also transactional. |
| V. Data Validation & Type Safety | PASS | VerifyEmailDto uses `@Length(6,6)` and `@Matches(/^\d{6}$/)`. UUID primary keys. DateTime fields for expiry. No `any` types. |
| VI. Access Control Hierarchy | PASS | EmailVerifiedGuard is a new addition to the guard hierarchy, positioned after JwtAuthGuard and before content/enrollment guards. Does not modify existing access control logic. |

### Post-Phase 1 Check

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. Module Isolation | PASS | EmailVerification model owned by AuthModule. EmailVerifiedGuard in common/guards following existing stub patterns. MailModule imported via NestJS DI (already exists in AuthModule imports). |
| II. Security-First | PASS | OTP codes stored as plain strings (6 digits, short-lived — hashing not needed for 10min expiry with attempt limits). `code` field never returned in API responses. |
| III. Standard Response Contract | PASS | All 3 new endpoints + 2 modified endpoints verified against contract format. |
| IV. Transactional Integrity | PASS | verify-email: single transaction updates EmailVerification.used + User.emailVerified. send-verification: single transaction invalidates old codes + creates new one. |
| V. Data Validation & Type Safety | PASS | VerifyEmailDto validated. All IDs are UUIDs. expiresAt is DateTime. attempts is Int. |
| VI. Access Control Hierarchy | PASS | EmailVerifiedGuard checks `user.emailVerified` from DB. Explicitly skips auth/verification routes and GET /users/me. Does not interfere with ContentAccessGuard or EnrollmentGuard. |

## Project Structure

### Documentation (this feature)

```text
specs/007-email-verification/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── endpoints.md     # API endpoint contracts
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── auth/
│   ├── auth.controller.ts       # Modified: 3 new endpoints + register/login changes
│   ├── auth.service.ts          # Modified: verification methods added
│   ├── auth.module.ts           # No changes needed (MailModule already imported)
│   ├── dto/
│   │   └── verify-email.dto.ts  # New: DTO for verify-email endpoint
│   ├── guards/
│   │   └── jwt-auth.guard.ts    # Existing (unchanged)
│   └── strategies/
│       └── jwt.strategy.ts      # Existing (unchanged)
├── common/
│   ├── guards/
│   │   └── email-verified.guard.ts  # New: EmailVerifiedGuard
│   └── decorators/
│       └── skip-email-verification.decorator.ts  # New: decorator to bypass guard
├── users/
│   └── users.controller.ts      # Modified: EmailVerifiedGuard on onboarding POST
├── mail/
│   └── mail.service.ts          # Modified: new sendVerificationEmail method
└── prisma/
    └── prisma.service.ts        # Existing (unchanged)

prisma/
└── schema.prisma                # Modified: emailVerified on User + EmailVerification model

test/
└── unit/
    └── auth/
        └── auth.service.spec.ts # Modified: new verification test cases
```

**Structure Decision**: All verification logic stays within the existing AuthModule. The new guard follows the established pattern in `src/common/guards/`. No new modules created.

## Complexity Tracking

> No constitution violations. No complexity justifications needed.
