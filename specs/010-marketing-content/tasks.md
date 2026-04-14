# Tasks: Marketing Content Module (Features, FAQs, Testimonials)

**Feature**: 010-marketing-content · **Branch**: `010-marketing-content`
**Inputs**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
**Tests**: Explicitly requested by ticket §13 — unit specs + e2e specs are part of DoD.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (touches different files, no unfinished dependency)
- **[Story]**: `[US1]` Features · `[US2]` FAQs · `[US3]` Testimonials · `[US4]` Public queries · `[US5]` Cascade cleanup
- Every task gives an exact file path under the repo root `/Users/ahmadsekmani/Desktop/Projects/awamer-api/`.

## Path Conventions (this feature)

- Source: `src/content/marketing/...`
- Module entry: `src/content/marketing/marketing.module.ts`
- E2E tests: `test/content/marketing/...`
- Unit specs: colocated `*.service.spec.ts` / `*.helper.spec.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the empty marketing submodule directory skeleton and confirm baseline builds.

- [X] T001 Verify baseline is green: run `npm run build`, `npx prisma validate`, `npm run test:schema`, `npm run test:content:e2e`, `npm test`. Abort and investigate if any fails (prerequisite to all later work).
- [X] T002 Create empty directory skeleton: `src/content/marketing/{features,faqs,testimonials,helpers}` plus `src/content/marketing/{features,faqs,testimonials}/dto` and `test/content/marketing/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Helpers and the MarketingModule shell that every user story depends on. Nothing in Phase 3+ can start until this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until Phase 2 is complete.

- [X] T003 [P] Implement `OwnerValidator` with `ensurePathExists`, `ensureCourseExists`, `ensureOwnerExists(ownerType, ownerId)` at `src/content/marketing/helpers/owner-validator.helper.ts`. Throws `NotFoundException("Path 'xyz' does not exist")` / `"Course 'xyz' does not exist"`. Uses injected `PrismaService`. Defensive default in `ensureOwnerExists` also throws `NotFoundException`.
- [X] T004 [P] Implement generic `ReorderHelper` at `src/content/marketing/helpers/reorder.helper.ts`. Exposes a single method `reorder<T>(delegate, ownerType, ownerId, itemIds): Promise<T[]>` that (a) fetches current ids for the owner, (b) validates set equality (rejects duplicates / missing / foreign with `BadRequestException` + precise message), (c) runs updates inside `prisma.$transaction`, (d) returns the freshly-sorted list. Receives `PrismaService` via DI.
- [X] T005 [P] Implement `MarketingCleanupHelper` at `src/content/marketing/helpers/marketing-cleanup.helper.ts` with `deleteAllForPath(pathId)` and `deleteAllForCourse(courseId)`. Each wraps `feature.deleteMany`, `faq.deleteMany`, `testimonial.deleteMany` in a single `prisma.$transaction`. Idempotent.
- [X] T006 [P] Implement `PublicMarketingQueries` at `src/content/marketing/helpers/public-queries.helper.ts` as an `@Injectable()` provider exposing `getFeaturesByOwner`, `getFaqsByOwner`, `getApprovedTestimonialsByOwner`. Sort: `order` ASC, tie-breaker `id` ASC for Feature/Faq, `createdAt` ASC for Testimonial. `getApprovedTestimonialsByOwner` filters `where: { status: 'APPROVED' }`. Does NOT validate owner existence.
- [X] T007 [P] Unit test `OwnerValidator` at `src/content/marketing/helpers/owner-validator.helper.spec.ts` — covers PATH hit, COURSE hit, both miss → 404, unknown ownerType → 404. Mocks `PrismaService`.
- [X] T008 [P] Unit test `ReorderHelper` at `src/content/marketing/helpers/reorder.helper.spec.ts` — happy path reassigns order by index, rejects duplicates, rejects missing ids, rejects foreign ids, runs inside `$transaction` (mock-verifiable).
- [X] T009 [P] Unit test `MarketingCleanupHelper` at `src/content/marketing/helpers/marketing-cleanup.helper.spec.ts` — deletes for path, deletes for course, no-op on empty, runs inside `$transaction`.
- [X] T010 Create `MarketingModule` at `src/content/marketing/marketing.module.ts`. Imports: `AuthModule` (mirrors Tags). Providers: `OwnerValidator`, `ReorderHelper`, `MarketingCleanupHelper`, `PublicMarketingQueries` (plus the three services once they exist — add placeholder imports as stories land). Exports: the four helpers + `PublicMarketingQueries`. Controllers array populated by later phases.
- [X] T011 Modify `src/content/content.module.ts` — add `imports: [..., MarketingModule]`, re-export the four marketing helpers via `exports: [...existing, OwnerValidator, ReorderHelper, MarketingCleanupHelper, PublicMarketingQueries]`. Confirm `AppModule` still registers `ContentModule`.

