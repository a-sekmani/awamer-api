# Implementation Plan: Onboarding Validation Enforcement

**Branch**: `008-onboarding-validation` | **Date**: 2026-04-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-onboarding-validation/spec.md`
**Reference**: `docs/onboarding/onboarding.md`

## Summary

Add strict validation to the existing onboarding submission endpoint so that question keys, answer values, step numbers, and interest selection limits are enforced against the Figma-approved design contract. Prevent duplicate submissions with an `ONBOARDING_ALREADY_COMPLETED` error code. All changes are scoped to DTO, service, error codes, and tests — no schema migration, no controller changes, no new modules.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS)
**Primary Dependencies**: NestJS 10, Prisma 6.19, class-validator, class-transformer
**Storage**: PostgreSQL via Prisma ORM (existing schema — no migration)
**Testing**: Jest 29 with @nestjs/testing, ts-jest, bcryptjs mock
**Target Platform**: Linux server (API backend)
**Project Type**: Web service (REST API)
**Performance Goals**: Onboarding submission completes within 2 seconds
**Constraints**: All validation must happen server-side; frontend sends interests as JSON string
**Scale/Scope**: Modifying 4 existing files + updating 2 test files; ~6 files total

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Module Isolation | PASS | All changes within UsersModule (DTO + service). No cross-module imports added. |
| II. Security-First | PASS | Endpoint remains behind JwtAuthGuard + EmailVerifiedGuard. No sensitive fields exposed. |
| III. Standard Response Contract | PASS | Response format unchanged: `{ data: { profile }, message: 'Success' }`. Error format follows existing pattern with `errorCode`. |
| IV. Transactional Integrity | PASS | `submitOnboarding()` uses `prisma.$transaction()` for delete + create + update atomically. |
| V. Data Validation & Type Safety | PASS | DTO uses class-validator decorators (`@IsIn`, `@ArrayMinSize`, `@ArrayMaxSize`, `@Max`). Service adds business logic validation for JSON parsing, value checking, and duplicate detection. |
| VI. Access Control Hierarchy | N/A | Onboarding is not content-access gated; uses JwtAuthGuard + EmailVerifiedGuard. |

**Gate result**: PASS — no violations, no complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/008-onboarding-validation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (files to modify)

```text
src/
├── common/
│   └── error-codes.enum.ts          # Add ONBOARDING_ALREADY_COMPLETED
├── users/
│   ├── dto/
│   │   ├── onboarding.dto.ts        # Replace: add constants + strict validation
│   │   └── index.ts                 # Verify exports include new constants
│   ├── users.service.ts             # Modify: replace submitOnboarding() with validation
│   ├── users.service.spec.ts        # Add ~27 new tests
│   └── dto/
│       └── users.dto.spec.ts        # Add ~17 new DTO tests
```

**Structure Decision**: No new files or modules created. All changes modify existing files within the UsersModule boundary, consistent with Module Isolation principle.

## Complexity Tracking

No violations — table not needed.
