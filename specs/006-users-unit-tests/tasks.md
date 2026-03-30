# Tasks: Users Module Unit Tests (KAN-22)

**Input**: Design documents from `/specs/006-users-unit-tests/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, quickstart.md

**Tests**: This IS a test feature — all tasks create test code.

**Organization**: Tasks grouped by user story. Three test files can be created in parallel since they target different files.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Verify Jest runs for the users directory.

- [x] T001 Verify Jest works by running `npx jest src/users/ --passWithNoTests` at the project root. Confirm no configuration errors.

---

## Phase 2: Foundational (Test File Scaffolds)

**Purpose**: Create all 3 test file scaffolds with mock factories and shared test data.

- [x] T002 [P] Create `src/users/users.service.spec.ts` with scaffold: (1) `jest.mock('bcryptjs')` at top, import `* as bcrypt from 'bcryptjs'`. (2) Import Test/TestingModule from `@nestjs/testing`. (3) Import UsersService, PrismaService, AnalyticsService. (4) Create `mockPrismaService` with nested jest.fn() for: `user.findUnique`, `user.update`, `userProfile.findUnique`, `userProfile.update`, `onboardingResponse.findMany`, `onboardingResponse.createMany`, `$transaction` (executes callback with same mock). (5) Create `mockAnalyticsService` with `capture: jest.fn()`. (6) Create shared `mockUser` object with all User fields (id, name, email, passwordHash, country, locale, status, refreshToken, etc.). Create `mockProfile` with all UserProfile fields. Create `mockRole` object `{ role: 'LEARNER' }`. Create `mockSubscription` with nested `plan` object. (7) Top-level `describe('UsersService')` with `beforeEach` creating TestingModule (UsersService + 2 mocked providers) and `afterEach` with `jest.clearAllMocks()`. (8) Empty describe blocks for: `getMe`, `updateUser`, `updateProfile`, `changePassword`, `submitOnboarding`, `getOnboardingStatus`. Reference `specs/006-users-unit-tests/research.md` Decisions #1-#3.
- [x] T003 [P] Create `src/users/users.controller.spec.ts` with scaffold: (1) Import Test/TestingModule, AuthController→UsersController, UsersService, ConfigService. (2) Create `mockUsersService` with jest.fn() for: `getMe`, `updateUser`, `updateProfile`, `changePassword`, `submitOnboarding`, `getOnboardingStatus`. (3) `describe('UsersController')` with `beforeEach` creating TestingModule and `afterEach` with clearAllMocks. (4) 6 empty `it()` placeholders. Reference `specs/006-users-unit-tests/research.md` Decision #6.
- [x] T004 [P] Create `src/users/dto/users.dto.spec.ts` with scaffold: (1) Import `validate` from `class-validator`, `plainToInstance` from `class-transformer`. (2) Import UpdateUserDto, ChangePasswordDto, SubmitOnboardingDto. (3) 3 empty describe blocks: `UpdateUserDto`, `ChangePasswordDto`, `SubmitOnboardingDto`. Reference `specs/006-users-unit-tests/research.md` Decision #5.

**Checkpoint**: All 3 test files compile. Run `npx jest src/users/ --passWithNoTests`.

---

## Phase 3: User Story 1 — Profile and Update Tests (Priority: P1) MVP

**Goal**: 13 tests for getMe (2), updateUser (6), updateProfile (5).

**Independent Test**: `npx jest src/users/users.service.spec.ts -t "getMe|updateUser|updateProfile"`.

### Implementation

- [x] T005 [US1] Implement test "should return user, profile, role, and subscription with plan" in the `getMe` describe block of `src/users/users.service.spec.ts`. Mock `user.findUnique` to return mockUser with `profile: mockProfile, roles: [mockRole], subscriptions: [{ ...mockSubscription, plan: mockPlan }]`. Assert result has user (safe fields only), profile, role string ('learner'), and subscription with plan.
- [x] T006 [US1] Implement test "should throw if user does not exist" in `src/users/users.service.spec.ts`. Mock `user.findUnique` to return null. Assert throws BadRequestException (matching the actual service implementation which uses BadRequestException for 'User not found').
- [x] T007 [US1] Implement test "should update name only" in the `updateUser` describe block of `src/users/users.service.spec.ts`. Mock `user.update` to return `{ ...mockUser, name: 'New Name' }`. Call `service.updateUser('user-id', { name: 'New Name' })`. Assert `user.update` called with `data: { name: 'New Name' }`. Assert result has updated name.
- [x] T008 [US1] Implement test "should update country only" in `src/users/users.service.spec.ts`. Similar to T007 but with `{ country: 'US' }`.
- [x] T009 [US1] Implement test "should update locale to ar" in `src/users/users.service.spec.ts`. Call with `{ locale: 'ar' }`. Assert update called correctly.
- [x] T010 [US1] Implement test "should update locale to en" in `src/users/users.service.spec.ts`. Call with `{ locale: 'en' }`. Assert update called correctly.
- [x] T011 [US1] Implement test "should return sanitized user after update" in `src/users/users.service.spec.ts`. Assert result does NOT contain passwordHash, refreshToken, passwordResetToken, passwordResetExpires. Assert result contains id, name, email, country, locale, status.
- [x] T012 [US1] Implement test "should handle empty body gracefully" in `src/users/users.service.spec.ts`. Call `service.updateUser('user-id', {})`. Assert `user.update` is called with `data: {}` (Prisma handles this as a no-op). Assert no error thrown.
- [x] T013 [US1] Implement test "should update displayName only" in the `updateProfile` describe block of `src/users/users.service.spec.ts`. Mock `userProfile.update` to return updated profile. Call with `{ displayName: 'Ahmad' }`. Assert called correctly.
- [x] T014 [US1] Implement test "should update avatarUrl" in `src/users/users.service.spec.ts`. Call with `{ avatarUrl: 'https://example.com/avatar.png' }`. Assert called correctly.
- [x] T015 [US1] Implement test "should update preferredLanguage to ar" in `src/users/users.service.spec.ts`. Call with `{ preferredLanguage: 'ar' }`.
- [x] T016 [US1] Implement test "should update preferredLanguage to en" in `src/users/users.service.spec.ts`. Call with `{ preferredLanguage: 'en' }`.
- [x] T017 [US1] Implement test "should return profile after update" in `src/users/users.service.spec.ts`. Assert result matches the mock profile returned by `userProfile.update`.

**Checkpoint**: 13 tests pass. Run `npx jest src/users/users.service.spec.ts -t "getMe|updateUser|updateProfile" --verbose`.

---

## Phase 4: User Story 2 — Password and Onboarding Service Tests (Priority: P1)

**Goal**: 14 tests for changePassword (4), submitOnboarding (7), getOnboardingStatus (3).

**Independent Test**: `npx jest src/users/users.service.spec.ts -t "changePassword|submitOnboarding|getOnboardingStatus"`.

### Implementation

- [x] T018 [US2] Implement test "should update password hash when current password is correct" in the `changePassword` describe block of `src/users/users.service.spec.ts`. Mock `user.findUnique` to return mockUser, `bcrypt.compare` to return true, `bcrypt.hash` to return 'new_hash'. Call `service.changePassword('user-id', { currentPassword: 'OldPass', newPassword: 'NewPass123' })`. Assert `user.update` called with `passwordHash: 'new_hash'` and `refreshToken: null`.
- [x] T019 [US2] Implement test "should throw BadRequestException when current password is incorrect" in `src/users/users.service.spec.ts`. Mock `bcrypt.compare` to return false. Assert throws BadRequestException with "Current password is incorrect".
- [x] T020 [US2] Implement test "should call bcrypt.hash with 12 rounds" in `src/users/users.service.spec.ts`. Same setup as T018. Assert `bcrypt.hash` called with ('NewPass123', 12).
- [x] T021 [US2] Implement test "should not call prisma.user.update if bcrypt.compare returns false" in `src/users/users.service.spec.ts`. Mock `bcrypt.compare` to return false. Catch the thrown error. Assert `user.update` was NOT called.
- [x] T022 [US2] Implement test "should create correct number of OnboardingResponse records" in the `submitOnboarding` describe block of `src/users/users.service.spec.ts`. Create mock tx (same shape as mockPrismaService). Mock `$transaction` to execute callback. Submit 3 responses. Assert `onboardingResponse.createMany` called with data array of length 3.
- [x] T023 [US2] Implement test "should include userId, questionKey, answer, stepNumber in each record" in `src/users/users.service.spec.ts`. Assert the data array passed to `createMany` contains objects with all 4 fields matching input.
- [x] T024 [US2] Implement test "should update profile with background, goals, interests, onboardingCompleted" in `src/users/users.service.spec.ts`. Assert `userProfile.update` called within the transaction with `onboardingCompleted: true` and the submitted background/goals/interests.
- [x] T025 [US2] Implement test "should call analytics capture with onboarding_completed" in `src/users/users.service.spec.ts`. Assert `analyticsService.capture` called with ('user-id', 'onboarding_completed').
- [x] T026 [US2] Implement test "should return updated profile" in `src/users/users.service.spec.ts`. Mock `userProfile.update` (inside tx) to return updated profile. Assert result matches.
- [x] T027 [US2] Implement test "should use prisma.$transaction" in `src/users/users.service.spec.ts`. Assert `$transaction` was called once.
- [x] T028 [US2] Implement test "should throw on transaction failure" in `src/users/users.service.spec.ts`. Mock `$transaction` to reject. Assert the error propagates.
- [x] T029 [US2] Implement test "should return completed true with responses" in the `getOnboardingStatus` describe block of `src/users/users.service.spec.ts`. Mock `userProfile.findUnique` to return `{ onboardingCompleted: true }`, `onboardingResponse.findMany` to return mock responses. Assert result `{ completed: true, responses: [...] }`.
- [x] T030 [US2] Implement test "should return completed false with empty responses" in `src/users/users.service.spec.ts`. Mock profile with `onboardingCompleted: false`, findMany returns []. Assert `{ completed: false, responses: [] }`.
- [x] T031 [US2] Implement test "should sort responses by stepNumber ascending" in `src/users/users.service.spec.ts`. Assert `onboardingResponse.findMany` called with `orderBy: { stepNumber: 'asc' }`.

**Checkpoint**: 14 tests pass. Run `npx jest src/users/users.service.spec.ts -t "changePassword|submitOnboarding|getOnboardingStatus" --verbose`.

---

## Phase 5: User Story 3 — Controller Tests (Priority: P1)

**Goal**: 6 controller endpoint delegation tests.

**Independent Test**: `npx jest src/users/users.controller.spec.ts --verbose`.

### Implementation

- [x] T032 [US3] Implement test "GET /users/me delegates to getMe and wraps response" in `src/users/users.controller.spec.ts`. Mock `usersService.getMe` to return mock data. Create mockReq with `user: { userId: 'id' }`. Call `controller.getMe(mockReq)`. Assert `getMe` called with 'id'. Assert result is `{ data: mockData, message: 'Success' }`.
- [x] T033 [US3] Implement test "PATCH /users/me delegates to updateUser and wraps response" in `src/users/users.controller.spec.ts`. Mock `usersService.updateUser` to return sanitized user. Assert result is `{ data: { user }, message: 'Success' }`.
- [x] T034 [US3] Implement test "PATCH /users/me/profile delegates to updateProfile and wraps response" in `src/users/users.controller.spec.ts`. Assert result is `{ data: { profile }, message: 'Success' }`.
- [x] T035 [US3] Implement test "PATCH /users/me/password delegates to changePassword and returns message" in `src/users/users.controller.spec.ts`. Assert result is `{ data: null, message: 'Password updated' }`.
- [x] T036 [US3] Implement test "POST /users/me/onboarding delegates to submitOnboarding and wraps response" in `src/users/users.controller.spec.ts`. Assert result is `{ data: { profile }, message: 'Success' }`.
- [x] T037 [US3] Implement test "GET /users/me/onboarding delegates to getOnboardingStatus and wraps response" in `src/users/users.controller.spec.ts`. Assert result is `{ data: mockStatus, message: 'Success' }`.

**Checkpoint**: 6 tests pass. Run `npx jest src/users/users.controller.spec.ts --verbose`.

---

## Phase 6: User Story 4 — DTO Validation Tests (Priority: P2)

**Goal**: 12 DTO validation tests across 3 describe blocks.

**Independent Test**: `npx jest src/users/dto/users.dto.spec.ts --verbose`.

### Implementation

- [x] T038 [US4] Implement test "should accept locale ar" in the `UpdateUserDto` describe block of `src/users/dto/users.dto.spec.ts`. Use `plainToInstance(UpdateUserDto, { locale: 'ar' })` and `validate()`. Assert 0 errors.
- [x] T039 [US4] Implement test "should accept locale en" in `src/users/dto/users.dto.spec.ts`. Same with `{ locale: 'en' }`. Assert 0 errors.
- [x] T040 [US4] Implement test "should reject locale fr" in `src/users/dto/users.dto.spec.ts`. Use `{ locale: 'fr' }`. Assert errors > 0, locale field has error.
- [x] T041 [US4] Implement test "should reject locale arabic" in `src/users/dto/users.dto.spec.ts`. Use `{ locale: 'arabic' }`. Assert errors > 0.
- [x] T042 [US4] Implement test "should accept empty object" in `src/users/dto/users.dto.spec.ts`. Use `{}`. Assert 0 errors (all fields optional).
- [x] T043 [US4] Implement test "should reject missing currentPassword" in the `ChangePasswordDto` describe block of `src/users/dto/users.dto.spec.ts`. Use `{ newPassword: 'Test1234' }`. Assert errors > 0 on currentPassword.
- [x] T044 [US4] Implement test "should reject missing newPassword" in `src/users/dto/users.dto.spec.ts`. Use `{ currentPassword: 'old' }`. Assert errors > 0 on newPassword.
- [x] T045 [US4] Implement test "should accept both fields present" in `src/users/dto/users.dto.spec.ts`. Use `{ currentPassword: 'old', newPassword: 'Test1234' }`. Assert 0 errors.
- [x] T046 [US4] Implement test "should reject empty responses array" in the `SubmitOnboardingDto` describe block of `src/users/dto/users.dto.spec.ts`. Use `{ responses: [] }`. Assert errors > 0.
- [x] T047 [US4] Implement test "should reject missing questionKey in item" in `src/users/dto/users.dto.spec.ts`. Use `{ responses: [{ answer: 'a', stepNumber: 1 }] }`. Assert errors > 0.
- [x] T048 [US4] Implement test "should reject non-number stepNumber" in `src/users/dto/users.dto.spec.ts`. Use `{ responses: [{ questionKey: 'q', answer: 'a', stepNumber: 'abc' }] }`. Assert errors > 0.
- [x] T049 [US4] Implement test "should accept valid responses array" in `src/users/dto/users.dto.spec.ts`. Use `{ responses: [{ questionKey: 'q', answer: 'a', stepNumber: 1 }] }`. Assert 0 errors.

**Checkpoint**: 12 DTO tests pass.

---

## Phase 7: Polish

- [x] T050 Run `npx jest src/users/ --verbose` and verify all ~45 tests pass. Fix any failures.
- [x] T051 Run `npm run build` to verify no TypeScript compilation errors in test files.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: T002, T003, T004 are parallel (different files)
- **US1 (Phase 3)**: Depends on T002
- **US2 (Phase 4)**: Depends on T002
- **US3 (Phase 5)**: Depends on T003
- **US4 (Phase 6)**: Depends on T004
- **Polish (Phase 7)**: All previous phases

### Parallel Opportunities

- T002 + T003 + T004 (3 different files)
- US3 (controller) can run in parallel with US1/US2 (service)
- US4 (DTOs) can run in parallel with US1/US2/US3

---

## Implementation Strategy

### MVP First (US1 — Profile Tests)

1. Phase 1: Verify Jest (T001)
2. Phase 2: Scaffolds (T002-T004 parallel)
3. Phase 3: 13 getMe/updateUser/updateProfile tests
4. **STOP and VALIDATE**: 13 tests pass

### Full Delivery

1. MVP + Phase 4 (14 password/onboarding tests)
2. Phase 5 (6 controller tests)
3. Phase 6 (12 DTO tests)
4. Phase 7 (validation)
