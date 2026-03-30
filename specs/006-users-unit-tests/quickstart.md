# Quickstart: Users Module Unit Tests (KAN-22)

**Feature**: 006-users-unit-tests
**Date**: 2026-03-29

## Prerequisites

- Node.js 20 LTS
- Dependencies installed (`npm install`)
- Users module implementation from feature 005-users-module in place

## No Additional Dependencies Needed

Jest, ts-jest, @nestjs/testing, class-validator, and class-transformer are already installed.

## Run the Tests

```bash
# Run all users tests
npx jest src/users/ --verbose

# Run only service tests
npx jest src/users/users.service.spec.ts --verbose

# Run only controller tests
npx jest src/users/users.controller.spec.ts --verbose

# Run only DTO tests
npx jest src/users/dto/users.dto.spec.ts --verbose

# Run with coverage
npx jest src/users/ --coverage
```

## Expected Output

```
PASS src/users/users.service.spec.ts
  UsersService
    getMe
      ✓ should return user, profile, role, and subscription with plan
      ✓ should throw NotFoundException if user does not exist
    updateUser
      ✓ should update name only
      ✓ should update country only
      ✓ should update locale to ar
      ✓ should update locale to en
      ✓ should return sanitized user after update
      ✓ should handle empty body gracefully
    updateProfile
      ✓ should update displayName only
      ✓ should update avatarUrl
      ✓ should update preferredLanguage to ar
      ✓ should update preferredLanguage to en
      ✓ should return profile after update
    changePassword
      ✓ should update password hash when current password is correct
      ✓ should throw BadRequestException when current password is incorrect
      ✓ should call bcrypt.hash with 12 rounds
      ✓ should not call prisma.user.update if bcrypt.compare returns false
    submitOnboarding
      ✓ should create correct number of OnboardingResponse records
      ✓ should include userId, questionKey, answer, stepNumber in each record
      ✓ should update profile with background, goals, interests, onboardingCompleted
      ✓ should call analytics capture with onboarding_completed
      ✓ should return updated profile
      ✓ should use prisma.$transaction
      ✓ should throw on transaction failure
    getOnboardingStatus
      ✓ should return completed true with responses
      ✓ should return completed false with empty responses
      ✓ should sort responses by stepNumber ascending

PASS src/users/users.controller.spec.ts
  UsersController
    ✓ GET /users/me delegates to getMe and wraps response
    ✓ PATCH /users/me delegates to updateUser and wraps response
    ✓ PATCH /users/me/profile delegates to updateProfile and wraps response
    ✓ PATCH /users/me/password delegates to changePassword and returns message
    ✓ POST /users/me/onboarding delegates to submitOnboarding and wraps response
    ✓ GET /users/me/onboarding delegates to getOnboardingStatus and wraps response

PASS src/users/dto/users.dto.spec.ts
  UpdateUserDto
    ✓ should accept locale ar
    ✓ should accept locale en
    ✓ should reject locale fr
    ✓ should reject locale arabic
    ✓ should accept empty object
  ChangePasswordDto
    ✓ should reject missing currentPassword
    ✓ should reject missing newPassword
    ✓ should accept both fields present
  SubmitOnboardingDto
    ✓ should reject empty responses array
    ✓ should reject missing questionKey in item
    ✓ should reject non-number stepNumber
    ✓ should accept valid responses array

Tests: ~45 passed, ~45 total
Time: < 10s
```
