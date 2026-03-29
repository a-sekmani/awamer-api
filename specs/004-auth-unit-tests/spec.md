# Feature Specification: Auth Module Unit Tests

**Feature Branch**: `004-auth-unit-tests`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "Add comprehensive unit tests to the Auth module — 27 AuthService tests + 3 AuthController tests using Jest with mocks."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Service-Level Registration Tests (Priority: P1)

A developer working on the Auth module needs confidence that the registration flow is correct: new accounts are created atomically (user + profile + role + subscription), duplicate emails are rejected, passwords are hashed securely, and email normalization works. These 7 tests cover the most critical and complex service method.

**Why this priority**: Registration is the most complex auth operation (transactional, multi-entity). A regression here silently breaks user onboarding. These tests have the highest defect-prevention value.

**Independent Test**: Run the 7 registration tests in isolation — all pass, confirming the happy path and key failure modes for account creation.

**Acceptance Scenarios**:

1. **Given** valid registration data, **When** the register method is called, **Then** a user, profile, role (learner), and subscription (free plan) are created together.
2. **Given** an email that already exists, **When** registration is attempted, **Then** a 409 Conflict error is returned.
3. **Given** a password is provided, **When** it is stored, **Then** it is hashed with 12 rounds of bcrypt — never stored in plaintext.
4. **Given** an email with uppercase characters or whitespace, **When** registration is called, **Then** the email is normalized to trimmed lowercase before storage.
5. **Given** a weak password (too short, missing required character classes), **When** validation runs, **Then** a clear error is returned describing the requirements.
6. **Given** a transaction step fails (e.g., role creation), **When** the error occurs, **Then** all prior creates in the transaction are rolled back — no partial data.
7. **Given** a default free plan exists, **When** registration completes, **Then** the new user has a subscription linked to that default plan.

---

### User Story 2 — Service-Level Login and Token Tests (Priority: P1)

A developer needs to verify that login correctly validates credentials, rejects invalid attempts with generic messages (preventing enumeration), updates the last login timestamp, and stores hashed refresh tokens. These 5 tests cover the second most-used auth method.

**Why this priority**: Login is the most frequently called auth endpoint. Incorrect behavior here (wrong error messages, missing token storage, unupdated timestamps) directly impacts security and user experience.

**Independent Test**: Run the 5 login tests in isolation — all pass, confirming credential validation, generic error messages, timestamp updates, and token storage.

**Acceptance Scenarios**:

1. **Given** valid credentials, **When** login is called, **Then** the user data and both tokens (access + refresh) are returned.
2. **Given** an incorrect password, **When** login is attempted, **Then** a 401 Unauthorized error with "Invalid credentials" is returned.
3. **Given** a non-existent email, **When** login is attempted, **Then** the same 401 "Invalid credentials" error is returned (no email enumeration).
4. **Given** a successful login, **When** the operation completes, **Then** the user's lastLoginAt field is updated to the current time.
5. **Given** a successful login, **When** a refresh token is generated, **Then** it is stored in the database as a bcrypt hash, not plaintext.

---

### User Story 3 — Service-Level Refresh, Logout, and Password Recovery Tests (Priority: P1)

A developer needs to verify that token refresh rotates credentials correctly, logout clears state, forgot-password never leaks email existence, and reset-password validates tokens properly. These 12 tests cover the remaining auth service methods.

**Why this priority**: These methods complete the auth lifecycle. Token refresh bugs cause session drops for all users. Password recovery bugs are both security-sensitive (token reuse, enumeration) and user-facing (locked out users).

**Independent Test**: Run the 12 tests (4 refresh + 3 logout + 3 forgot-password + 2 reset-password) in isolation — all pass.

**Acceptance Scenarios**:

1. **Given** a valid refresh token, **When** refresh is called, **Then** new access and refresh tokens are returned.
2. **Given** an invalid refresh token, **When** refresh is called, **Then** a 401 error is returned.
3. **Given** an expired refresh token, **When** refresh is called, **Then** a 401 error is returned.
4. **Given** a token has been rotated, **When** the old token is used, **Then** it is rejected (single-use).
5. **Given** an authenticated user, **When** logout is called, **Then** the refresh token is set to null in the database.
6. **Given** no authentication, **When** logout is called, **Then** a 401 error is returned.
7. **Given** logout completes, **When** the database is checked, **Then** the user's refreshToken field is null.
8. **Given** a non-existent email, **When** forgot-password is called, **Then** no error is thrown — the response is identical to a valid email (200).
9. **Given** a valid email, **When** forgot-password is called, **Then** a passwordResetToken and passwordResetExpires are stored in the database.
10. **Given** forgot-password is called, **When** a token is generated, **Then** the email service's sendPasswordResetEmail method is called.
11. **Given** a valid reset token, **When** reset-password is called, **Then** the password is updated and the token is cleared.
12. **Given** an expired reset token, **When** reset-password is called, **Then** a 400 Bad Request error is returned.

---

### User Story 4 — sanitizeUser and Controller Tests (Priority: P2)

A developer needs to verify that sensitive fields are never leaked in responses and that the controller correctly manages cookies (setting on login/register, clearing on logout) and validates incoming DTOs.