**Checkpoint**: Helpers + module shell compile and unit-test. User stories may now proceed in parallel.

---

## Phase 3: User Story 1 — Manage Features (Priority: P1) 🎯 MVP

**Goal**: Admin can create/list/update/delete/reorder features for any path or course.
**Independent Test**: Seed a path, POST three features, PATCH one, reorder, DELETE one, GET — result reflects intended order and content. Arabic text round-trips. Unauthenticated = 401.

- [X] T012 [P] [US1] `CreateFeatureDto` at `src/content/marketing/features/dto/create-feature.dto.ts` — `@IsString` `@Length(1,150)` trimmed title; `@IsString` `@Length(1,500)` trimmed description; `@IsString` non-empty icon; `@IsOptional @IsInt @Min(0)` order. Use `@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)` on strings and reject whitespace-only via `Matches(/\S/)` or a custom validator aligned with Tags.
- [X] T013 [P] [US1] `UpdateFeatureDto` at `src/content/marketing/features/dto/update-feature.dto.ts` — all fields optional; at-least-one enforced via a class-level custom validator (mirror the Tags pattern).
- [X] T014 [P] [US1] `ReorderItemsDto` at `src/content/marketing/features/dto/reorder-items.dto.ts` — `@IsArray @ArrayMinSize(1) @IsString({ each: true }) @IsUUID('4', { each: true })` `itemIds`.
- [X] T015 [P] [US1] `FeatureResponseDto` at `src/content/marketing/features/dto/feature-response.dto.ts` — plain class with typed fields (id, ownerType, ownerId, icon, title, description, order). Static `fromEntity(feature)` mapper.
- [X] T016 [US1] `FeaturesService` at `src/content/marketing/features/features.service.ts` — methods `listByOwner`, `create`, `update`, `delete`, `reorder`. `create` calls `OwnerValidator.ensureOwnerExists` then appends on missing order (`max.order + 1` or `0`). Sort everywhere by `order ASC, id ASC`. Inline comment at the sort site: "Feature has no createdAt; tie-breaker is id ASC (ticket KAN-72 §3 gap, schema frozen by KAN-70)". Add `// TODO(KAN-74): invalidate cache path:detail:${ownerId}/course:detail:${ownerId}` at every mutation site.
- [X] T017 [US1] `AdminFeaturesController` at `src/content/marketing/features/admin-features.controller.ts` — class-level `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin')`. Routes: `GET /admin/paths/:ownerId/features`, `GET /admin/courses/:ownerId/features`, `POST` (×2), `PATCH /admin/features/:id`, `PATCH /admin/paths/:ownerId/features/reorder` (×2), `DELETE /admin/features/:id`. Thin wrapper around service. Mirror `src/content/tags/admin-tags.controller.ts` style exactly.
- [X] T018 [US1] Register `FeaturesService` + `AdminFeaturesController` in `src/content/marketing/marketing.module.ts` (providers + controllers arrays).
- [X] T019 [US1] Unit tests at `src/content/marketing/features/features.service.spec.ts` — list sorted, create with explicit order, create without order (append), update, delete, 404 on missing feature, 404 on missing owner, reorder happy path, reorder rejects mismatch. Mocks `PrismaService`, `OwnerValidator`, `ReorderHelper`.
- [X] T020 [US1] E2E tests at `test/content/marketing/admin-features.controller.e2e-spec.ts` — CRUD cycle for path, CRUD cycle for course, reorder, reorder 400 on bad input, 404 missing owner, 404 missing feature, 401 unauthenticated, Arabic round-trip. Reuse `test/content/tags/test-app.ts` bootstrap (import the helper — do NOT duplicate it) and the truncation helpers from `test/schema/setup.ts`. Truncate feature/faq/testimonial/path/course tables in `beforeEach`.

