# Verify Email — Backend Spec (awamer-api)

> **Module:** `AuthModule`
> **Endpoints:**
> - `POST /api/v1/auth/send-verification` — send a fresh code (authenticated)
> - `POST /api/v1/auth/resend-verification` — same as `send-verification`, kept as a separate route for client clarity
> - `POST /api/v1/auth/verify-email` — submit the 6-digit code
> **Frontend page:** `/auth/verify-email` (awamer-web)
> **Status code:** `200 OK` for all three

This document describes the email-verification flow as implemented in
`src/auth/auth.controller.ts` and `src/auth/auth.service.ts`. The flow uses
6-digit numeric one-time codes delivered via AWS SES, hashed at rest with
SHA-256, with attempt tracking and rate limiting.

---

## 1. Summary

After register, the new account is `emailVerified: false`. The user must
prove ownership of their email by entering a 6-digit code that was sent to
that address. Until they do, `EmailVerifiedGuard` will block their access
to protected routes (e.g. `/users/me/onboarding`).

The flow:

1. The frontend calls `POST /auth/send-verification` (or relies on the
   automatic send during register) to mail a fresh code.
2. The user enters the code on `/auth/verify-email`.
3. The frontend calls `POST /auth/verify-email` with the code.
4. On success the backend flips `emailVerified` to `true`, **reissues a new
   access/refresh token pair**, and the cookies are rewritten so subsequent
   requests carry the updated JWT payload (`emailVerified: true`).
5. The frontend then routes the user to `/onboarding` or `/dashboard` based
   on `onboardingCompleted`.

---

## 2. POST /api/v1/auth/send-verification

### Auth
Requires a valid JWT (no `@Public()` decorator). The handler reads
`req.user.userId` from the JWT payload populated by `JwtStrategy`.

### Body
None.

### Behavior — `AuthService.sendVerificationCode(userId, ip)`

Source: `src/auth/auth.service.ts` (around lines 476–522).

1. **Lookup user.** If not found → `BadRequestException('User not found')`.
2. **Already verified short-circuit.** If `user.emailVerified === true` →
   `BadRequestException('Email already verified')`.
3. **Rate limit** (only when an IP is supplied — register's automatic send
   passes no IP and skips this step).
   `checkRateLimit(user.email, ip, RateLimitType.VERIFICATION_RESEND)` enforces
   three layers (see §6).
