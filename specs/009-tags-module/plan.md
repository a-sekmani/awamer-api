# Implementation Plan: Tags Module

**Branch**: `009-tags-module` | **Date**: 2026-04-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-tags-module/spec.md`

## Summary

Deliver the `ContentModule` at `src/content/` with a `TagsService`, a public `TagsController` (`GET /api/v1/tags`), an `AdminTagsController` (CRUD under `/api/v1/admin/tags`), DTOs, and a reusable `ReplaceTagAssociationsHelper` for future Path/Course edit flows. The Tag, PathTag, and CourseTag Prisma models already exist from KAN-70; this ticket is pure NestJS-layer work. Counts are computed live at query time. The helper runs inside `prisma.$transaction` and dedupes + validates input (all tag IDs must exist and be `ACTIVE`). Full unit + e2e test coverage against the existing `awamer_test` harness. No schema, migration, or existing-module edits.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS
**Primary Dependencies**: NestJS 11, Prisma 6.19, class-validator 0.15, class-transformer 0.5, @nestjs/throttler 6.5 (already in project)
**Storage**: PostgreSQL via Prisma (shared client at `src/prisma/prisma.service.ts`)
**Testing**: Jest 29 for unit tests (existing `src/**/*.spec.ts` config), Jest with `test/schema/jest.config.js` for e2e against `awamer_test`
**Target Platform**: Linux server (Node.js 20)
**Project Type**: NestJS monolith REST API (single project, `src/` tree)
**Performance Goals**: p95 < 200 ms for `GET /api/v1/tags` with a taxonomy of ≤500 tags. The `Cache-Control: public, max-age=60` header lets downstream HTTP caches absorb load. Admin endpoints have no strict SLO (internal-facing, low volume).
**Constraints**: Zero changes to `prisma/schema.prisma`, `prisma/migrations/**`, `src/auth`, `src/users`, `src/common` (tight scope from KAN-71). Counts must be live-computed — no stored aggregates. Helper must be atomic under `prisma.$transaction`.
**Scale/Scope**: Tag vocabulary is bounded (<500 tags realistically), so unpaginated list responses are acceptable for both public and admin endpoints. Each tag's counts fit in a single aggregate query.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| **I. Module Isolation** | ✅ Pass | New `ContentModule` is self-contained at `src/content/`. It imports `PrismaModule` only. No other module imports from it in this ticket (the helper is exported for future use). DTOs live inside `src/content/tags/dto/`; nothing is shared across modules. |
| **II. Security-First** | ✅ Pass | No sensitive fields in Tag/PathTag/CourseTag (tags are a public vocabulary). Public endpoint is intentionally unauthenticated (spec FR-001). Admin endpoints are guarded by `JwtAuthGuard` + a roles guard. If a real `RolesGuard`/`@Roles('admin')` decorator does not yet exist at implementation time, a dev-only `AdminOnlyGuard` logs a warning and every usage is marked `// TODO(auth): ...` (explicit conditional from ticket §7 and spec Assumptions). Helmet is already active globally. |
| **III. Standard Response Contract** | ✅ Pass | All responses flow through the existing global `ResponseTransformInterceptor` which wraps payloads into `{ data, message }`. URL paths are kebab-case (`/api/v1/tags`, `/api/v1/admin/tags`). Request/response bodies are camelCase (DTOs use `class-transformer`). No pagination is needed (taxonomy is small) so the paginated envelope does not apply here. Error responses use NestJS `HttpException` family and the existing `HttpExceptionFilter`. |
| **IV. Transactional Integrity** | ✅ Pass | The only multi-step write in this ticket is `ReplaceTagAssociationsHelper`, which executes its delete-then-insert inside `prisma.$transaction`. Create/update/delete on a single Tag row is a single Prisma call and needs no wrapping transaction. |
| **V. Data Validation & Type Safety** | ✅ Pass | Every DTO uses `class-validator` decorators (`@IsString`, `@Length`, `@Matches`, `@IsEnum`, `@IsOptional`). `ValidationPipe` is globally enabled. Tag IDs are UUIDs (Prisma default). `createdAt` is returned as ISO 8601 by default. TypeScript strict mode stays on — no `any`. |
| **VI. Access Control Hierarchy** | ✅ Pass (N/A) | `ContentAccessGuard` and `EnrollmentGuard` guard learning content, not taxonomy metadata. Tags are vocabulary metadata — neither guard applies. No deviation from the hierarchy. |

**Initial Gate**: ✅ PASS — no violations, no deviations, Complexity Tracking table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/009-tags-module/
├── plan.md              # This file
├── spec.md              # Feature specification (already written)
├── research.md          # Phase 0 output (this command)
├── data-model.md        # Phase 1 output (this command)
├── quickstart.md        # Phase 1 output (this command)
├── contracts/           # Phase 1 output (this command)
│   ├── tags-public.http
│   └── tags-admin.http
└── tasks.md             # Phase 2 output (/speckit.tasks, NOT this command)
```

### Source Code (repository root)

```text
src/
├── content/                          # NEW module — this ticket
│   ├── content.module.ts
│   └── tags/
│       ├── tags.service.ts
│       ├── tags.service.spec.ts
│       ├── tags.controller.ts
│       ├── admin-tags.controller.ts
│       ├── dto/
│       │   ├── create-tag.dto.ts
│       │   ├── update-tag.dto.ts
│       │   ├── tag-response.dto.ts
│       │   └── admin-tag-response.dto.ts
│       └── helpers/
│           ├── replace-tag-associations.helper.ts
│           └── replace-tag-associations.helper.spec.ts
├── app.module.ts                     # MODIFIED — register ContentModule
├── prisma/
│   └── prisma.service.ts             # UNCHANGED — imported via PrismaModule
└── auth/  users/  common/            # UNCHANGED — hard constraint from ticket

test/
├── content/                          # NEW — e2e tests live here to keep src/ clean
│   └── tags/
│       ├── tags.controller.e2e-spec.ts
│       ├── admin-tags.controller.e2e-spec.ts
│       └── replace-tag-associations.helper.e2e-spec.ts
├── content-e2e-jest.config.js        # NEW — jest config for content e2e suite
└── schema/                           # UNCHANGED — KAN-70 harness reused by new e2e
```

**Structure Decision**: The project is a single NestJS monolith with domain modules under `src/` — no frontend/backend split, no mobile client. Phase 1 follows that established pattern: one new `src/content/` module with a `tags/` subdirectory, unit tests colocated (`*.spec.ts`), and e2e tests under `test/content/tags/`. The e2e location mirrors the existing `test/schema/` convention from KAN-70 so that the existing `awamer_test` harness (Prisma client, `truncateAll`, `global-setup.ts`) can be reused without modification.

A small new jest config `test/content-e2e-jest.config.js` with its own `npm run test:content:e2e` script isolates the new e2e suite from the KAN-70 schema suite while sharing the same `test/schema/global-setup.ts` bootstrap. This is cheaper than shoehorning NestJS app bootstrap into `test/schema/jest.config.js` and keeps the schema suite a pure-Prisma suite.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally left empty.