**Why this priority**: These tests protect against information leakage and verify the HTTP layer. While important, they are lower risk than service logic bugs because cookie and DTO behavior is relatively stable.

**Independent Test**: Run the 4 tests (1 sanitizeUser + 3 controller) in isolation — all pass.

**Acceptance Scenarios**:

1. **Given** a full user object from the database, **When** sanitizeUser is called, **Then** the result excludes passwordHash, refreshToken, passwordResetToken, and passwordResetExpires.
2. **Given** a register or login request, **When** the controller handles it, **Then** httpOnly cookies are set on the response.
3. **Given** a logout request, **When** the controller handles it, **Then** cookies are cleared from the response.
4. **Given** invalid input data, **When** a request is made to any auth endpoint, **Then** DTO validation rejects it with clear error messages.

---

### Edge Cases

- What happens when the test mocks return unexpected values (e.g., null from a findUnique that should find a user)? Each test must handle mock boundary conditions explicitly.
- What happens when bcrypt.compare is called with a null hash? Tests should verify the service handles this gracefully rather than throwing an unhandled error.
- What happens when the reset token in the database does not match the SHA-256 hash of the provided token? The test should verify a 400 error, not a 500.
- What happens when multiple tests run concurrently? All tests must be independent with isolated mock state — no shared mutable state between test cases.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Test suite MUST include exactly 30 test cases: 27 for AuthService and 3 for AuthController.
- **FR-002**: Each test case MUST be independent — no test may depend on the outcome or side effects of another test.
- **FR-003**: All external dependencies (database service, mail service, token service) MUST be replaced with mock implementations — no real database connections or network calls during testing.
- **FR-004**: Registration tests (7) MUST verify: successful multi-entity creation, duplicate email rejection, password hashing with correct cost factor, email normalization, weak password rejection, transaction rollback on failure, and free plan subscription creation.
- **FR-005**: Login tests (5) MUST verify: successful authentication with token issuance, incorrect password rejection, non-existent email rejection (same error message), lastLoginAt update, and hashed refresh token storage.
- **FR-006**: Refresh tests (4) MUST verify: successful token rotation, invalid token rejection, expired token rejection, and old token invalidation after rotation.
- **FR-007**: Logout tests (3) MUST verify: refresh token deletion from database, rejection without authentication, and confirmed null refreshToken in database.
- **FR-008**: Forgot-password tests (3) MUST verify: identical response for existing and non-existing emails, reset token and expiry storage in database, and email service method invocation.
- **FR-009**: Reset-password tests (4) MUST verify: successful password update with valid token, expired token rejection, previously used (single-use) token rejection, and weak password rejection.
- **FR-010**: sanitizeUser test (1) MUST verify that passwordHash, refreshToken, passwordResetToken, and passwordResetExpires are excluded from the returned object.
- **FR-011**: Controller tests (3) MUST verify: DTO validation enforcement, httpOnly cookie setting on register/login, and cookie clearing on logout.
- **FR-012**: All tests MUST produce clear, descriptive assertion messages so that failures pinpoint the exact issue.
- **FR-013**: Test file structure MUST use describe blocks organized by method name (register, login, refresh, logout, forgotPassword, resetPassword, sanitizeUser) for the service, and a separate describe block for the controller.

### Key Entities

- **AuthService**: The service under test — contains all auth business logic (register, login, refresh, logout, forgotPassword, resetPassword). Private method sanitizeUser is tested via public method outputs.
- **AuthController**: The controller under test — handles HTTP request/response, cookie management, and DTO validation.
- **Mock Dependencies**: PrismaService (database operations), MailService (email sending), JwtService (token signing/verification), ConfigService (environment configuration).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 30 test cases pass when the test suite is run.
- **SC-002**: No test case requires a running database, mail server, or external service.
- **SC-003**: Each test case completes in under 500 milliseconds.
- **SC-004**: When a regression is introduced to any auth method, at least one test fails and its failure message identifies the broken behavior.
- **SC-005**: The test suite covers all 6 auth service methods and 3 controller behaviors defined in the specification.
- **SC-006**: Running the full test suite takes under 10 seconds total.

## Assumptions

- The Auth module implementation (auth.service.ts, auth.controller.ts, DTOs) from feature 003-auth-module is complete and passes TypeScript compilation.
- Jest is already configured in the project via the NestJS scaffold (jest config in package.json or jest.config.ts).
- The test files will be co-located with the source files: `src/auth/auth.service.spec.ts` and `src/auth/auth.controller.spec.ts`.
- Mock implementations for PrismaService, MailService, JwtService, and ConfigService will be created within the test files using Jest mock factories — no shared mock utilities are needed.
- The sanitizeUser method is private, so it is tested indirectly through the public methods (register, login, refresh) that return sanitized user objects. A separate describe block documents this explicitly.
- DTO validation tests use NestJS testing utilities to verify that class-validator decorators reject invalid input.
- The "weak password rejection" tests (for register and reset-password) verify the DTO validation layer, not service-level logic, since password strength is enforced by class-validator decorators.
