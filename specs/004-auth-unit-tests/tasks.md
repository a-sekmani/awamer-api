# Tasks: Auth Module Unit Tests

**Input**: Design documents from `/specs/004-auth-unit-tests/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, quickstart.md

**Tests**: This IS a test feature — all tasks create test code.

**Organization**: Tasks are grouped by user story. Both test files (`auth.service.spec.ts` and `auth.controller.spec.ts`) can be created in parallel since they target different files.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No setup needed — Jest and all test dependencies are already installed. Verify the test runner works.

- [x] T001 Verify Jest runs successfully by executing `npx jest --version` and `npx jest src/auth/ --passWithNoTests` at the project root. Confirm no configuration errors.

**Checkpoint**: Jest is working and ready for test files.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the test file scaffolds with mock factories and shared test data that all test describe blocks will use.

- [x] T002 [P] Create `src/auth/auth.service.spec.ts` with the following scaffold: (1) Import Test, TestingModule from `@nestjs/testing`. (2) Import AuthService. (3) Import PrismaService from `../prisma/prisma.service`. (4) Import MailService from `../mail/mail.service`. (5) Import JwtService from `@nestjs/jwt`. (6) Import ConfigService from `@nestjs/config`. (7) Add `jest.mock('bcryptjs')` at the top to mock bcrypt module-level. (8) Import `* as bcrypt from 'bcryptjs'`. (9) Create a `mockPrismaService` factory with nested jest.fn() mocks for: `user.findUnique`, `user.findFirst`, `user.update`, `user.create`, `userProfile.create`, `userRole.create`, `subscription.create`, `subscriptionPlan.findFirst`, and `$transaction` (that executes its callback with the same mock object). (10) Create a `mockMailService` with `sendPasswordResetEmail: jest.fn()`. (11) Create a `mockJwtService` with `sign: jest.fn().mockReturnValue('mock_token')` and `verify: jest.fn()`. (12) Create a `mockConfigService` with `get: jest.fn()`. (13) Create a shared `mockUser` object with all User fields (id, name, email, passwordHash, country, locale, status ACTIVE, refreshToken, passwordResetToken, passwordResetExpires, lastLoginAt, createdAt, updatedAt). (14) In a top-level `describe('AuthService')`, add `beforeEach` that creates a NestJS TestingModule providing AuthService with the 4 mocked dependencies, and gets the service instance. (15) Add `afterEach` that calls `jest.clearAllMocks()`. (16) Leave empty describe blocks for: `register`, `login`, `refresh`, `logout`, `forgotPassword`, `resetPassword`, `sanitizeUser`. Reference `specs/004-auth-unit-tests/research.md` Decisions #1, #2, #3, #4.
- [x] T003 [P] Create `src/auth/auth.controller.spec.ts` with the following scaffold: (1) Import Test, TestingModule from `@nestjs/testing`. (2) Import AuthController. (3) Import AuthService. (4) Import ConfigService. (5) Create a `mockAuthService` with jest.fn() mocks for: `register`, `login`, `logout`, `refresh`, `forgotPassword`, `resetPassword`. (6) Create a `mockConfigService` with `get: jest.fn()`. (7) Create a `mockResponse` object with `cookie: jest.fn()`, `clearCookie: jest.fn()` (simulating Express Response). (8) In a top-level `describe('AuthController')`, add `beforeEach` that creates a TestingModule providing AuthController with mocked AuthService and ConfigService, and gets the controller instance. (9) Add `afterEach` with `jest.clearAllMocks()`. (10) Leave 3 empty `it()` placeholders for the controller tests. Reference `specs/004-auth-unit-tests/research.md` Decision #1.

**Checkpoint**: Both test files compile and run with 0 tests passing (empty describe blocks). Run `npx jest src/auth/ --passWithNoTests` to verify.

---

## Phase 3: User Story 1 — Registration Tests (Priority: P1) MVP

**Goal**: 7 tests covering the register method: happy path, duplicate email, bcrypt hashing, email normalization, weak password, transaction rollback, free plan subscription.

**Independent Test**: Run `npx jest src/auth/auth.service.spec.ts -t "register"` — all 7 tests pass.

### Implementation for User Story 1

- [x] T004 [US1] Implement test "should create user + profile + role + subscription" in the `register` describe block of `src/auth/auth.service.spec.ts`. Setup: mock `user.findUnique` to return null (no existing user), mock `subscriptionPlan.findFirst` to return `{ id: 'plan-id', isDefault: true }`, mock `$transaction` to execute its callback and return a mock user, mock `bcrypt.hash` to resolve `'hashed_password'`, mock `jwtService.sign` to return `'mock_token'`. Call `service.register({ name: 'Test', email: 'test@example.com', password: 'Test1234', country: 'SA' })`. Assert: result contains user with safe fields only, result contains accessToken and refreshToken. Assert `$transaction` was called once.
- [x] T005 [US1] Implement test "should reject duplicate email with ConflictException" in `src/auth/auth.service.spec.ts`. Setup: mock `user.findUnique` to return a mockUser (email exists). Call `service.register(...)`. Assert: throws ConflictException with message "Email already registered".
- [x] T006 [US1] Implement test "should hash password with bcrypt 12 rounds" in `src/auth/auth.service.spec.ts`. Setup: same as T004 happy path. Call `service.register(...)`. Assert: `bcrypt.hash` was called with the password string and 12 as the salt rounds argument.
- [x] T007 [US1] Implement test "should normalize email to lowercase" in `src/auth/auth.service.spec.ts`. Setup: same as T004 happy path. Call `service.register({ ..., email: '  Test@Example.COM  ' })`. Assert: `user.findUnique` was called with `{ where: { email: 'test@example.com' } }` (trimmed and lowercased). Assert the user created inside the transaction uses the normalized email.
- [x] T008 [US1] Implement test "should reject weak password" in `src/auth/auth.service.spec.ts`. This tests the DTO validation layer. Import `validate` from `class-validator` and `plainToInstance` from `class-transformer`. Create a `RegisterDto` instance with password `'weak'`. Call `validate(instance)`. Assert: validation errors include a constraint on the password field matching the Matches regex. Reference `specs/004-auth-unit-tests/research.md` Decision #6.
- [x] T009 [US1] Implement test "should rollback transaction on failure" in `src/auth/auth.service.spec.ts`. Setup: mock `user.findUnique` to return null, mock `$transaction` to throw an Error('Transaction failed'). Call `service.register(...)`. Assert: the promise rejects (throws), and no user/profile/role/subscription records are persisted (verify that no individual create mocks outside the transaction were called).
- [x] T010 [US1] Implement test "should create subscription to default free plan" in `src/auth/auth.service.spec.ts`. Setup: same as T004 happy path, with `subscriptionPlan.findFirst` returning `{ id: 'free-plan-id', isDefault: true }`. Call `service.register(...)`. Assert: inside the transaction callback, `subscription.create` was called with data containing `planId: 'free-plan-id'` and `status: 'ACTIVE'`.

**Checkpoint**: 7 registration tests pass. Run `npx jest src/auth/auth.service.spec.ts -t "register" --verbose`.

---

## Phase 4: User Story 2 — Login and Token Tests (Priority: P1)

**Goal**: 5 tests covering the login method: happy path, wrong password, non-existent email, lastLoginAt update, hashed refresh token storage.

**Independent Test**: Run `npx jest src/auth/auth.service.spec.ts -t "login"` — all 5 tests pass.

### Implementation for User Story 2

- [x] T011 [US2] Implement test "should return user and tokens on valid credentials" in the `login` describe block of `src/auth/auth.service.spec.ts`. Setup: mock `user.findUnique` to return mockUser, mock `bcrypt.compare` to resolve `true`, mock `user.update` to return the updated user, mock `jwtService.sign` to return tokens. Call `service.login({ email: 'test@example.com', password: 'Test1234' })`. Assert: result contains user (safe fields), accessToken, and refreshToken.
- [x] T012 [US2] Implement test "should reject incorrect password with UnauthorizedException" in `src/auth/auth.service.spec.ts`. Setup: mock `user.findUnique` to return mockUser, mock `bcrypt.compare` to resolve `false`. Call `service.login(...)`. Assert: throws UnauthorizedException with message "Invalid credentials".
- [x] T013 [US2] Implement test "should reject non-existent email with same error message" in `src/auth/auth.service.spec.ts`. Setup: mock `user.findUnique` to return null. Call `service.login(...)`. Assert: throws UnauthorizedException with message "Invalid credentials" — same message as wrong password.
- [x] T014 [US2] Implement test "should update lastLoginAt" in `src/auth/auth.service.spec.ts`. Setup: same as T011 happy path. Call `service.login(...)`. Assert: `user.update` was called with data containing `lastLoginAt` set to a recent Date (use `expect.any(Date)` or check it's within the last second).
- [x] T015 [US2] Implement test "should store hashed refresh token in DB" in `src/auth/auth.service.spec.ts`. Setup: same as T011 happy path. Call `service.login(...)`. Assert: `user.update` was called with data containing `refreshToken` that is a hashed value (verify `bcrypt.hash` was called for the refresh token). Assert the stored value is NOT the raw token string.

**Checkpoint**: 5 login tests pass. Run `npx jest src/auth/auth.service.spec.ts -t "login" --verbose`.

---

## Phase 5: User Story 3 — Refresh, Logout, Password Recovery Tests (Priority: P1)

**Goal**: 12 tests covering refresh (4), logout (3), forgotPassword (3), resetPassword (2 of 4 — the token validation ones).

**Independent Test**: Run `npx jest src/auth/auth.service.spec.ts -t "refresh|logout|forgotPassword|resetPassword"` — all 12 tests pass.

### Implementation for User Story 3

- [x] T016 [US3] Implement test "should return new tokens with valid refresh token" in the `refresh` describe block of `src/auth/auth.service.spec.ts`. Setup: mock `jwtService.verify` to return `{ sub: 'user-id', email: 'test@example.com' }`, mock `user.findUnique` to return mockUser with a refreshToken hash, mock `bcrypt.compare` to resolve `true` (token matches), mock `user.update` to return updated user. Call `service.refresh('valid_refresh_token')`. Assert: result contains user, new accessToken, new refreshToken.
- [x] T017 [US3] Implement test "should reject invalid token" in `src/auth/auth.service.spec.ts`. Setup: mock `jwtService.verify` to throw an error. Call `service.refresh('invalid_token')`. Assert: throws UnauthorizedException.
- [x] T018 [US3] Implement test "should reject expired token" in `src/auth/auth.service.spec.ts`. Setup: mock `jwtService.verify` to throw `{ name: 'TokenExpiredError' }`. Call `service.refresh('expired_token')`. Assert: throws UnauthorizedException with message about invalid or expired token.
- [x] T019 [US3] Implement test "should invalidate old token after rotation" in `src/auth/auth.service.spec.ts`. Setup: same as T016 happy path. Call `service.refresh('old_token')`. Assert: `user.update` was called with a new hashed refreshToken (different from the input). Then mock `bcrypt.compare` to resolve `false` for the old token. Call `service.refresh('old_token')` again. Assert: throws UnauthorizedException.
- [x] T020 [US3] Implement test "should set refreshToken to null on logout" in the `logout` describe block of `src/auth/auth.service.spec.ts`. Call `service.logout('user-id')`. Assert: `user.update` was called with `{ where: { id: 'user-id' }, data: { refreshToken: null } }`.
- [x] T021 [US3] Implement test "should reject unauthenticated logout" — this is tested at the controller level (guard), so in the service test, verify that `logout` requires a userId parameter. Call `service.logout('user-id')` and assert `user.update` was called. The guard test is in the controller spec.
- [x] T022 [US3] Implement test "should confirm refreshToken is null in DB after logout" in `src/auth/auth.service.spec.ts`. Setup: mock `user.update` to return `{ ...mockUser, refreshToken: null }`. Call `service.logout('user-id')`. Assert: `user.update` was called with data `{ refreshToken: null }`.
- [x] T023 [US3] Implement test "should return without error for non-existent email" in the `forgotPassword` describe block of `src/auth/auth.service.spec.ts`. Setup: mock `user.findUnique` to return null. Call `service.forgotPassword({ email: 'nonexistent@test.com' })`. Assert: does not throw, resolves successfully (void).
- [x] T024 [US3] Implement test "should store passwordResetToken and passwordResetExpires" in `src/auth/auth.service.spec.ts`. Setup: mock `user.findUnique` to return mockUser. Call `service.forgotPassword({ email: 'test@example.com' })`. Assert: `user.update` was called with data containing `passwordResetToken` (a string, SHA-256 hash) and `passwordResetExpires` (a Date in the future, roughly 1 hour from now).
- [x] T025 [US3] Implement test "should call MailService.sendPasswordResetEmail" in `src/auth/auth.service.spec.ts`. Setup: same as T024. Call `service.forgotPassword(...)`. Assert: `mailService.sendPasswordResetEmail` was called once with (email, token string, user name).
- [x] T026 [US3] Implement test "should update password with valid token" in the `resetPassword` describe block of `src/auth/auth.service.spec.ts`. Setup: mock `user.findFirst` to return mockUser (matching hashed token + non-expired), mock `bcrypt.hash` to resolve 'new_hashed_password'. Call `service.resetPassword({ token: 'valid_token', password: 'NewPass123' })`. Assert: `user.update` was called with data containing `passwordHash: 'new_hashed_password'`, `passwordResetToken: null`, `passwordResetExpires: null`, `refreshToken: null`.
- [x] T027 [US3] Implement test "should reject expired token" in `src/auth/auth.service.spec.ts`. Setup: mock `user.findFirst` to return null (no user found with matching non-expired token). Call `service.resetPassword({ token: 'expired_token', password: 'NewPass123' })`. Assert: throws BadRequestException with message "Invalid or expired reset token".

**Checkpoint**: 12 tests pass. Run `npx jest src/auth/auth.service.spec.ts -t "refresh|logout|forgotPassword|resetPassword" --verbose`.

---

## Phase 6: User Story 4 — sanitizeUser and Controller Tests (Priority: P2)

**Goal**: 1 sanitizeUser test + 2 remaining resetPassword tests + 3 controller tests = 4 total in this phase (completing the 30).

**Independent Test**: Run `npx jest src/auth/ --verbose` — all 30 tests pass.

### Implementation for User Story 4

- [x] T028 [US4] Implement test "should exclude sensitive fields from output" in the `sanitizeUser` describe block of `src/auth/auth.service.spec.ts`. Setup: same as T011 (login happy path — returns sanitized user). Call `service.login(...)`. Assert: result.user does NOT have keys: `passwordHash`, `refreshToken`, `passwordResetToken`, `passwordResetExpires`. Assert result.user DOES have keys: `id`, `name`, `email`, `country`, `locale`, `status`. Reference `specs/004-auth-unit-tests/research.md` Decision #5.
- [x] T029 [US4] Implement test "should reject previously used token (single-use)" in `src/auth/auth.service.spec.ts` resetPassword describe block. Setup: first call succeeds (mock `user.findFirst` returns user), then second call fails (mock `user.findFirst` returns null because token was cleared). Call `service.resetPassword(...)` twice with same token. Assert: first call succeeds, second call throws BadRequestException.
- [x] T030 [US4] Implement test "should reject weak new password" in `src/auth/auth.service.spec.ts` resetPassword describe block. Use `validate()` from `class-validator` with `plainToInstance` from `class-transformer` to create a ResetPasswordDto with password `'weak'`. Call `validate(instance)`. Assert: validation errors exist on the password field. Reference `specs/004-auth-unit-tests/research.md` Decision #6.
- [x] T031 [US4] Implement test "should validate DTOs with class-validator" in `src/auth/auth.controller.spec.ts`. Import `validate` from `class-validator`, `plainToInstance` from `class-transformer`, and all 4 DTOs. Test each DTO with invalid data: RegisterDto with empty name, LoginDto with invalid email, ForgotPasswordDto with empty email, ResetPasswordDto with short password. Assert each produces validation errors. Reference `specs/004-auth-unit-tests/research.md` Decision #6.
- [x] T032 [US4] Implement test "should set httpOnly cookies on register/login" in `src/auth/auth.controller.spec.ts`. Setup: mock `authService.register` to return `{ user: {}, accessToken: 'at', refreshToken: 'rt' }`. Create a mockResponse with `cookie: jest.fn()`. Call `controller.register(registerDto, mockResponse)`. Assert: `mockResponse.cookie` was called twice — once for `access_token` with httpOnly true, once for `refresh_token` with httpOnly true. Repeat for login.
- [x] T033 [US4] Implement test "should clear cookies on logout" in `src/auth/auth.controller.spec.ts`. Setup: mock `authService.logout` to resolve. Create mockRequest with `user: { userId: 'id' }` and mockResponse with `clearCookie: jest.fn()`. Call `controller.logout(mockRequest, mockResponse)`. Assert: `mockResponse.clearCookie` was called for both `access_token` and `refresh_token`.

**Checkpoint**: All 30 tests pass. Run `npx jest src/auth/ --verbose`.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Run full suite, verify performance, fix any issues

- [x] T034 Run `npx jest src/auth/ --verbose` and verify all 30 tests pass with 0 failures. Fix any failing tests in `src/auth/auth.service.spec.ts` or `src/auth/auth.controller.spec.ts`.
- [x] T035 Run `npx jest src/auth/ --verbose` with timing and verify: each test completes in < 500ms, total suite completes in < 10 seconds. If any test exceeds 500ms, optimize the mock setup.
- [x] T036 Run `npm run build` to verify no TypeScript compilation errors in the test files or source files.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Phase 1 (Jest must work). T002 and T003 are parallel (different files).
- **US1 Registration (Phase 3)**: Depends on T002 (service test scaffold)
- **US2 Login (Phase 4)**: Depends on T002 (same file, but independent describe block)
- **US3 Refresh/Logout/Recovery (Phase 5)**: Depends on T002
- **US4 sanitizeUser/Controller (Phase 6)**: Depends on T002 and T003 (both files)
- **Polish (Phase 7)**: Depends on all previous phases

### User Story Dependencies

- **US1 (Registration tests)**: Independent — can run first
- **US2 (Login tests)**: Independent of US1 (different describe block, same file)
- **US3 (Refresh/Logout/Recovery tests)**: Independent of US1/US2
- **US4 (sanitizeUser/Controller tests)**: Independent (sanitizeUser uses login output, but each test has its own mock setup)

### Parallel Opportunities

T002 and T003 are parallel (different files). All US phases (3-6) write to the same file (T002's file), so they are sequential within `auth.service.spec.ts`. T031-T033 (controller tests) can run in parallel with service test tasks since they target `auth.controller.spec.ts`.

---

## Implementation Strategy

### MVP First (User Story 1 — Registration Tests)

1. Phase 1: Verify Jest (T001)
2. Phase 2: Create test scaffolds (T002, T003 in parallel)
3. Phase 3: 7 registration tests (T004-T010)
4. **STOP and VALIDATE**: 7 tests pass

### Full Delivery

1. MVP above
2. Phase 4: 5 login tests (T011-T015)
3. Phase 5: 12 remaining service tests (T016-T027)
4. Phase 6: 4 sanitizeUser + controller tests (T028-T033)
5. Phase 7: Final validation (T034-T036)

---

## Notes

- All service tests go in `src/auth/auth.service.spec.ts` — single file, 27 tests across 7 describe blocks
- All controller tests go in `src/auth/auth.controller.spec.ts` — single file, 3 tests
- `jest.mock('bcryptjs')` is at module level — all bcrypt calls are mocked globally in the service spec
- The `$transaction` mock must execute its callback (not just resolve) so that the creates inside the transaction are captured by their individual mocks
- Tests for DTO validation (T008, T030, T031) use `validate()` from class-validator directly, not the NestJS HTTP pipeline
- The sanitizeUser test (T028) is indirect — it verifies the output of login/register does not contain sensitive fields