4. **Record the request** in `RateLimitedRequest` (so it counts toward the
   next caller's window).
5. **Generate a 6-digit code.** `crypto.randomInt(100000, 999999)`.
6. **Hash the code with SHA-256.** Codes are never stored in plaintext.
7. **Set expiry** = `now + VERIFICATION_CODE_EXPIRY_MS` (10 minutes).
8. **Atomic transaction:**
   - `emailVerification.updateMany({ where: { userId, used: false }, data: { used: true } })`
     — invalidates any previous unused codes.
   - `emailVerification.create({ data: { userId, code: hashedCode, expiresAt } })`
     — inserts the new row (`attempts: 0` by default).
9. **Send the email.** `mailService.sendVerificationEmail(user.email, code, user.name)`.
   The plaintext code is sent **only** in the email.

### Rate limiting (controller decorator)
`@Throttle({ default: { limit: 5, ttl: 60000 } })` — 5 calls/min/IP.

### Response

```json
{ "data": null, "message": "Verification code sent to your email" }
```

### Errors

| Status | When |
|--------|------|
| 400 `User not found`         | The JWT identifies a userId that no longer exists. |
| 400 `Email already verified` | Idempotency safeguard. |
| 401                          | Missing or invalid access token. |
| 429 `RATE_LIMIT_EXCEEDED`    | Per-email/per-IP throttle tripped (see §6) **or** global throttler tripped. |

---

## 3. POST /api/v1/auth/resend-verification

### Auth
Requires a valid JWT.

### Body
None.

### Behavior
This route exists purely so the frontend can have a clear "resend" button
that is decoupled from the initial "send" semantics. Internally it calls
the same `AuthService.sendVerificationCode(userId, ip)` method, with all
the same rate limits, expiry, hashing, and SES delivery as
`send-verification`.

### Response

```json
{ "data": null, "message": "Verification code resent to your email" }
```

---

## 4. POST /api/v1/auth/verify-email

### Auth
Requires a valid JWT.

### Body — `VerifyEmailDto` (`src/auth/dto/verify-email.dto.ts`)

| Field  | Type     | Validation |
|--------|----------|------------|
| `code` | `string` | `@IsString`, `@Length(6, 6)`, `@Matches(/^\d{6}$/)` ("Code must be exactly 6 digits") |

### Behavior — `AuthService.verifyEmail(userId, code)`

Source: `src/auth/auth.service.ts` (around lines 524–595).

1. **Lookup user.** If not found → `BadRequestException('User not found')`.
2. **Already verified short-circuit.** If `user.emailVerified === true` →
   `BadRequestException('Email already verified')`.
3. **Find the latest unused, unexpired code** for this user:
   ```ts
   prisma.emailVerification.findFirst({
     where: { userId, used: false, expiresAt: { gt: new Date() } },
     orderBy: { createdAt: 'desc' },
   })
   ```
   If none → `BadRequestException('No valid verification code found. Please request a new one')`.
4. **Attempt-cap check.** If `verification.attempts >= VERIFICATION_MAX_ATTEMPTS` (5):
   - Mark the row `used: true` (burns the code).
   - Throw `BadRequestException('Verification code has been invalidated due to too many attempts. Please request a new one')`.
5. **Constant-time comparison:**
   ```ts
   const hashedInput = sha256(code);
   const codeMatch =
     verification.code.length === hashedInput.length &&
     crypto.timingSafeEqual(Buffer.from(verification.code, 'hex'),
                            Buffer.from(hashedInput, 'hex'));
   ```
6. **On mismatch:**
   - Increment `attempts`.
   - If the new count is `>= VERIFICATION_MAX_ATTEMPTS`, also set `used: true`
     so the next request fails fast on step 3.
   - Throw `BadRequestException('Invalid verification code')`.
7. **On match — atomic transaction:**
   - `emailVerification.update({ where: { id }, data: { used: true } })`
     (burn the code).
   - `user.update({ where: { id: userId }, data: { emailVerified: true } })`.
8. **Reissue tokens.** Build an `updatedUser` with `emailVerified: true`
   and call `generateTokens(updatedUser)` (no `rememberMe` argument →
   defaults to 7d). This signs new access + refresh tokens that carry
   `emailVerified: true` in the payload, hashes the refresh token, and
   persists the hash to `user.refreshToken`.
9. **Return** `{ emailVerified: true, accessToken, refreshToken }`.

### Cookies set by the controller
The controller calls `setCookies(res, accessToken, refreshToken, COOKIE_MAX_AGE_DEFAULT)`.
The refresh cookie max-age is hardcoded to `COOKIE_MAX_AGE_DEFAULT` (7 days)
on this route — the verify-email step does **not** preserve the original
`rememberMe` choice. If the user originally selected "remember me" they will
need to log in again after 7 days unless they refresh in the meantime.

### Rate limiting (controller decorator)
`@Throttle({ default: { limit: 10, ttl: 60000 } })` — 10 calls/min/IP.

### Response

```json
{
  "data": { "emailVerified": true },
  "message": "Email verified successfully"
}
```

### Errors

| Status | Message / `errorCode`                                        | When |
|--------|--------------------------------------------------------------|------|
| 400    | `Code must be exactly 6 digits` (DTO)                        | Pattern mismatch. |
| 400    | `User not found`                                             | Stale userId on the JWT. |
| 400    | `Email already verified`                                     | Idempotency safeguard. |
| 400    | `No valid verification code found. Please request a new one` | No row matched (expired or never created). |
| 400    | `Verification code has been invalidated due to too many attempts. Please request a new one` | Attempt cap reached. |
| 400    | `Invalid verification code`                                  | Code mismatch; attempts incremented. |
| 401    | —                                                            | Missing or invalid access token. |
| 429    | `RATE_LIMIT_EXCEEDED`                                        | Throttler. |

---

## 5. Constants

```ts
VERIFICATION_CODE_EXPIRY_MS = 10 * 60 * 1000  // 10 minutes
VERIFICATION_MAX_ATTEMPTS   = 5
```

| Layer            | `RateLimitType`         | Limit                                       |
|------------------|-------------------------|---------------------------------------------|
| Per-email cooldown | `VERIFICATION_RESEND` | 1 request / 60 seconds                      |
| Per-email hourly   | `VERIFICATION_RESEND` | 5 requests / hour                           |
| Per-IP daily       | `VERIFICATION_RESEND` | 10 requests / 24 hours                      |
| Global throttler   | (Nest)                | 5/min/IP on send & resend, 10/min/IP on verify |

---

## 6. `checkRateLimit()` — three-layer per-row throttle

Source: `src/auth/auth.service.ts` `checkRateLimit(email, ip, type)` (around
lines 318–409). Used by `forgot-password` and `send-verification`. The same
function enforces all three layers and throws
`HttpException(..., 429, errorCode: RATE_LIMIT_EXCEEDED, retryAfter: <seconds>)`
on the first one that trips.

| # | Window | Scope | Threshold |
|---|--------|-------|-----------|
| 1 | 60 seconds | per email | 1 request |
| 2 | 1 hour     | per email | 5 requests |
| 3 | 24 hours   | per IP    | 10 requests |

The function returns the most accurate `retryAfter` it can compute from the
oldest row inside the offending window.

---

## 7. Side effects (state mutations)

### send / resend
| Table                | Mutation |
|----------------------|----------|
| `RateLimitedRequest` | INSERT (`type: VERIFICATION_RESEND`) — only when ip is provided |
| `EmailVerification`  | UPDATE all unused rows for the user → `used: true` |
| `EmailVerification`  | INSERT new row with hashed code, `attempts: 0`, `expiresAt: now+10m` |

Plus an outbound SES email containing the plaintext code.

### verify (success path)
| Table               | Mutation |
|---------------------|----------|
| `EmailVerification` | UPDATE the matched row → `used: true` |
| `User`              | UPDATE `emailVerified: true` |
| `User.refreshToken` | UPDATE — replaced with the bcrypt hash of the newly issued refresh token |

### verify (failure path)
| Table               | Mutation |
|---------------------|----------|
| `EmailVerification` | UPDATE `attempts` (and `used: true` once attempts hit the cap) |

---

## 8. Security notes

- **Codes are stored hashed** with SHA-256, never in plaintext.
- **Constant-time comparison** via `crypto.timingSafeEqual` on equal-length
  buffers, avoiding string-equality timing leaks.
- **Codes expire after 10 minutes** even if never used.
- **Codes are single-use:** sending a new code marks all previous unused
  codes as `used: true`.
- **5 wrong attempts burn the code.** The user must request a new one.
- **Rate limits are persisted** in `RateLimitedRequest` so they survive
  process restarts (unlike the global throttler's in-memory store).

---

## 9. Files involved

| File | Role |
|------|------|
| `src/auth/auth.controller.ts` | `sendVerification`, `resendVerification`, `verifyEmail` routes |
| `src/auth/auth.service.ts`    | `sendVerificationCode()`, `verifyEmail()`, `checkRateLimit()` |
| `src/auth/dto/verify-email.dto.ts` | 6-digit code validation |
| `src/mail/mail.service.ts`    | Sends the code via AWS SES |
| `src/common/guards/email-verified.guard.ts` | Downstream guard that gates protected routes on `emailVerified` |
| `prisma/schema.prisma`        | `EmailVerification` model: `userId, code, attempts, used, expiresAt, createdAt` |

---

## 10. Things NOT to change without coordination

- The 10-minute expiry, the 5-attempt cap, or the rate-limit constants
  without a security review.
- The token-reissue step on successful verify — the frontend depends on the
  fact that `emailVerified` flips inside the JWT payload immediately.
- The "send" → "resend" duplication. The frontend treats them as distinct
  buttons with distinct UX.
- The hash + `timingSafeEqual` comparison. Do not "simplify" to `===`.
