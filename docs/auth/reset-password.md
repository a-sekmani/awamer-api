# Reset Password — Backend Spec (awamer-api)

> **Module:** `AuthModule`
> **Endpoints:**
> - `GET  /api/v1/auth/verify-reset-token?token=...` — pre-check the token without consuming it
> - `POST /api/v1/auth/reset-password` — consume the token and set a new password
> **Frontend page:** `/auth/reset-password` (awamer-web)
> **Decorator:** both routes are `@Public()`
> **Status code:** `200 OK`

This document describes the second half of the password reset flow. The
first half (token issuance) is documented in
[forgot-password.md](./forgot-password.md).

---

## 1. Summary

When the user clicks the link from the password-reset email, the frontend
lands on `/auth/reset-password?token=...`. Before showing the form, the
frontend pings `GET /auth/verify-reset-token` so it can show "this link is
expired" without burning the token. When the user submits a new password,
the frontend posts the token + password to `POST /auth/reset-password`. On
success the backend updates the password hash, clears the reset token, and
**revokes all active sessions** by setting `user.refreshToken = null`. The
user must then log in again with the new password.

---

## 2. GET /api/v1/auth/verify-reset-token

### Purpose
Lets the frontend tell the user "this link is invalid/expired" before they
type a new password. The token is **not** consumed by this call.

### Query parameters

| Field   | Type     | Required | Validation |
|---------|----------|----------|------------|
| `token` | `string` | yes      | Read directly with `@Query('token')` (no DTO). |

### Behavior — `AuthService.verifyResetToken(token)`

Source: `src/auth/auth.service.ts` (around lines 411–439).

1. **Empty token guard.** If `token` is falsy → throw
   `BadRequestException` with `errorCode: INVALID_RESET_TOKEN`.
2. **SHA-256 hash** the supplied token.
3. **Lookup user** matching that hash and an unexpired `passwordResetExpires`:
   ```ts
   prisma.user.findFirst({
     where: {
       passwordResetToken: hashedToken,
       passwordResetExpires: { gt: new Date() },
     },
   })
   ```
4. **If no row** → throw `BadRequestException` with `INVALID_RESET_TOKEN`.
   The same error covers "wrong token" and "expired token" (no enumeration
   between the two).
5. **Return** `{ valid: true }`.

### Rate limiting
`@Throttle({ default: { limit: 10, ttl: 60000 } })` — 10 calls/min/IP.

### Response

```json
{ "data": { "valid": true }, "message": "Token is valid" }
```

### Errors

| Status | `errorCode`           | When |
|--------|-----------------------|------|
| 400    | `INVALID_RESET_TOKEN` | Empty token, unknown hash, or expired row. |
| 429    | (throttler)           | More than 10 calls/min/IP. |

---

## 3. POST /api/v1/auth/reset-password

### Body — `ResetPasswordDto` (`src/auth/dto/reset-password.dto.ts`)

| Field      | Type     | Required | Validation |
|------------|----------|----------|------------|
| `token`    | `string` | yes      | `@IsString`, `@IsNotEmpty` |
| `password` | `string` | yes      | `@IsString`, `@MinLength(8)`, `@MaxLength(128)`, `@Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{}\|;:'",.<>?/\\\`~])/, { message: '...' })` |

The password regex matches the one used at registration: at least one
uppercase, one lowercase, one digit, and one special character.

### Behavior — `AuthService.resetPassword(dto)`

Source: `src/auth/auth.service.ts` (around lines 441–474).

1. **SHA-256 hash** the supplied token.
2. **Lookup user** matching the hash and an unexpired `passwordResetExpires`
   (same query as `verifyResetToken`).
3. **If no row** → throw `BadRequestException` with `INVALID_RESET_TOKEN`.
4. **Bcrypt-hash the new password** with `BCRYPT_ROUNDS = 12`.
5. **Atomic transaction:**
   ```ts
   prisma.$transaction([
     prisma.user.update({
       where: { id: user.id },
       data: {
         passwordHash,
         passwordResetToken: null,
         passwordResetExpires: null,
         refreshToken: null,
       },
     }),
   ])
   ```
   - The new password hash replaces the old one.
   - The reset token + expiry are cleared (the link is now single-use).
   - `refreshToken: null` revokes any active session — including any
     concurrent sessions on other devices.

> Note: the transaction wraps a single update. The array form is preserved
> for symmetry with other transactions in the file and to make it trivial
> to add steps later (e.g. invalidating refresh tokens in a separate table).

### Rate limiting
`@Throttle({ default: { limit: 5, ttl: 60000 } })` — 5 calls/min/IP.

### Response

```json
{ "data": null, "message": "Password reset successful" }
```

The user is **not** logged in by this endpoint. No cookies are set. The
frontend must redirect to `/auth/login`.

### Errors

| Status | `errorCode`           | When |
|--------|-----------------------|------|
| 400    | `VALIDATION_FAILED`   | DTO validation rejected the body (missing field, weak password, unknown field). |
| 400    | `INVALID_RESET_TOKEN` | Token does not match any user, or the row's expiry is in the past. |
| 429    | (throttler)           | More than 5 calls/min/IP. |

---

## 4. Side effects (state mutations)

### verify-reset-token
None. Read-only.

### reset-password (success path)
| Table  | Mutation |
|--------|----------|
| `User` | UPDATE `passwordHash`, `passwordResetToken: null`, `passwordResetExpires: null`, `refreshToken: null` |

### reset-password (failure path)
None. The user row is untouched.

---

## 5. Security notes

- **Token is consumed by clearing it.** After a successful reset, the same
  link cannot be reused — the row no longer matches any hashed token.
- **All sessions revoked.** Setting `refreshToken: null` forces every
  device to fall through to `INVALID_SESSION` on the next refresh call.
  This protects users whose old credentials may have been compromised.
- **Same `INVALID_RESET_TOKEN` error** for "wrong token" and "expired
  token" — no enumeration.
- **Bcrypt cost 12** for the new password hash, matching register/login.
- **Pre-validation endpoint** (`verify-reset-token`) lets the UX surface
  expired links without consuming the token, while still enforcing the
  same hash + expiry check on the actual reset call.
- **No automatic login.** A successful reset does not issue tokens. The
  user must explicitly log in with the new password — this is a deliberate
  trade-off favoring security over UX.

---

## 6. Files involved

| File | Role |
|------|------|
| `src/auth/auth.controller.ts` | `verifyResetToken()` and `resetPassword()` routes |
| `src/auth/auth.service.ts`    | `verifyResetToken()`, `resetPassword()` |
| `src/auth/dto/reset-password.dto.ts` | Request validation |
| `prisma/schema.prisma`        | `User.passwordResetToken`, `User.passwordResetExpires`, `User.refreshToken` |
| `src/common/error-codes.enum.ts` | `INVALID_RESET_TOKEN` |

---

## 7. Things NOT to change without coordination

- The `INVALID_RESET_TOKEN` collapse for "wrong vs. expired". Splitting
  them would be a user-enumeration vulnerability.
- The `refreshToken: null` step in the transaction. It is the only way
  active sessions are revoked on a password reset.
- The "no auto-login" decision. The frontend redirect to `/auth/login`
  depends on this.
- The 1-hour expiry (set by `forgot-password`) without a security review.
- The password regex — must remain symmetric with `RegisterDto`.
