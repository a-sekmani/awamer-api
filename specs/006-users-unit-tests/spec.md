# Feature Specification: Users Module Unit Tests (KAN-22)

**Feature Branch**: `006-users-unit-tests`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "Write full unit tests for UsersModule — 3 test files covering service (6 method groups), controller (6 endpoints), and DTO validation (3 DTOs)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Service-Level Profile and Update Tests (Priority: P1)

A developer working on the Users module needs confidence that the core profile retrieval and update methods are correct: getMe returns the full user composite (user + profile + role + subscription with plan), updateMe applies partial updates correctly, and updateProfile modifies only profile fields. These tests cover the most frequently called service methods.

**Why this priority**: getMe is the most called endpoint in the entire platform (every page load). Update methods are used daily by learners. Regressions here break the core user experience.

**Independent Test**: Run the getMe/updateMe/updateProfile tests in isolation — all pass, confirming happy paths and error cases.

**Acceptance Scenarios**:

1. **Given** a user exists with profile, roles, and subscription, **When** getMe is called, **Then** it returns user, profile, role string, and subscription with embedded plan.
2. **Given** the user does not exist, **When** getMe is called, **Then** a not-found error is thrown.
3. **Given** only a name is submitted, **When** updateMe is called, **Then** only the name is updated; other fields remain unchanged.
4. **Given** only a country is submitted, **When** updateMe is called, **Then** only the country is updated.
5. **Given** locale "ar" is submitted, **When** updateMe is called, **Then** the locale is updated to "ar".
6. **Given** locale "en" is submitted, **When** updateMe is called, **Then** the locale is updated to "en".
7. **Given** an update completes, **When** the result is returned, **Then** it contains the sanitized user object.
8. **Given** no fields are submitted (empty body), **When** updateMe is called, **Then** no database update is performed.
9. **Given** only displayName is submitted, **When** updateProfile is called, **Then** only displayName is updated.
10. **Given** an avatarUrl is submitted, **When** updateProfile is called, **Then** the avatarUrl is updated.
11. **Given** preferredLanguage "ar" is submitted, **When** updateProfile is called, **Then** it is accepted and stored.
12. **Given** preferredLanguage "en" is submitted, **When** updateProfile is called, **Then** it is accepted and stored.
13. **Given** a profile update completes, **When** the result is returned, **Then** it contains the updated profile object.

---

### User Story 2 — Service-Level Password and Onboarding Tests (Priority: P1)

A developer needs to verify that password changes validate the current password securely, onboarding submissions create records atomically with analytics events, and onboarding status returns correct completion data. These tests cover the security-sensitive and transaction-heavy service methods.

**Why this priority**: Password change is security-critical — incorrect behavior could lock users out or accept wrong passwords. Onboarding is the mandatory post-signup flow; transaction failures here leave users in a broken state.

**Independent Test**: Run the changePassword/submitOnboarding/getOnboarding tests in isolation — all pass.

**Acceptance Scenarios**:

1. **Given** the current password is correct, **When** changePassword is called, **Then** the password hash is updated with 12-round encryption.
2. **Given** the current password is incorrect, **When** changePassword is called, **Then** a 400 error with "Current password is incorrect" is thrown.
3. **Given** the password comparison fails, **When** the service checks, **Then** no database update is called (early return on failure).
4. **Given** valid onboarding responses, **When** submitOnboarding is called, **Then** individual response records are created matching the number of submitted responses.
5. **Given** each response record, **When** it is stored, **Then** it contains userId, questionKey, answer, and stepNumber.
6. **Given** onboarding succeeds, **When** the profile is updated, **Then** background, goals, interests are set and onboardingCompleted is true.
7. **Given** onboarding succeeds, **When** the analytics event fires, **Then** "onboarding_completed" is sent with the userId.
8. **Given** onboarding operations, **When** they execute, **Then** they run inside a database transaction.
9. **Given** the transaction fails, **When** an error occurs, **Then** an appropriate server error is thrown.
10. **Given** onboarding succeeds, **When** the result is returned, **Then** it contains the updated profile.
11. **Given** a user completed onboarding, **When** getOnboarding is called, **Then** completed is true and responses are returned.
12. **Given** a user has not completed onboarding, **When** getOnboarding is called, **Then** completed is false and responses is empty.
13. **Given** multiple onboarding responses exist, **When** they are returned, **Then** they are sorted by step number ascending.