**Checkpoint**: Features module is a complete MVP slice. `npm run test:content:e2e` is green for the features file.

---

## Phase 4: User Story 2 — Manage FAQs (Priority: P1)

**Goal**: Admin can create/list/update/delete/reorder FAQs for any path or course.
**Independent Test**: Seed a course, POST FAQs, edit, reorder, delete, GET — result matches. Independent of Features and Testimonials.

- [X] T021 [P] [US2] `CreateFaqDto` at `src/content/marketing/faqs/dto/create-faq.dto.ts` — `@Length(1,300)` question, `@Length(1,2000)` answer, optional `@IsInt @Min(0)` order. Trim + whitespace-only rejection.
- [X] T022 [P] [US2] `UpdateFaqDto` at `src/content/marketing/faqs/dto/update-faq.dto.ts` — all fields optional, at-least-one enforced.
- [X] T023 [P] [US2] `ReorderItemsDto` at `src/content/marketing/faqs/dto/reorder-items.dto.ts` — same shape as Features' copy; **do NOT share** with Features (Constitution Principle I, research Decision 9).
- [X] T024 [P] [US2] `FaqResponseDto` at `src/content/marketing/faqs/dto/faq-response.dto.ts` with `fromEntity` mapper.
- [X] T025 [US2] `FaqsService` at `src/content/marketing/faqs/faqs.service.ts` — identical structure to `FeaturesService`, operating on `prisma.faq`. Same ordering + append logic + TODO(KAN-74) comments.
- [X] T026 [US2] `AdminFaqsController` at `src/content/marketing/faqs/admin-faqs.controller.ts` — routes mirror Features. Same guards.
- [X] T027 [US2] Register `FaqsService` + `AdminFaqsController` in `src/content/marketing/marketing.module.ts`.
- [X] T028 [US2] Unit tests at `src/content/marketing/faqs/faqs.service.spec.ts` — same matrix as features.service.spec.ts, adapted fields.
- [X] T029 [US2] E2E tests at `test/content/marketing/admin-faqs.controller.e2e-spec.ts` — full coverage parallel to features e2e.

**Checkpoint**: FAQs module deployable independently.

---

## Phase 5: User Story 3 — Moderate Testimonials (Priority: P1)

**Goal**: Admin can CRUD testimonials and transition their moderation state.
**Independent Test**: Create testimonial (starts PENDING), PATCH `/status` to APPROVED, verify `getApprovedTestimonialsByOwner` returns it, PATCH to HIDDEN, verify it disappears from public but still visible to admin. Rating 6 / invalid URL = 400.

