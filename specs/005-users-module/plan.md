# Implementation Plan: Complete Users Module

**Branch**: `005-users-module` | **Date**: 2026-03-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-users-module/spec.md`

## Summary

Implement 6 authenticated endpoints in the existing UsersModule: get me (with profile, role, subscription), update user, update profile, change password, submit onboarding (with analytics event), and get onboarding status. All endpoints require JwtAuthGuard, use class-validator DTOs, and follow the standard `{ data, message }` response format.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS)
**Primary Dependencies**: NestJS 10, Prisma 6.19, bcryptjs, class-validator, class-transformer, @nestjs/throttler
**Storage**: PostgreSQL 15+ via Prisma ORM
**Testing**: Jest 29 (existing test infrastructure)
**Target Platform**: Linux/macOS server (Node.js runtime)
**Project Type**: Web service (REST API backend)
**Performance Goals**: Get-me < 2s, updates reflected immediately
**Constraints**: All endpoints authenticated (JwtAuthGuard). Locale restricted to "ar" | "en". Password: bcrypt 12 rounds. Standard response wrapper.
**Scale/Scope**: 6 endpoints, 5 DTOs, 1 service, 1 controller, 1 analytics stub

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Module Isolation | PASS | Users module is self-contained with its own controller, service, and DTOs. Imports PrismaModule (global) and AnalyticsModule. No shared DTOs. |
| II. Security-First | PASS | All endpoints require JwtAuthGuard. Password hash never exposed (FR-017). Password verified with bcrypt before change. Refresh token invalidated on password change. |
| III. Standard Response Contract | PASS | All responses follow `{ data, message }` wrapper. Validation errors follow `{ statusCode, message, errors }`. Password error uses specific 400 message. |
| IV. Transactional Integrity | PASS | Onboarding submission creates OnboardingResponse records + updates UserProfile atomically in a Prisma transaction. |
| V. Data Validation & Type Safety | PASS | 5 DTOs with class-validator decorators. Locale/preferredLanguage restricted to enum values. Password strength enforced. Field length limits defined. |
| VI. Access Control Hierarchy | N/A | Users module handles profile CRUD, not content access. All endpoints are user-scoped (operate on the authenticated user only). |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/005-users-module/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── users/
│   ├── users.module.ts           # Update: import AnalyticsModule, PrismaModule deps
│   ├── users.controller.ts       # Rewrite: 6 endpoints
│   ├── users.service.ts          # Rewrite: full implementation
│   └── dto/
│       ├── update-user.dto.ts    # New
│       ├── update-profile.dto.ts # New
│       ├── change-password.dto.ts# New
│       ├── onboarding.dto.ts     # New
│       └── index.ts              # New barrel export
├── analytics/
│   ├── analytics.module.ts       # Existing (no changes)
│   └── analytics.service.ts      # Update: add capture method stub
```

**Structure Decision**: All user code stays within `src/users/`. DTOs in `src/users/dto/`. AnalyticsService gets a `capture()` stub for the onboarding event.

## Complexity Tracking

> No constitution violations — table intentionally left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
