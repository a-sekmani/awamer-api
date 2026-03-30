# Research: Users Module Unit Tests (KAN-22)

**Feature**: 006-users-unit-tests
**Date**: 2026-03-29

## Research Tasks

### 1. Mocking PrismaService for UsersService

**Decision**: Create a mock factory with nested jest.fn() for each Prisma model method used by UsersService: `user.findUnique`, `user.update`, `userProfile.findUnique`, `userProfile.update`, `onboardingResponse.findMany`, `onboardingResponse.createMany`, and `$transaction`. The `$transaction` mock executes its callback with the same mock object.
**Rationale**: Same pattern proven in feature 004-auth-unit-tests. Explicit per-method mocks allow precise per-test configuration and assertion.
**Alternatives considered**: @golevelup/ts-jest createMock — adds a dependency; plain Jest mocks are sufficient and already established.

### 2. Mocking bcryptjs

**Decision**: Use `jest.mock('bcryptjs')` at module level. Default `hash` to return `'hashed_value'`, `compare` to return `true`. Override per-test.
**Rationale**: Same pattern as auth tests. Consistent across the codebase.

### 3. Mocking AnalyticsService

**Decision**: Provide `{ capture: jest.fn() }` as the AnalyticsService mock via `useValue` in the testing module.
**Rationale**: AnalyticsService.capture() is a void method that logs. Mocking with jest.fn() allows verifying it was called with the right arguments (userId, 'onboarding_completed').

### 4. Testing "No-Op on Empty Body" for updateMe

**Decision**: When updateMe receives an empty DTO (no fields set), verify that `prisma.user.update` is still called (Prisma handles empty data gracefully — it issues an UPDATE with no SET clause, which is a no-op). The test verifies the service doesn't crash.
**Rationale**: The service passes `dto` directly to Prisma. An empty object results in `data: {}` which Prisma accepts. Testing that the method completes without error is sufficient. Alternatively, the service could check for empty dto and skip the call — the test should match the actual implementation.

### 5. DTO Test File Location

**Decision**: Place DTO tests at `src/users/dto/users.dto.spec.ts` per the user's explicit requirement.
**Rationale**: User specified "DTOs file: dto/users.dto.spec.ts". Co-locating with the DTOs keeps tests near their subjects.

### 6. Test Organization

**Decision**:
- `users.service.spec.ts`: 6 describe blocks (getMe, updateUser, updateProfile, changePassword, submitOnboarding, getOnboardingStatus)
- `users.controller.spec.ts`: 6 it() blocks in one describe (one per endpoint)
- `dto/users.dto.spec.ts`: 3 describe blocks (UpdateUserDto, ChangePasswordDto, SubmitOnboardingDto)
**Rationale**: Matches FR-013 and the user's requested grouping.
