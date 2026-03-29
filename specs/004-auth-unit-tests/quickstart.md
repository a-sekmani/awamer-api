# Quickstart: Auth Module Unit Tests

**Feature**: 004-auth-unit-tests
**Date**: 2026-03-29

## Prerequisites

- Node.js 20 LTS
- Dependencies installed (`npm install`)
- Auth module implementation from feature 003-auth-module in place

## No Additional Dependencies Needed

Jest, ts-jest, @nestjs/testing, and class-validator are already installed in the project.

## Run the Tests

```bash
# Run all auth tests
npx jest src/auth/ --verbose

# Run only service tests
npx jest src/auth/auth.service.spec.ts --verbose

# Run only controller tests
npx jest src/auth/auth.controller.spec.ts --verbose

# Run with coverage
npx jest src/auth/ --coverage
```

## Expected Output

```
PASS src/auth/auth.service.spec.ts
  AuthService
    register
      ✓ should create user + profile + role + subscription
      ✓ should reject duplicate email with ConflictException
      ✓ should hash password with bcrypt 12 rounds
      ✓ should normalize email to lowercase
      ✓ should reject weak password
      ✓ should rollback transaction on failure
      ✓ should create subscription to default free plan
    login
      ✓ should return user and tokens on valid credentials
      ✓ should reject incorrect password with UnauthorizedException
      ✓ should reject non-existent email with same error message
      ✓ should update lastLoginAt
      ✓ should store hashed refresh token
    refresh
      ✓ should return new tokens with valid refresh token
      ✓ should reject invalid token
      ✓ should reject expired token
      ✓ should invalidate old token after rotation
    logout
      ✓ should set refreshToken to null
      ✓ should reject unauthenticated request
      ✓ should confirm refreshToken is null in DB
    forgotPassword
      ✓ should return without error for non-existent email
      ✓ should store passwordResetToken and passwordResetExpires
      ✓ should call MailService.sendPasswordResetEmail
    resetPassword
      ✓ should update password with valid token
      ✓ should reject expired token
      ✓ should reject already-used token
      ✓ should reject weak new password
    sanitizeUser
      ✓ should exclude sensitive fields from output

PASS src/auth/auth.controller.spec.ts
  AuthController
    ✓ should validate DTOs with class-validator
    ✓ should set httpOnly cookies on register/login
    ✓ should clear cookies on logout

Tests: 30 passed, 30 total
Time: < 10s
```

## Verification Checklist

- [ ] All 30 tests pass
- [ ] No test requires a database connection
- [ ] Each test runs in < 500ms
- [ ] Full suite completes in < 10 seconds
- [ ] Tests can run independently (any single test passes when run alone)
