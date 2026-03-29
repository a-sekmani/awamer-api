# Implementation Plan: Auth Module Unit Tests

**Branch**: `004-auth-unit-tests` | **Date**: 2026-03-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-auth-unit-tests/spec.md`

## Summary

Write 30 unit tests (27 AuthService + 3 AuthController) using Jest with mocked dependencies (PrismaService, MailService, JwtService, ConfigService). Tests are co-located with source files as `*.spec.ts`. No database, no network — pure unit tests.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS)
**Primary Dependencies**: Jest 29, @nestjs/testing, ts-jest, bcryptjs, class-validator
**Storage**: N/A (mocked — no real database)
**Testing**: Jest 29 with ts-jest transform, NestJS Test.createTestingModule
**Target Platform**: Local dev / CI (Node.js runtime)
**Project Type**: Unit test suite for web service module
**Performance Goals**: Full suite < 10 seconds, each test < 500ms
**Constraints**: No real database, no network calls, all dependencies mocked, each test independent
**Scale/Scope**: 2 test files, 30 test cases, 7 describe blocks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Module Isolation | PASS | Tests are co-located within the auth module. No cross-module test dependencies. Mock boundaries respect module isolation. |
| II. Security-First | PASS | Tests explicitly verify that passwordHash, refreshToken, and reset tokens are never exposed in outputs (sanitizeUser test, FR-010). Tests verify bcrypt usage and generic error messages. |
| III. Standard Response Contract | N/A | Unit tests don't test HTTP response format directly — that's covered by the controller cookie tests and DTO validation. |
| IV. Transactional Integrity | PASS | Registration tests verify transactional behavior (FR-004 item 6: rollback on failure). Mocked $transaction validates atomic create semantics. |
| V. Data Validation & Type Safety | PASS | DTO validation tests (FR-011) verify class-validator decorators reject invalid input. All test data uses proper types. |
| VI. Access Control Hierarchy | N/A | Auth module handles authentication, not content access. Tests verify JwtAuthGuard behavior on logout. |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-auth-unit-tests/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/auth/
├── auth.service.ts           # Existing — system under test
├── auth.service.spec.ts      # New — 27 test cases
├── auth.controller.ts        # Existing — system under test
├── auth.controller.spec.ts   # New — 3 test cases
├── dto/                      # Existing — used in DTO validation tests
│   ├── register.dto.ts
│   ├── login.dto.ts
│   ├── forgot-password.dto.ts
│   └── reset-password.dto.ts
├── guards/
│   └── jwt-auth.guard.ts     # Existing — mocked in controller tests
├── interfaces/
│   └── jwt-payload.interface.ts
└── strategies/
    └── jwt.strategy.ts       # Existing — not tested (Passport handles this)
```

**Structure Decision**: Test files are co-located next to their source files per NestJS convention (`*.spec.ts` alongside `*.ts`). No separate `tests/` directory needed.

## Complexity Tracking

> No constitution violations — table intentionally left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