- [X] T030 [P] [US3] `CreateTestimonialDto` at `src/content/marketing/testimonials/dto/create-testimonial.dto.ts` — `@Length(1,100)` authorName, optional `@Length(1,100)` authorTitle, optional `@IsUrl()` avatarUrl, `@Length(1,1000)` content, optional `@IsInt @Min(1) @Max(5)` rating, optional `@IsInt @Min(0)` order. **No `status` field.** Trim + whitespace-only rejection on required strings.
- [X] T031 [P] [US3] `UpdateTestimonialDto` at `src/content/marketing/testimonials/dto/update-testimonial.dto.ts` — all editable fields optional, at-least-one enforced, **no `status`**.
- [X] T032 [P] [US3] `UpdateTestimonialStatusDto` at `src/content/marketing/testimonials/dto/update-testimonial-status.dto.ts` — single `@IsEnum(TestimonialStatus)` status field.
- [X] T033 [P] [US3] `ReorderItemsDto` at `src/content/marketing/testimonials/dto/reorder-items.dto.ts` — own copy.
- [X] T034 [P] [US3] `TestimonialResponseDto` at `src/content/marketing/testimonials/dto/testimonial-response.dto.ts` with `fromEntity` (include `createdAt` as ISO string and nullable fields).
- [X] T035 [US3] `TestimonialsService` at `src/content/marketing/testimonials/testimonials.service.ts` — methods `listByOwner` (all statuses), `create` (forces `status: PENDING`), `update` (never touches status), `updateStatus`, `delete`, `reorder`. Sort by `order ASC, createdAt ASC`. Append on missing order. TODO(KAN-74) comments at every mutation site (including `updateStatus`).
- [X] T036 [US3] `AdminTestimonialsController` at `src/content/marketing/testimonials/admin-testimonials.controller.ts` — routes per `contracts/testimonials.md`, including `PATCH /admin/testimonials/:id/status`. Same admin guards.
- [X] T037 [US3] Register `TestimonialsService` + `AdminTestimonialsController` in `src/content/marketing/marketing.module.ts`.
- [X] T038 [US3] Unit tests at `src/content/marketing/testimonials/testimonials.service.spec.ts` — CRUD, `create` forces PENDING even if caller fabricates status, `updateStatus` transitions, `listByOwner` returns all statuses, `getApprovedTestimonialsByOwner` (or equivalent helper) returns only APPROVED.
- [X] T039 [US3] E2E tests at `test/content/marketing/admin-testimonials.controller.e2e-spec.ts` — full CRUD, new testimonial is PENDING, status cycles PENDING → APPROVED → HIDDEN → APPROVED, admin GET returns all statuses, rating 6 rejected (400), invalid avatar URL rejected (400), reorder works, 401 unauthenticated.

**Checkpoint**: All three admin submodules are delivered. At this point the MVP (three P1 stories) is complete.

---

## Phase 6: User Story 4 — Public consumption helpers (Priority: P2)

**Goal**: Exposed `PublicMarketingQueries` (already implemented in T006) is verified against a real DB so KAN-26 can consume it.

**Independent Test**: Seed a path with features/faqs/testimonials across statuses, invoke each helper, assert ordering and status filtering. Empty owner → `[]`.

- [X] T040 [US4] E2E tests at `test/content/marketing/public-queries.helper.e2e-spec.ts` — seeds a path with 3 features, 3 faqs, testimonials in all three statuses. Asserts: `getFeaturesByOwner` returns correct order; `getFaqsByOwner` returns correct order; `getApprovedTestimonialsByOwner` returns only APPROVED; each helper returns `[]` on an empty owner. Bootstraps the Nest app to obtain the provider via `app.get(PublicMarketingQueries)`.

**Checkpoint**: Public query contract verified. KAN-26 is unblocked.

---

## Phase 7: User Story 5 — Cascade cleanup (Priority: P2)

**Goal**: `MarketingCleanupHelper` (implemented in T005) is verified end-to-end against a real DB.

**Independent Test**: Seed two paths each with full marketing content; run `deleteAllForPath` on the first; verify its content is gone and the second path's content is untouched. Same for course. No-op on empty owner.

- [X] T041 [US5] E2E tests at `test/content/marketing/marketing-cleanup.helper.e2e-spec.ts` — seeds two paths + one course with full marketing content. Asserts: `deleteAllForPath(pathA)` removes only pathA's items; pathB's and course's items untouched; `deleteAllForCourse(courseId)` symmetric; no-op on owner with no content; transactional atomicity (optionally verified by mocking a failing inner delete).

**Checkpoint**: Cleanup contract verified. Future Path/Course delete endpoints can safely call the helper.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final checks, README, and full-suite verification per Definition of Done (§14 of ticket).

