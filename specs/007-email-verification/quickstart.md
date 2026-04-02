# Quickstart: Email Verification (007)

**Branch**: `007-email-verification`

## Prerequisites

- Node.js 20 LTS
- PostgreSQL running locally
- Project dependencies installed (`npm install`)
- Environment variables configured (see `.env` or `CLAUDE.md`)

## Implementation Order

### Step 1: Database Schema

1. Add `emailVerified` Boolean field (default `false`) to `User` model in `prisma/schema.prisma`
2. Add `EmailVerification` model to `prisma/schema.prisma`
3. Run `npx prisma migrate dev --name add-email-verification`
4. **Important**: Create a data migration to set `emailVerified = true` for all existing users

### Step 2: Mail Service

1. Add `sendVerificationEmail(email, code, name)` method to `src/mail/mail.service.ts`
2. Email content: bilingual (Arabic top, English bottom) with the 6-digit code

### Step 3: Auth Service — Verification Methods

1. Add `sendVerificationCode(userId)` — generates OTP, invalidates old codes, creates record, sends email
2. Add `verifyEmail(userId, code)` — validates code, updates user + verification record in transaction
3. Modify `register()` — call `sendVerificationCode` after user creation, add `emailVerified`/`requiresVerification` to response
4. Modify `login()` — add `emailVerified`/`requiresVerification` to response
5. Modify `sanitizeUser()` — include `emailVerified` field

### Step 4: DTO

1. Create `src/auth/dto/verify-email.dto.ts` with `code` field validation

### Step 5: Auth Controller — New Endpoints

1. Add `POST /auth/send-verification` endpoint
2. Add `POST /auth/verify-email` endpoint
3. Add `POST /auth/resend-verification` endpoint

### Step 6: EmailVerifiedGuard

1. Create `src/common/decorators/skip-email-verification.decorator.ts`
2. Create `src/common/guards/email-verified.guard.ts`
3. Apply guard to `POST /users/me/onboarding` in users controller

### Step 7: Tests

1. Unit tests for all new auth service methods
2. Unit tests for EmailVerifiedGuard
3. Update existing auth service tests for modified register/login responses

## Verification

```bash
# Run migrations
npx prisma migrate dev

# Run tests
npm run test

# Manual testing sequence:
# 1. POST /api/v1/auth/register → check emailVerified: false in response
# 2. POST /api/v1/auth/send-verification → check email received
# 3. POST /api/v1/auth/verify-email → with correct code
# 4. POST /api/v1/users/me/onboarding → should now work
```
