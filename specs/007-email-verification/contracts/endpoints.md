# API Endpoint Contracts: Email Verification (007)

**Date**: 2026-04-01 | **Branch**: `007-email-verification`

---

## New Endpoints

### POST /api/v1/auth/send-verification

**Access**: JwtAuthGuard (authenticated users only)
**Rate Limit**: Application-level — max 3 sends per user per 15-minute rolling window

**Request**: No body required.

**Success Response** (200):
```json
{
  "data": null,
  "message": "Verification code sent to your email"
}
```

**Error Responses**:

| Status | Condition | Response |
| ------ | --------- | -------- |
| 400 | Email already verified | `{ "statusCode": 400, "message": "Email already verified" }` |
| 429 | Rate limit exceeded (3 sends in 15 min) | `{ "statusCode": 429, "message": "Too many verification requests. Please try again later" }` |
| 401 | No valid JWT | `{ "statusCode": 401, "message": "Unauthorized" }` |

**Side Effects**:
- Invalidates all previous unused codes for the user (sets `used = true`)
- Creates a new `EmailVerification` record with 10-minute expiry
- Sends bilingual email (Arabic + English) with 6-digit code via MailModule

---

### POST /api/v1/auth/verify-email

**Access**: JwtAuthGuard (authenticated users only)

**Request Body**:
```json
{
  "code": "123456"
}
```

| Field | Type | Validation |
| ----- | ---- | ---------- |
| code | string | Required, exactly 6 characters, numeric only (`/^\d{6}$/`) |

**Success Response** (200):
```json
{
  "data": {
    "emailVerified": true
  },
  "message": "Email verified successfully"
}
```

**Error Responses**:

| Status | Condition | Response |
| ------ | --------- | -------- |
| 400 | Email already verified | `{ "statusCode": 400, "message": "Email already verified" }` |
| 400 | No valid code found (none exists, all expired, or all used) | `{ "statusCode": 400, "message": "No valid verification code found. Please request a new one" }` |
| 400 | Incorrect code | `{ "statusCode": 400, "message": "Invalid verification code" }` |
| 400 | Code exhausted (5+ failed attempts) | `{ "statusCode": 400, "message": "Verification code has been invalidated due to too many attempts. Please request a new one" }` |
| 401 | No valid JWT | `{ "statusCode": 401, "message": "Unauthorized" }` |

**Side Effects**:
- On success: sets `EmailVerification.used = true` and `User.emailVerified = true` in a single transaction
- On failure: increments `EmailVerification.attempts`; if attempts reach 5, sets `used = true`

---

### POST /api/v1/auth/resend-verification

**Access**: JwtAuthGuard (authenticated users only)
**Rate Limit**: Same as send-verification — max 3 sends per user per 15-minute rolling window (shared count)

**Request**: No body required.

**Success Response** (200):
```json
{
  "data": null,
  "message": "Verification code resent to your email"
}
```

**Error Responses**: Same as `POST /api/v1/auth/send-verification`.

**Side Effects**: Same as `POST /api/v1/auth/send-verification`.

---

## Modified Endpoints

### POST /api/v1/auth/register (modified)

**Changes**:
- After successful registration, automatically sends a verification OTP email
- Response data now includes `emailVerified` and `requiresVerification` fields

**Updated Success Response** (201):
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "string",
      "email": "string",
      "country": "string|null",
      "locale": "string",
      "emailVerified": false,
      "requiresVerification": true
    }
  },
  "message": "Registration successful"
}
```

**Side Effects Added**:
- Creates `EmailVerification` record
- Sends bilingual verification email

---

### POST /api/v1/auth/login (modified)

**Changes**:
- Response data now includes `emailVerified` and `requiresVerification` fields

**Updated Success Response** (200):
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "string",
      "email": "string",
      "country": "string|null",
      "locale": "string",
      "emailVerified": true,
      "requiresVerification": false
    }
  },
  "message": "Login successful"
}
```

**Note**: `requiresVerification` is computed as `!user.emailVerified`.

---

## New Guard Behavior

### EmailVerifiedGuard

**Applied to**:
- `POST /api/v1/users/me/onboarding`
- All learning endpoints (when implemented)
- All enrollment endpoints (when implemented)

**NOT applied to**:
- All `/api/v1/auth/*` endpoints
- `GET /api/v1/users/me`
- `PATCH /api/v1/users/me`
- `PATCH /api/v1/users/me/profile`
- `PATCH /api/v1/users/me/password`

**Behavior when emailVerified = false**:
```json
{
  "statusCode": 403,
  "message": "Email verification required. Please verify your email before accessing this resource"
}
```
