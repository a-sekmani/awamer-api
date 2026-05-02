# Implementation Plan: BE Categories admin CRUD (KAN-82)

**Branch**: `015-categories-admin-crud` | **Date**: 2026-05-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-categories-admin-crud/spec.md`

## Summary

KAN-82 is the first per-entity admin module to sit on top of the KAN-78 admin foundation. It delivers full CRUD over the `Category` entity, ships a single Prisma migration that drops two unused columns (`description`, `icon`) and tightens two foreign keys (`Path.category`, `Course.path`) from `Cascade` to `Restrict`, fixes a generic gap in `HttpExceptionFilter` so that object-shaped `errors` payloads are passed through, and wires Redis cache invalidation for the public categories endpoint into every successful admin mutation.

Approach is deliberately conservative: the public KAN-26 endpoint contract changes only by losing the two dropped fields; the admin foundation (`@AdminEndpoint()` decorator + `RolesGuard` + `AuditLogInterceptor`) is consumed unchanged; the response envelope (`{ data, message }`) and error shape (`{ statusCode, errorCode, message, errors? }`) come from the existing global pieces. The novel code surface is the new `CategoriesAdminModule` (controller + service + four DTOs), the migration SQL, four new error codes, and a small extension to one global filter that benefits the next five admin tickets too.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS
**Primary Dependencies**: NestJS 11, Prisma 6.19 (`@prisma/client`), ioredis (via the existing `CacheService`), `class-validator` 0.15, `class-transformer` 0.5, `reflect-metadata`, RxJS 7. **No new dependencies — all required libraries are already installed** (KAN-78 + KAN-26 left them in place).
**Storage**: PostgreSQL via Prisma. Redis (existing, used only for invalidating the `categories:all` key).
**Testing**: Jest 29 + ts-jest for unit (`npm test`); Jest + Supertest 7 for e2e (`npm run test:e2e`, config at `test/jest-e2e.json`).
**Target Platform**: Linux server (the Awamer API process), reachable from the Next.js frontend.
**Project Type**: Backend web service (NestJS REST API).
**Performance Goals**: Admin traffic is human-paced; no formal p95 target. The list endpoint MUST compute `pathCount` and `courseCount` via Prisma `_count` — one DB round-trip, no N+1.
**Constraints**:
- Public `GET /categories` (KAN-26) e2e tests MUST continue to pass after the migration applies, with no test-body edits beyond removing assertions on the two dropped fields.
- Single PR contains both the code change and the Prisma migration (no expand-contract); KAN-68 is still in `To Do` so production deploy ordering is not yet a concern.
- Do NOT touch the KAN-78 foundation files (`src/admin/common/**`, `src/admin/interceptors/audit-log.interceptor.ts`).
- Do NOT touch the four KAN-101 candidate test files (listed in `spec.md` § "Files this ticket must NOT touch") — adding `@unique` on `Category.name` is explicitly deferred.
- TypeScript strict mode stays clean; `npm run lint` shows the 16 pre-existing errors and zero new ones.

**Scale/Scope**: Roughly 9 new files in `src/admin/categories/**`, 1 new migration directory, 1 new admin docs file, 1 new e2e spec, plus surgical edits to ~7 existing files. Categories cardinality in production is small (estimated 5–50); admin user count is single-digit.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Module Isolation** | ✅ Pass | `CategoriesAdminModule` is self-contained in `src/admin/categories/` with its own controller, service, and four owned DTOs. It does not share DTOs with the public `CategoriesModule` — the latter keeps its own `CategoryResponseDto` (modified only to drop `description` + `icon`). One soft tension on `HttpExceptionFilter` extension is recorded in Complexity Tracking below. |
| **II. Security-First** | ✅ Pass | `@AdminEndpoint()` at the class level applies `JwtAuthGuard` + `RolesGuard` + `AuditLogInterceptor` + `@Roles(Role.ADMIN)`. No sensitive fields in responses. Helmet stays active globally. The audit interceptor emits a structured log on every successful POST/PATCH/DELETE; failed mutations don't emit (existing behavior of the interceptor). |
| **III. Standard Response Contract** | ✅ Pass | Reuses the existing global `ResponseTransformInterceptor` (`{ data, message: 'Success' }`) and `HttpExceptionFilter` (`{ statusCode, errorCode, message, errors? }`). The filter extension only adds an additional pass-through path for object-shaped `errors` (matching the established passthrough idiom for `parentPathId`/`upgradeUrl`/`reason`). All routes use `/api/v1/admin/categories` (kebab-case path), camelCase request/response bodies, snake_case query params (`page`, `limit`, `search`, `status` — all already snake-/lower-case). |
| **IV. Transactional Integrity** | ✅ N/A | Every mutation in this feature touches a single row in a single table (`categories`). DELETE relies on the FK constraint as the integrity guarantee; the count read after a Restrict failure is two parallel `count()` queries, no write. PATCH is a single Prisma `update` per request. CREATE is a single `create`. No multi-step write. |
| **V. Data Validation & Type Safety** | ✅ Pass | All four DTOs use `class-validator` decorators (`@IsString`, `@MaxLength(200)`, `@Matches(slugRegex)`, `@IsEnum(CategoryStatus)`, `@IsInt`, `@Min(0)`, `@IsOptional`, `@Transform(trim)`). Global `ValidationPipe` is the enforcement point. UUIDs are required for `:id`. Dates remain `DateTime` in Prisma, surfaced as ISO strings. No `any`. |
| **VI. Access Control Hierarchy** | ✅ N/A | Constitutional hierarchy (path/course/lesson `is_free` → subscription) governs LEARNER content access via `ContentAccessGuard`. KAN-82 is the parallel ADMIN access path, intentionally independent. Admin endpoints are gated by role only. |

**Result**: All gates pass. One soft tension on cross-cutting filter scope, justified in Complexity Tracking.

**Post-design re-check (after Phase 1 artifacts produced — research.md, data-model.md, contracts/, quickstart.md)**: Gates still pass. Phase 1 confirms: the migration is reversible, the OpenAPI contract uses kebab-case URL with the documented request/response envelopes, the FK-violation contract catches both Prisma error classes (no behavioral drift), the filter passthrough contract preserves the array path verbatim. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/015-categories-admin-crud/
├── plan.md                              # This file (/speckit.plan command output)
├── spec.md                              # Feature specification (with Clarifications)
├── checklists/
│   └── requirements.md                  # Spec quality checklist
├── research.md                          # Phase 0 output (this command)
├── data-model.md                        # Phase 1 output (this command)
├── quickstart.md                        # Phase 1 output (this command)
├── contracts/                           # Phase 1 output (this command)
│   ├── categories-admin.openapi.yaml         # 5 admin endpoints
│   ├── migration.contract.md                 # SQL migration contract
│   ├── delete-fk-violation.contract.md       # Dual-error-class DELETE behavior
│   └── http-exception-filter-passthrough.contract.md  # Filter object-shape errors
└── tasks.md                             # Phase 2 output (NOT created here — produced by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── admin/
│   ├── admin.module.ts                  # MODIFY — add CategoriesAdminModule to imports
│   ├── categories/                      # NEW — entire subdirectory
│   │   ├── categories-admin.module.ts
│   │   ├── categories-admin.controller.ts
│   │   ├── categories-admin.service.ts
│   │   ├── categories-admin.service.spec.ts
│   │   └── dto/
│   │       ├── create-category.dto.ts
│   │       ├── update-category.dto.ts
│   │       ├── list-categories-query.dto.ts
│   │       └── category-admin-response.dto.ts
│   ├── common/                          # KEEP AS-IS — KAN-78 foundation, fixed (decorator, guard wiring)
│   ├── controllers/                     # KEEP AS-IS — admin-health.controller.ts unchanged
│   └── interceptors/                    # KEEP AS-IS — audit-log.interceptor.ts unchanged (KAN-100 will fix the JSDoc)
├── common/
│   ├── error-codes.enum.ts              # MODIFY — add CATEGORY_NOT_FOUND, CATEGORY_NAME_EXISTS, CATEGORY_SLUG_EXISTS, CATEGORY_IN_USE
│   └── filters/
│       ├── http-exception.filter.ts     # MODIFY — pass through object-shaped `errors`
│       └── http-exception.filter.spec.ts # MODIFY — 4–5 new unit tests
└── content/
    └── categories/
        ├── categories.service.ts        # MODIFY — drop description/icon from mapper; update TODO comment to KAN-82
        ├── categories.service.spec.ts   # MODIFY — update assertions
        └── dto/
            └── category-response.dto.ts # MODIFY — drop description/icon fields

prisma/
├── schema.prisma                        # MODIFY — remove description, icon from Category; change Path.category & Course.path to onDelete: Restrict
├── migrations/
│   └── <timestamp>_drop_category_columns_and_restrict_content_fks/
│       └── migration.sql                # NEW
└── seed.ts                              # MODIFY — remove description, icon from category seed records (line ~140 area)

test/
└── admin/
    └── categories.e2e-spec.ts           # NEW — covers all seven user stories end-to-end

docs/
└── admin/
    └── categories.md                    # NEW — admin endpoint reference, mirroring the per-endpoint style established by KAN-78
```

**Structure Decision**: Single-project NestJS backend. The new module lives under `src/admin/categories/` per the canonical pattern documented in `specs/014-admin-foundation/quickstart.md`. The migration is one directory under `prisma/migrations/`. Filter and error-codes edits are surgical — no directory restructuring outside `src/admin/categories/`.

## Complexity Tracking

| Tension | Why accepted | Simpler alternative rejected because |
|---|---|---|
| `HttpExceptionFilter` extension is global infrastructure (lives in `src/common/filters/`), not per-module. Module Isolation principle pulls toward keeping cross-cutting changes near the consumer. | The filter is genuinely cross-cutting: every per-entity admin module that follows (KAN-85, KAN-88, KAN-91, KAN-94, KAN-97) needs to return object-shaped `errors` payloads (counts, ids, reasons) for in-use / conflict responses. Doing the fix once in the global filter is strictly cheaper than five copies — and matches the established passthrough idiom (`PASSTHROUGH_KEYS` already exists for the same kind of cross-cutting concern). The extension preserves the existing array-error path verbatim (regression test proves it), so legacy behavior is untouched. | Adding a per-module wrapper that re-shapes `errors` before throwing would push the same logic into five future modules and create five subtly-different shapes of "in use" responses. Adding a module-scoped exception filter just for admin would create two global filters with overlapping responsibilities, and downstream admin tickets would each have to remember to register it — the exact failure mode `@AdminEndpoint()` was designed to eliminate. |