---

### User Story 3 — Controller Delegation and Response Wrapping Tests (Priority: P1)

A developer needs to verify that each controller endpoint correctly delegates to the service, extracts the userId from the JWT, and wraps responses in the standard format. These tests ensure the HTTP layer works correctly.

**Why this priority**: Controller bugs cause the wrong service method to be called, wrong parameters to be passed, or responses to be in the wrong format — all of which break the frontend contract.

**Independent Test**: Run the controller tests in isolation — all 6 endpoint tests pass.

**Acceptance Scenarios**:

1. **Given** a GET /users/me request, **When** the controller handles it, **Then** usersService.getMe is called with the userId from the JWT and the response is wrapped as `{ data: {...}, message: 'Success' }`.
2. **Given** a PATCH /users/me request, **When** the controller handles it, **Then** the DTO is passed to usersService.updateUser and the response wraps the user.
3. **Given** a PATCH /users/me/profile request, **When** the controller handles it, **Then** the DTO is passed to usersService.updateProfile and the response wraps the profile.
4. **Given** a PATCH /users/me/password request, **When** the controller handles it, **Then** both passwords are passed to usersService.changePassword and the response is `{ data: null, message: 'Password updated' }`.
5. **Given** a POST /users/me/onboarding request, **When** the controller handles it, **Then** the responses array is passed to usersService.submitOnboarding and the response wraps the profile.
6. **Given** a GET /users/me/onboarding request, **When** the controller handles it, **Then** usersService.getOnboardingStatus is called and the response wraps completed + responses.

---

### User Story 4 — DTO Validation Tests (Priority: P2)

A developer needs to verify that the validation decorators on DTOs correctly accept valid input and reject invalid input with appropriate error messages. These tests ensure the validation layer catches bad data before it reaches the service.

**Why this priority**: DTO validation is the first line of defense against bad data. However, it's lower risk than service logic because class-validator behavior is well-tested — these tests mainly verify that decorators are correctly applied.

**Independent Test**: Run the DTO validation tests in isolation — all pass.

**Acceptance Scenarios**:

1. **Given** UpdateUserDto with locale "ar", **When** validated, **Then** no errors are returned.
2. **Given** UpdateUserDto with locale "en", **When** validated, **Then** no errors are returned.
3. **Given** UpdateUserDto with locale "fr", **When** validated, **Then** a validation error is returned.
4. **Given** UpdateUserDto with locale "arabic", **When** validated, **Then** a validation error is returned.
5. **Given** UpdateUserDto with empty object {}, **When** validated, **Then** no errors are returned (all fields optional).
6. **Given** ChangePasswordDto without currentPassword, **When** validated, **Then** a validation error is returned.
7. **Given** ChangePasswordDto without newPassword, **When** validated, **Then** a validation error is returned.
8. **Given** ChangePasswordDto with both fields, **When** validated, **Then** no errors are returned.
9. **Given** SubmitOnboardingDto with empty responses array, **When** validated, **Then** a validation error is returned.
10. **Given** a response item missing questionKey, **When** validated, **Then** a validation error is returned.
11. **Given** a response item where stepNumber is not a number, **When** validated, **Then** a validation error is returned.
12. **Given** a valid responses array, **When** validated, **Then** no errors are returned.

---

### Edge Cases

