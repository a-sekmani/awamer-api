# Research: Auth Module Unit Tests

**Feature**: 004-auth-unit-tests
**Date**: 2026-03-29

## Research Tasks

### 1. NestJS Testing Module Setup Pattern

**Decision**: Use `Test.createTestingModule()` from `@nestjs/testing` to create an isolated module for each test suite. Provide mocked implementations of all dependencies via `useValue` with Jest mock factories.
**Rationale**: NestJS's testing module respects dependency injection, so mocks are injected exactly as real providers would be. This ensures the service/controller under test behaves identically to production with respect to DI wiring.
**Alternatives considered**:
- Direct instantiation (`new AuthService(...)`) — works but bypasses DI decorators and middleware.
- In-memory database (SQLite) — violates the "no real database" constraint and is slower.

### 2. Mocking PrismaService

**Decision**: Create a mock factory that provides nested mock objects for each Prisma model method used by AuthService: `user.findUnique`, `user.findFirst`, `user.update`, `user.create`, `userProfile.create`, `userRole.create`, `subscription.create`, `subscriptionPlan.findFirst`, and `$transaction`. The `$transaction` mock should execute its callback with the same mock object (simulating the transactional client).
**Rationale**: PrismaService is used extensively across all 6 auth methods. A structured mock with `jest.fn()` for each method allows per-test return value configuration and invocation assertions.
**Alternatives considered**:
- prisma-mock library — adds a dependency for something achievable with plain Jest mocks.
- Partial mocking — too fragile; full mock is safer and more explicit.

### 3. Mocking bcryptjs

**Decision**: Use `jest.mock('bcryptjs')` at the module level to replace `bcrypt.hash` and `bcrypt.compare` with Jest mock functions. Default `hash` to return a predictable string (e.g., `'hashed_value'`), default `compare` to return `true`. Override per-test as needed.
**Rationale**: bcrypt operations are slow (intentionally) and would make tests exceed the 500ms target. Mocking them allows instant execution while still verifying that the correct functions are called with the right arguments (e.g., 12 rounds).
**Alternatives considered**:
- Using real bcrypt — too slow for unit tests (~250ms per hash operation).
- Not testing bcrypt calls — misses verification of the 12-round requirement.

### 4. Mocking JwtService

**Decision**: Mock `jwtService.sign()` to return a predictable token string (e.g., `'mock_access_token'`, `'mock_refresh_token'`). Mock `jwtService.verify()` to return a payload object for valid tokens and throw `JsonWebTokenError` for invalid ones.
**Rationale**: JWT signing/verification is a pure function of secret + payload. Mocking it allows tests to focus on the service logic (what gets signed, when verify is called) without depending on actual cryptographic operations.
**Alternatives considered**:
- Real JWT operations — adds ~10ms per test and requires managing test secrets. Unnecessary for unit tests.

### 5. Testing sanitizeUser (Private Method)

**Decision**: Test sanitizeUser indirectly through the public methods that return sanitized user objects (register, login, refresh). Add one explicit test that verifies the returned user object from register/login/refresh does NOT contain passwordHash, refreshToken, passwordResetToken, or passwordResetExpires.
**Rationale**: Private methods should be tested via their public API. sanitizeUser is called by register, login, and refresh — verifying their return values covers it. The spec calls for 1 explicit test case (FR-010), which we satisfy by checking the output shape.
**Alternatives considered**:
- Making sanitizeUser public for testing — violates encapsulation.
- Using `service['sanitizeUser']()` to access private method — fragile and couples tests to internal naming.

### 6. DTO Validation Testing Approach

**Decision**: Use `validate()` from `class-validator` directly to test DTOs. Create DTO instances with invalid data, call `validate()`, and assert that the expected validation errors are returned. No need for full HTTP request/response testing for DTO validation.
**Rationale**: class-validator decorators are the validation mechanism. Testing them directly is faster and more focused than going through the full NestJS request pipeline. The controller test verifies that ValidationPipe is applied (integration concern).
**Alternatives considered**:
- Full e2e request testing with supertest — too heavy for unit tests; belongs in e2e tests.
- Skipping DTO tests — misses validation coverage.

### 7. Test File Organization

**Decision**: Organize `auth.service.spec.ts` with 7 describe blocks: `register` (7 tests), `login` (5 tests), `refresh` (4 tests), `logout` (3 tests), `forgotPassword` (3 tests), `resetPassword` (4 tests), `sanitizeUser` (1 test). Organize `auth.controller.spec.ts` with 1 describe block containing 3 tests.
**Rationale**: Matches the spec's FR-013 requirement and the user's requested grouping. Each describe block corresponds to one service method, making failures easy to locate.
**Alternatives considered**:
- Flat test list without describe blocks — harder to navigate with 27 tests.
- Separate files per method — overkill for 27 tests that share the same setup.
