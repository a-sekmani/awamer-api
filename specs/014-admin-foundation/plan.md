# Implementation Plan: Admin Module Foundation — Backend (KAN-78)

**Branch**: `014-admin-foundation` | **Date**: 2026-05-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-admin-foundation/spec.md`

## Summary

Replace the no-op stubs already present in `src/admin/` and `src/common/guards/roles.guard.ts` with a real admin foundation layer that every future per-entity admin sub-module (KAN-82+) will sit on top of. The foundation contributes: (a) a working `RolesGuard` (default-deny inside admin scope), (b) module-scoped registration of that guard plus a new audit interceptor inside `AdminModule`, (c) a reusable `ReorderItemsDto` primitive for bulk reorder endpoints, (d) admin-relevant additions to the existing `ErrorCode` enum, (e) a test admin route `/admin/__ping` exercising the entire stack end-to-end, and (f) `docs/admin-foundation.md` documenting the contract.

The success envelope `{ data, message }` and the error shape `{ statusCode, errorCode, message, errors? }` are NOT re-implemented — the existing globally-registered `ResponseTransformInterceptor` and `HttpExceptionFilter` already produce them and are documented as the canonical admin contract (per Clarifications Q2).

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS
**Primary Dependencies**: NestJS 11, `@nestjs/passport` + `passport-jwt` (existing JWT auth), `class-validator` 0.15, `class-transformer` 0.5, `reflect-metadata`, RxJS 7. No new dependencies — all required libraries are already installed.
**Storage**: N/A for this feature. (Audit log persistence is explicitly out of scope; entries go to the application logger only.)
**Testing**: Jest 29 + ts-jest for unit tests (existing `npm test`); Jest + Supertest 7 for e2e (existing `npm run test:e2e` config at `test/jest-e2e.json`).
**Target Platform**: Linux server (the Awamer API process), reachable via Next.js frontend.
**Project Type**: Backend web service (NestJS REST API).
**Performance Goals**: No new performance targets. The guard and audit interceptor MUST add <1ms typical overhead per admin request (in-memory metadata read + log emission).
**Constraints**: Do NOT install new dependencies. Do NOT modify the existing auth module, Prisma schema, public endpoints, the global `ResponseTransformInterceptor`, or the global `HttpExceptionFilter`. Existing global API prefix `/api/v1` set in `main.ts` MUST be preserved (so the test route is reachable as `/api/v1/admin/__ping`).
**Scale/Scope**: ~6–8 new files in `src/admin/**`, replacement of 1 stub (`src/common/guards/roles.guard.ts`), enum extension in `src/common/error-codes.enum.ts`, 1 new docs file, README hyperlink update. Roughly 4 unit test specs and 1 e2e spec (`test/admin.e2e-spec.ts`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Module Isolation** | ✅ Pass | The feature lives in `src/admin/` and contributes the central `AdminModule`. Per Clarifications Q4, future per-entity sub-modules import into `AdminModule.imports` only, preserving isolation. The shared `ReorderItemsDto` primitive at `src/admin/common/dto/reorder-items.dto.ts` is a cross-cutting validation primitive (analogous to the existing `src/common/error-codes.enum.ts`), not a domain DTO — see Complexity Tracking note below. |
| **II. Security-First** | ✅ Pass | This feature IS the security primitive for admin endpoints: `@Roles('admin')` + `RolesGuard` plus default-deny scope. The existing `JwtAuthGuard` is reused (constitution requires it on all non-public endpoints). No sensitive fields are exposed. |
| **III. Standard Response Contract** | ✅ Pass | Per Clarifications Q2, the existing global `ResponseTransformInterceptor` (`{ data, message }`) and `HttpExceptionFilter` (`{ statusCode, errorCode, message, errors? }`) are reused as the admin contract. Both already match the constitutional shape. No path/casing changes; admin routes use kebab-case under `/api/v1/admin/...`. |
| **IV. Transactional Integrity** | ✅ N/A | This feature performs no DB writes. (Audit log persistence is explicitly out of scope.) |
| **V. Data Validation & Type Safety** | ✅ Pass | `ReorderItemsDto` uses `class-validator` decorators (`@IsArray`, `@ArrayMinSize(1)`, `@ValidateNested({ each: true })`, `@IsUUID('4')`, `@IsInt`, `@Min(0)`, plus a custom `@NoDuplicateIds` constraint). Existing `ValidationPipe` (global) handles enforcement. UUIDs are required; no `any`. |
| **VI. Access Control Hierarchy** | ✅ N/A | The constitutional hierarchy (path/course/lesson is_free → subscription) governs LEARNER content access via `ContentAccessGuard`. This feature is the parallel ADMIN access path, which is independent of that hierarchy and intentionally so. |

**Result**: All gates pass. One soft-tension noted in Complexity Tracking (shared primitive `ReorderItemsDto` under `src/admin/common/dto/` — justified).

**Post-design re-check (after Phase 1 artifacts produced — research.md, data-model.md, contracts/, quickstart.md)**: All gates still pass. No new violations introduced. The contracts in `contracts/` confirm: `/admin/__ping` mounts under `/api/v1/admin/__ping` (kebab-case path, snake_case query params N/A, camelCase body), errors carry `errorCode` from the existing enum, and the audit log entry contains no sensitive request body content. Module Isolation tension on `ReorderItemsDto` is unchanged from initial check — the documented justification in Complexity Tracking still applies.

## Project Structure

### Documentation (this feature)

```text
specs/014-admin-foundation/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature specification
├── checklists/
│   └── requirements.md  # Spec quality checklist (already created)
├── research.md          # Phase 0 output (this command)
├── data-model.md        # Phase 1 output (this command)
├── quickstart.md        # Phase 1 output — sub-module registration walkthrough
├── contracts/
│   ├── admin-ping.openapi.yaml   # OpenAPI for /admin/__ping
│   ├── audit-log.contract.md     # Structured-log fields contract
│   ├── reorder-items.contract.md # ReorderItemsDto validation contract
│   └── roles-decorator.contract.md # @Roles + RolesGuard semantic contract
└── tasks.md             # Phase 2 output (NOT created here — produced by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── admin/                                    # ← FEATURE TARGET TREE
│   ├── admin.module.ts                       # MODIFY — register APP_GUARD/APP_INTERCEPTOR providers, add health controller
│   ├── admin.controller.ts                   # DELETE — placeholder GET /admin (returns {}) is replaced by health controller below
│   ├── admin.service.ts                      # DELETE — empty placeholder service no longer needed
│   ├── common/
│   │   └── dto/
│   │       └── reorder-items.dto.ts          # NEW — shared bulk reorder DTO
│   ├── controllers/
│   │   └── admin-health.controller.ts        # NEW — GET /admin/__ping (test route)
│   └── interceptors/
│       └── audit-log.interceptor.ts          # NEW — APP_INTERCEPTOR scoped to AdminModule
├── common/
│   ├── decorators/
│   │   └── roles.decorator.ts                # KEEP AS-IS — @Roles(...roles) already exists, varargs, sets ROLES_KEY metadata
│   ├── guards/
│   │   └── roles.guard.ts                    # MODIFY — replace stub (always returns true) with real implementation per FR-004 + FR-005a
│   ├── error-codes.enum.ts                   # MODIFY — add FORBIDDEN, INSUFFICIENT_ROLE codes
│   ├── filters/
│   │   └── http-exception.filter.ts          # KEEP AS-IS — already produces admin error shape
│   └── interceptors/
│       └── response-transform.interceptor.ts # KEEP AS-IS — already produces admin success envelope
├── auth/
│   └── ...                                   # KEEP AS-IS — no changes
└── app.module.ts                             # KEEP AS-IS — AdminModule already imported

test/
├── admin.e2e-spec.ts                         # NEW — 401/403/200 paths against /admin/__ping
└── jest-e2e.json                             # KEEP AS-IS

docs/
└── admin-foundation.md                       # NEW — sub-module pattern, response shapes, audit fields
```

**Structure Decision**: Single-project NestJS backend. The feature is contained to `src/admin/**`, surgical edits to `src/common/guards/roles.guard.ts` and `src/common/error-codes.enum.ts`, plus one new e2e spec and one new docs file. No directory restructuring outside `src/admin/`. Existing `src/admin/admin.controller.ts` and `src/admin/admin.service.ts` (empty placeholders) are deleted in favor of the new `controllers/admin-health.controller.ts` — leaving the placeholder live alongside the new controller would create a contradictory `GET /admin` returning `{}` that bypasses the documented pattern.

## Complexity Tracking

| Tension | Why accepted | Simpler alternative rejected because |
|---|---|---|
| Shared admin primitive `ReorderItemsDto` lives at `src/admin/common/dto/` and is intended for re-use across future per-entity admin sub-modules. Constitutional Principle I says "Modules MUST NOT share DTOs; each module owns its request/response shapes." | The DTO is a structurally identical validation primitive (`Array<{ id: UUID, sortOrder: non-negative int }>`), not a domain DTO. Each entity-specific admin module still owns its own create/update DTOs (e.g., `CreateCategoryDto`). This mirrors the existing project pattern of sharing cross-cutting primitives from `src/common/` (e.g., `error-codes.enum.ts`, `decorators/`, `guards/`). Per Clarifications Q5, `src/admin/common/` is the agreed location to keep admin primitives discoverable and prevent public modules from importing them by mistake. | Re-implementing the same DTO in 6+ admin sub-modules (Sections, Lessons, Content Blocks, possibly Paths and Courses) would be pure duplication, would drift over time, and would tempt future devs to copy-paste from a single source-of-truth that does not exist. |