- [X] T042 Update the Content section of the repo README (or `CLAUDE.md` Content submodule note) with a short paragraph listing the new admin marketing endpoints and the four exported helpers. File: root `README.md` if present, otherwise add the section to the existing `src/content/README.md` (or create if missing).
- [X] T043 Run the full DoD checklist: `npm run build`, `npx prisma validate`, `npm run test:schema`, `npm test`, `npm run test:content:e2e`. All green.
- [X] T044 Diff verification: `git diff prisma/schema.prisma prisma/migrations/` is empty; `git diff src/auth src/users src/onboarding src/common src/content/tags` is empty. Fix any unintended edit.
- [X] T045 Grep for `TODO(KAN-74)` and confirm every mutation site (features create/update/delete/reorder, faqs same, testimonials create/update/delete/reorder/updateStatus) has one marker. Total expected: ~14 markers.

---

## Dependencies

```
Setup (T001–T002)
        │
        ▼
Foundational (T003–T011)  ─── blocks everything below
        │
        ├──▶ US1 Features   (T012–T020)
        ├──▶ US2 FAQs       (T021–T029)
        ├──▶ US3 Testimon.  (T030–T039)
        ├──▶ US4 PublicQry  (T040)   ← depends on T006 (already in Phase 2)
        └──▶ US5 Cleanup    (T041)   ← depends on T005 (already in Phase 2)
        │
        ▼
Polish (T042–T045)
```

- **US1, US2, US3 are fully independent of each other** once Phase 2 is done. Three developers can work on them in parallel.
- **US4 and US5** depend only on Phase 2 helpers (T005, T006) and can run in parallel with any of US1–US3.
- T018, T027, T037 all modify the same `marketing.module.ts` file — they must be **serialized** (one commit at a time) even though their upstream tasks are parallel.

## Parallel Execution Examples

**Phase 2 (Foundational)** — all `[P]` tasks run in parallel:
```
T003 OwnerValidator  ║  T004 ReorderHelper  ║  T005 CleanupHelper  ║  T006 PublicQueries
T007 OV spec         ║  T008 Reorder spec    ║  T009 Cleanup spec
→ then T010 MarketingModule → T011 ContentModule wiring
```

**Phase 3 DTOs** — four parallel DTO files for US1:
```
T012 CreateFeatureDto ║ T013 UpdateFeatureDto ║ T014 ReorderItemsDto ║ T015 FeatureResponseDto
→ then T016 service → T017 controller → T018 module wire → T019 spec, T020 e2e
```

**Across stories** (after Phase 2): three engineers may take US1, US2, US3 respectively and ship in parallel, with the only coordination point being `marketing.module.ts` (T018 / T027 / T037).

## Implementation Strategy

- **MVP = US1 (Features)** alone. After Phase 2 + Phase 3, the feature ships a usable admin Features CRUD that unblocks frontend path/course page prototyping.
- **Incremental delivery**: US2 and US3 follow independently. US4 and US5 are small verification phases that lock in contracts for downstream tickets (KAN-26, future deletes).
- **Test-first within each story** is not required (unit + e2e land together), but the ticket's DoD requires full test coverage before merge.
- **Cache wiring** (KAN-74) lands as a follow-up diff once that module is merged — the TODO markers make it a mechanical sweep.

---

## Summary

- **Total tasks**: 45
- **By phase**: Setup 2 · Foundational 9 · US1 9 · US2 9 · US3 10 · US4 1 · US5 1 · Polish 4
- **Parallelizable tasks** (marked `[P]`): 15
- **MVP scope**: T001–T020 (Setup + Foundational + US1) = 20 tasks
- **Independently testable stories**: US1, US2, US3, US4, US5 — each has its own e2e spec and a clear acceptance test from the feature spec
- **Format validation**: Every task begins with `- [ ]`, carries a `T###` id, uses `[P]` where applicable and `[US#]` for story-phase tasks, and names an exact file path
