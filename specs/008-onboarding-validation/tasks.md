# Tasks: Onboarding Validation Enforcement

**Input**: Design documents from `/specs/008-onboarding-validation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/onboarding-api.md, quickstart.md
**Reference**: `docs/onboarding/onboarding.md` — complete implementation spec

**Tests**: Yes — the feature spec explicitly requires ~44 new tests across DTO and service layers.

**Organization**: Tasks are grouped by user story. US1 and US2 share the same foundational changes (DTO + error code) and are implemented together as they are both P1. US3 and US4 build on the validated service logic.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- All paths are relative to repository root

---

## Phase 1: Setup (Error Code)

**Purpose**: Add the missing error code constant required by all subsequent tasks

- [x] T001 Add `ONBOARDING_ALREADY_COMPLETED` to ErrorCode enum in `src/common/error-codes.enum.ts` (verify if already present; add only if missing)

---

## Phase 2: Foundational (DTO Replacement)

**Purpose**: Replace the permissive DTO with strict validation constants and decorators. This MUST be complete before service or test work can begin.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Replace `src/users/dto/onboarding.dto.ts` with strict validation:
  - Export constants: `VALID_BACKGROUNDS`, `VALID_INTERESTS`, `VALID_GOALS`, `VALID_QUESTION_KEYS`, `MAX_INTERESTS`, `MIN_INTERESTS`
  - `OnboardingResponseItemDto`: add `@IsIn([...VALID_QUESTION_KEYS])` on questionKey, add `@Max(3)` on stepNumber
  - `SubmitOnboardingDto`: change to `@ArrayMinSize(3)` + `@ArrayMaxSize(3)`, remove top-level `background`, `goals`, `interests` optional string fields
- [x] T003 Verify `src/users/dto/index.ts` exports the new constants (`VALID_BACKGROUNDS`, `VALID_INTERESTS`, `VALID_GOALS`, `VALID_QUESTION_KEYS`, `MAX_INTERESTS`, `MIN_INTERESTS`) alongside existing DTO exports

**Checkpoint**: `npm run build` must compile with zero errors after this phase.

---

## Phase 3: User Story 1 — Valid Submission (Priority: P1) + User Story 2 — Invalid Data Rejection (Priority: P1) 🎯 MVP

**Goal**: Replace `submitOnboarding()` in the service with full validation logic, and add comprehensive tests for both valid and invalid submissions.

**Independent Test**: Submit a valid 3-response payload → profile updated with `onboardingCompleted: true`. Submit invalid payloads → all rejected with 400.

### Implementation

- [x] T004 [US1] [US2] Replace `submitOnboarding()` method in `src/users/users.service.ts`:
  - Check `onboardingCompleted === true` → throw `ONBOARDING_ALREADY_COMPLETED`
  - Validate all 3 required questionKeys present (`background`, `interests`, `goals`)
  - Validate stepNumber consistency (background=1, interests=2, goals=3)
  - Validate background answer against `VALID_BACKGROUNDS`
  - Validate goals answer against `VALID_GOALS`
  - Validate interests: JSON.parse → array check → length 1–4 → each in `VALID_INTERESTS` → no duplicates
  - Transaction: `deleteMany` old responses → `createMany` new → update profile (background, goals, interests, onboardingCompleted)
  - Import constants from DTO file
  - Preserve `analyticsService.capture(userId, 'onboarding_completed')` after transaction

### Tests

- [x] T005 [P] [US2] Add ~17 DTO validation tests to `src/users/dto/users.dto.spec.ts` — `SubmitOnboardingDto` describe block:
  - Valid 3-response payload accepted
  - Empty array rejected
  - Fewer than 3 items rejected
  - More than 3 items rejected
  - Invalid questionKey rejected
  - stepNumber 0 rejected
  - stepNumber 4 rejected
  - String stepNumber rejected
  - Float stepNumber (1.5) rejected
  - Missing questionKey in item rejected
  - Missing answer in item rejected
  - Missing stepNumber in item rejected
  - Empty string questionKey rejected
  - Empty string answer rejected
  - Answer exceeding 1000 chars rejected
  - Non-array responses rejected
  - Undefined/null responses rejected

- [x] T006 [P] [US1] Add ~11 happy-path service tests to `src/users/users.service.spec.ts` — `submitOnboarding — happy path` describe block:
  - Deletes existing responses before creating new (idempotency)
  - Creates exactly 3 OnboardingResponse records
  - Includes userId in each record
  - Stores background value in UserProfile.background
  - Stores goals value in UserProfile.goals
  - Stores interests JSON string in UserProfile.interests
  - Sets onboardingCompleted to true
  - Fires analyticsService.capture with 'onboarding_completed'
  - Uses prisma.$transaction for atomicity
  - Returns updated UserProfile
  - Throws on transaction failure (rollback)

- [x] T007 [P] [US2] Add ~15 validation service tests to `src/users/users.service.spec.ts` — `submitOnboarding — validation` describe block:
  - Throws ONBOARDING_ALREADY_COMPLETED if completed
  - Throws if background key missing
  - Throws if interests key missing
  - Throws if goals key missing
  - Throws if background stepNumber is not 1
  - Throws if interests stepNumber is not 2
  - Throws if goals stepNumber is not 3
  - Throws if background answer invalid
  - Throws if goals answer invalid
  - Throws if interests not valid JSON
  - Throws if interests not a JSON array
  - Throws if interests empty array
  - Throws if interests > 4 items
  - Throws if interests contain invalid value
  - Throws if interests contain duplicates

**Checkpoint**: `npm run build && npm run test` — all existing + new tests pass. User Stories 1 and 2 are fully functional.

---

## Phase 4: User Story 3 — Duplicate Prevention (Priority: P2)

**Goal**: Verify that the duplicate submission check (added in T004) works correctly.

**Independent Test**: Complete onboarding once, attempt again → rejected with `ONBOARDING_ALREADY_COMPLETED`.

Note: The implementation is already in T004. This phase adds edge-case coverage only.

- [x] T008 [US3] Verify the `ONBOARDING_ALREADY_COMPLETED` test in T007 covers this story. If additional edge cases are needed (e.g., checking that no DB writes happen when rejected), add them to `src/users/users.service.spec.ts`.

**Checkpoint**: Duplicate submission is rejected with correct error code.

---

## Phase 5: User Story 4 — Idempotent Resubmission (Priority: P3)

**Goal**: Verify that users with partial/failed previous attempts can resubmit cleanly.

**Independent Test**: Insert partial responses → submit complete payload → old responses deleted, new ones saved.

- [x] T009 [US4] Add ~5 edge-case tests to `src/users/users.service.spec.ts` — `submitOnboarding — edge cases` describe block:
  - Accepts interests with exactly 1 item (minimum)
  - Accepts interests with exactly 4 items (maximum)
  - Accepts all valid background values one by one
  - Accepts all valid goal values one by one
  - Accepts all valid interest values

**Checkpoint**: All edge cases pass. Idempotent resubmission verified via deleteMany in transaction.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all stories

- [x] T010 Run `npm run build` — must compile with zero errors
- [x] T011 Run `npm run test` — ALL tests must pass (existing 245 + ~48 new)
- [x] T012 Run `npm run lint` — no new lint errors
- [x] T013 Verify Postman collection has matching test cases for valid/invalid onboarding submissions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (DTO)**: Depends on Phase 1 (error code must exist for DTO references)
- **Phase 3 (US1+US2)**: Depends on Phase 2 (DTO must be in place)
  - T004 (service) must complete before T006/T007 (service tests) can verify behavior
  - T005 (DTO tests) can run in parallel with T004 (different files)
- **Phase 4 (US3)**: Depends on Phase 3 (T004 implements the check)
- **Phase 5 (US4)**: Depends on Phase 3 (T004 implements deleteMany)
- **Phase 6 (Polish)**: Depends on all phases

### Parallel Opportunities

Within Phase 3:
- T005 (DTO tests) can run in parallel with T004 (service implementation) — different files
- T006 and T007 (service tests) can run in parallel with each other — same file but independent describe blocks

### Within Each Phase

- Service implementation before service tests (T004 → T006, T007)
- DTO replacement before DTO tests (T002 → T005)
- Build verification after each phase

---

## Parallel Example: Phase 3

```bash
# After T004 (service implementation) completes:

