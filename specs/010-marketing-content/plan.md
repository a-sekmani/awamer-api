# Implementation Plan: Marketing Content Module (Features, FAQs, Testimonials)

**Branch**: `010-marketing-content` | **Date**: 2026-04-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-marketing-content/spec.md`
**Source ticket**: `docs/tickets/KAN-72.md` (KAN-72)

## Summary

Deliver the admin-facing marketing content layer (Features, FAQs, Testimonials) that Path and Course public detail pages will eventually render. All three entities are polymorphic (owner type = PATH | COURSE + owner id) and already exist in the Prisma schema (KAN-70). This feature builds the NestJS service, controller, DTO, helper, reorder, cascade-cleanup, and public-query layer on top of them, wired into the existing `ContentModule` introduced by KAN-71. Testimonials gain a three-state moderation workflow (PENDING / APPROVED / HIDDEN). No schema changes, no new external dependencies.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS
**Primary Dependencies**: NestJS 11, Prisma 6.19, class-validator 0.15, class-transformer 0.5, @nestjs/throttler 6.5, Passport JWT (all already in project)
**Storage**: PostgreSQL via Prisma (shared `PrismaService` at `src/prisma/prisma.service.ts`). Tables already exist: `Feature`, `Faq`, `Testimonial`, enums `MarketingOwnerType`, `TestimonialStatus`.
**Testing**: Jest + ts-jest. Unit tests colocated with services (`*.service.spec.ts`). E2E tests under `test/content/marketing/` using the existing `test-app.ts` bootstrap and `test/content-e2e-jest.config.js` (extended with the new subdirectory through the existing `test/content/**/*.e2e-spec.ts` regex).
**Target Platform**: Linux server (NestJS HTTP, port 3001). No other platforms.
**Project Type**: Single backend project (NestJS monolith). Uses the `single project` structure already established.
**Performance Goals**: Admin CRUD is low-traffic. Reorder must handle up to 50 items atomically in a single transaction (<200ms). No new hot paths on public endpoints (KAN-26 will own them).
**Constraints**: No modification to `prisma/schema.prisma`, `prisma/migrations/`, `src/auth`, `src/users`, `src/onboarding`, `src/common`, or `src/content/tags/`. All writes transactional. Arabic round-trip preserved. Admin-only; no public endpoints added.
**Scale/Scope**: 3 services, 3 admin controllers, 4 helpers, ~11 DTOs, 6 unit test suites, 5 e2e test suites. Net ~25 new files, no deletions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|-----------|
| **I. Module Isolation** | PASS. All new files live under `src/content/marketing/` as a submodule of the existing `ContentModule`. No new cross-module dependencies: only `PrismaModule` + `AuthModule` (reused from Tags). DTOs are owned by the marketing submodule (not shared with Tags). |
| **II. Security-First** | PASS. Every admin endpoint is protected by `JwtAuthGuard + RolesGuard + @Roles('admin')` — the exact pattern established by `src/content/tags/admin-tags.controller.ts`. No sensitive field exposure (no passwords, no Stripe data, no quiz answers). Helmet remains active globally. No new public endpoints. |
| **III. Standard Response Contract** | PASS. All endpoints return the standard `{ data, message }` envelope via the existing global interceptor. URLs are kebab-case under `/api/v1/admin/...`. Request/response bodies camelCase. No pagination added (marketing lists for one owner are small; the ticket explicitly returns full arrays). |
| **IV. Transactional Integrity** | PASS. Reorder runs inside `prisma.$transaction`. Cleanup (`deleteAllForPath` / `deleteAllForCourse`) runs inside `prisma.$transaction`. Single-row create/update/delete are atomic at the Prisma layer. |
| **V. Data Validation & Type Safety** | PASS. Every DTO uses class-validator decorators (`@IsString`, `@Length`, `@IsOptional`, `@IsUrl`, `@IsInt/@Min/@Max`, `@IsEnum`, `@IsArray/@ArrayMinSize`). Trim + whitespace-only rejection via `@Transform`. Global `ValidationPipe` already enabled. All PKs remain UUIDs (existing schema). Dates returned as ISO strings. No `any`. |
| **VI. Access Control Hierarchy** | N/A. Marketing content is admin metadata, not learning content. `ContentAccessGuard`/`EnrollmentGuard` do not apply; the public retrieval helpers are called by KAN-26, which will apply its own checks for the surrounding path/course. |

**Result**: All six gates pass. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/010-marketing-content/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output — admin endpoint contracts
│   ├── features.md
│   ├── faqs.md
│   └── testimonials.md
├── checklists/
│   └── requirements.md  # from /speckit.specify
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
src/content/marketing/
├── marketing.module.ts
├── features/
│   ├── features.service.ts
│   ├── features.service.spec.ts
│   ├── admin-features.controller.ts
│   └── dto/
│       ├── create-feature.dto.ts
│       ├── update-feature.dto.ts
│       ├── reorder-items.dto.ts          # shared shape but owned by features (no DTO sharing across submodules)
│       └── feature-response.dto.ts
├── faqs/
│   ├── faqs.service.ts
│   ├── faqs.service.spec.ts
│   ├── admin-faqs.controller.ts
│   └── dto/
│       ├── create-faq.dto.ts
│       ├── update-faq.dto.ts
│       ├── reorder-items.dto.ts
│       └── faq-response.dto.ts
├── testimonials/
│   ├── testimonials.service.ts
│   ├── testimonials.service.spec.ts
│   ├── admin-testimonials.controller.ts
│   └── dto/
│       ├── create-testimonial.dto.ts
│       ├── update-testimonial.dto.ts
│       ├── update-testimonial-status.dto.ts
│       ├── reorder-items.dto.ts
│       └── testimonial-response.dto.ts
└── helpers/
    ├── owner-validator.helper.ts
    ├── owner-validator.helper.spec.ts
    ├── reorder.helper.ts                  # generic atomic reorder over Prisma model delegate
    ├── reorder.helper.spec.ts
    ├── marketing-cleanup.helper.ts
    ├── marketing-cleanup.helper.spec.ts
    └── public-queries.helper.ts           # getFeaturesByOwner, getFaqsByOwner, getApprovedTestimonialsByOwner

src/content/content.module.ts              # MODIFIED: imports MarketingModule; re-exports its helpers

test/content/marketing/
├── admin-features.controller.e2e-spec.ts
├── admin-faqs.controller.e2e-spec.ts
├── admin-testimonials.controller.e2e-spec.ts
├── marketing-cleanup.helper.e2e-spec.ts
└── public-queries.helper.e2e-spec.ts
```

**Structure Decision**: Single-project NestJS layout. The marketing submodule is a child of the existing `ContentModule` (established by KAN-71 for Tags). `MarketingModule` groups the three services + helpers as providers and exports the four helpers (`OwnerValidator`, `ReorderHelper`, `MarketingCleanupHelper`, and the public-queries helper), which `ContentModule` then re-exports for future consumers (KAN-26 for public queries; the cleanup helper for future Path/Course admin delete endpoints). The existing `test/content-e2e-jest.config.js` regex `test/content/.*\.e2e-spec\.ts$` already picks up files under `test/content/marketing/` — no script changes needed; `npm run test:content:e2e` keeps working.

## Complexity Tracking

*No constitution violations. Table intentionally empty.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