- What happens when mocks return unexpected values (e.g., null from findUnique that should find a user)? Each test must configure mocks explicitly for its scenario.
- What happens when the analytics service capture method throws? The onboarding test should verify the service handles or propagates the error.
- What happens when bcrypt.compare receives a null hash? Tests should verify the service handles this case.
- What happens when tests run concurrently? All tests must be independent with isolated mock state via beforeEach/afterEach.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Test suite MUST include 3 test files: `users.service.spec.ts`, `users.controller.spec.ts`, and `dto/users.dto.spec.ts`.
- **FR-002**: Each test case MUST be independent — no test may depend on the outcome or side effects of another test.
- **FR-003**: All external dependencies (database service, analytics service, password hashing) MUST be replaced with mock implementations — no real database connections, network calls, or cryptographic operations.
- **FR-004**: getMe tests (2+) MUST verify: full composite return (user + profile + role + subscription with plan) and not-found error handling.
- **FR-005**: updateMe tests (6) MUST verify: individual field updates (name, country, locale ar, locale en), result shape, and no-op when body is empty.
- **FR-006**: updateProfile tests (5) MUST verify: individual field updates (displayName, avatarUrl, preferredLanguage ar, preferredLanguage en) and result shape.
- **FR-007**: changePassword tests (4) MUST verify: successful update with correct password, rejection with incorrect password (400 "Current password is incorrect"), 12-round hashing, and no database update when comparison fails.
- **FR-008**: submitOnboarding tests (7) MUST verify: correct number of response records created, record field contents (userId, questionKey, answer, stepNumber), profile update (background, goals, interests, onboardingCompleted=true), analytics event firing, transaction usage, transaction failure handling, and result shape.
- **FR-009**: getOnboarding tests (3) MUST verify: completed=true with responses, completed=false with empty responses, and ascending step-number sort order.
- **FR-010**: Controller tests (6) MUST verify: each endpoint delegates to the correct service method with the correct parameters and returns the correct response wrapper format.
- **FR-011**: DTO validation tests (12) MUST verify: UpdateUserDto locale acceptance/rejection and optional fields, ChangePasswordDto required field checks, and SubmitOnboardingDto array/item validation.
- **FR-012**: All tests MUST use beforeEach for mock setup and afterEach/clearAllMocks for cleanup.
- **FR-013**: Test file structure MUST use describe blocks organized by method name for the service, endpoint name for the controller, and DTO class name for validations.

### Key Entities

- **UsersService**: The primary service under test — contains getMe, updateUser, updateProfile, changePassword, submitOnboarding, getOnboardingStatus.
- **UsersController**: The controller under test — delegates to UsersService and wraps responses.
- **DTOs**: UpdateUserDto, ChangePasswordDto, SubmitOnboardingDto — validation targets.
- **Mock Dependencies**: PrismaService (database), AnalyticsService (event tracking), bcryptjs (password hashing).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All test cases pass when the suite is run.
- **SC-002**: No test requires a running database, analytics service, or external dependency.
- **SC-003**: Each test completes in under 500 milliseconds.
- **SC-004**: When a regression is introduced to any Users method, at least one test fails with a descriptive message.
- **SC-005**: The test suite covers all 6 service methods, 6 controller endpoints, and 3 DTO classes.
- **SC-006**: Running the full suite takes under 10 seconds total.

## Assumptions

- The Users module implementation (users.service.ts, users.controller.ts, DTOs) from feature 005-users-module is complete and compiles.
- The AnalyticsService has a `capture(userId, event, properties?)` method (added in feature 005-users-module).
- Mock implementations are created within test files using Jest mock factories — no shared mock utilities needed.
- The `@golevelup/ts-jest` package (createMock) is mentioned in requirements but standard Jest mocks (`jest.fn()`) are sufficient and preferred for explicit control. If `@golevelup/ts-jest` is not installed, plain Jest mocks will be used.
- DTO validation tests use `validate()` from class-validator directly, not the NestJS HTTP pipeline.
- The "no-op when body is empty" test for updateMe verifies that the service does not call the database update method when no fields are provided (or that it calls with an empty data object, which Prisma handles gracefully).