# These can run in parallel (different describe blocks, same test file):
Task T006: "Happy-path service tests in src/users/users.service.spec.ts"
Task T007: "Validation service tests in src/users/users.service.spec.ts"

# This can run in parallel with T004 (different file):
Task T005: "DTO validation tests in src/users/dto/users.dto.spec.ts"
```

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + 3)

1. T001: Add error code
2. T002–T003: Replace DTO with strict validation
3. T004: Replace service method
4. T005–T007: Add all tests
5. **STOP and VALIDATE**: `npm run build && npm run test`
6. MVP complete — valid submissions work, invalid rejected

### Incremental Delivery

1. Phases 1–3 → MVP with validation + tests (P1 stories)
2. Phase 4 → Duplicate prevention verified (P2)
3. Phase 5 → Edge cases and boundary values (P3)
4. Phase 6 → Final polish and verification

---

## Notes

- Total tasks: 13
- Tasks per story: US1=2 (T004, T006), US2=3 (T004, T005, T007), US3=1 (T008), US4=1 (T009)
- Parallel opportunities: T005 with T004; T006 with T007
- The reference spec at `docs/onboarding/onboarding.md` contains exact code structure and test lists — use it as the primary implementation guide
- Do NOT modify: controller, schema, getOnboardingStatus(), module, auth files
