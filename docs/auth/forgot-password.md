# Forgot Password — Backend Spec (awamer-api)

> **Module:** `AuthModule`
> **Endpoint:** `POST /api/v1/auth/forgot-password`
> **Frontend page:** `/auth/forgot-password` (awamer-web)
> **Decorator:** `@Public()`
> **Status code:** `200 OK`

This document describes the forgot-password endpoint as implemented in
`src/auth/auth.controller.ts` and `src/auth/auth.service.ts`. It is the
first half of the password-reset flow; the second half is documented in
[reset-password.md](./reset-password.md).

---

## 1. Summary

The user enters their email on `/auth/forgot-password`. The backend always
returns the same success message regardless of whether the email exists,
to prevent account enumeration. If the email **does** exist, the backend
generates a one-time reset token, hashes it, stores the hash with a
1-hour expiry on the `User` row, and emails the **plaintext** token to the
user as a clickable link.

The frontend then displays the static `/auth/check-email` confirmation
screen (see [check-email.md](./check-email.md)).

---

## 2. Request

```
POST /api/v1/auth/forgot-password
Content-Type: application/json
```

### Body — `ForgotPasswordDto` (`src/auth/dto/forgot-password.dto.ts`)

| Field   | Type     | Required | Validation |
|---------|----------|----------|------------|
| `email` | `string` | yes      | `@IsEmail`, transformed to lowercase + trimmed |

### Example

```json
{ "email": "ahmad@example.com" }
```

---

## 3. Behavior — `AuthService.forgotPassword(dto, ip)`

Source: `src/auth/auth.service.ts` (around lines 276–316).

The method **never** throws to the caller for "user not found" — it returns
silently. The only exceptions that propagate are rate-limit (429) and
validation errors. All other internal failures are caught and logged.

1. **Rate limit check.**
   `checkRateLimit(email, ip, RateLimitType.FORGOT_PASSWORD)` enforces three
   layers (see §6). On a violation it throws `429 RATE_LIMIT_EXCEEDED` with
   a `retryAfter` field — this happens **before** the user lookup so an
   attacker cannot use the rate limit itself as an oracle.
2. **Record the request** in `RateLimitedRequest`
   (`type: FORGOT_PASSWORD`, with `email` and `ip`). The row is always
   created, even if the email does not exist.
3. **Try block — silent on failure:**
   - `prisma.user.findUnique({ where: { email } })`. If absent, **return**
     immediately. The caller is told nothing.
   - Generate a 64-character hex token: `crypto.randomBytes(32).toString('hex')`.
   - SHA-256 hash the token.
   - Update the user row:
     ```ts
     {
       passwordResetToken: hashedToken,
       passwordResetExpires: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS), // 1 hour
     }
     ```
   - `mailService.sendPasswordResetEmail(user.email, resetToken, user.name)`
     — sends the **plaintext** token in the email link.
4. **Catch block:** any error in steps 3.x is caught and logged via
   `Logger.error`. The endpoint still returns a 200 to the client. This is
   intentional: a transient mail outage or DB hiccup must not reveal whether
   the email exists.

### Constants

```ts
RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000 // 1 hour
```

---

## 4. Successful response

The same response is returned for **every** valid call (existing email,
non-existent email, or even an internal error inside the try block):

```
HTTP/1.1 200 OK
```

```json
{
  "data": null,
  "message": "If an account with that email exists, a password reset link has been sent"
}
```

---

## 5. Rate limiting

`@Throttle({ default: { limit: 5, ttl: 60000 } })` on the controller — **5
requests per minute per IP**, enforced by the global `ThrottlerGuard`.

The deeper `checkRateLimit()` (see §6) is the primary defense and is what
the frontend will see most often.

---

## 6. `checkRateLimit()` — three-layer per-row throttle

Identical to the verification flow. Source:
`src/auth/auth.service.ts` `checkRateLimit(email, ip, type)`.

| # | Window     | Scope     | Threshold  | Error returned |
|---|------------|-----------|------------|----------------|
| 1 | 60 seconds | per email | 1 request  | `429 RATE_LIMIT_EXCEEDED`, `retryAfter: <seconds until cooldown ends>` |
| 2 | 1 hour     | per email | 5 requests | `429 RATE_LIMIT_EXCEEDED`, `retryAfter: <seconds until oldest in-window row expires>` |
| 3 | 24 hours   | per IP    | 10 requests| `429 RATE_LIMIT_EXCEEDED`, `retryAfter: <seconds until oldest in-window row expires>` |

`retryAfter` is computed from the oldest row in the offending window and
clamped to a minimum of 1 second.

---

## 7. Error responses

| Status | `errorCode`           | When |
|--------|-----------------------|------|
| 400    | `VALIDATION_FAILED`   | `email` is missing or not a valid email. |
| 429    | `RATE_LIMIT_EXCEEDED` | One of the three layers in `checkRateLimit()` tripped, **or** the global throttler tripped. |

> **No 404 is ever returned for a non-existent email.** The endpoint
> intentionally returns 200 in that case.

---

## 8. Side effects (state mutations)

| Table                | Mutation |
|----------------------|----------|
| `RateLimitedRequest` | INSERT (`type: FORGOT_PASSWORD`, with email + ip) — **always**, even for unknown emails |
| `User`               | UPDATE `passwordResetToken` (hashed) and `passwordResetExpires` — **only if the email exists** |

Plus an outbound SES email containing the plaintext token (only if the email
exists and SES does not error).

> The hashed reset token replaces any previous one on the same user row,
> invalidating any older links that may still be in the user's inbox.

---

## 9. Security notes

- **No user enumeration.** Same response shape and timing on existing vs.
  non-existing emails. The only way an attacker can probe is via the rate
  limit, which is the same for both branches because step 2 always inserts
  the row.
- **Reset token is 256 bits of CSPRNG entropy** (`crypto.randomBytes(32)`).
- **Token is hashed at rest** with SHA-256; the database never holds the
  plaintext.
- **1-hour expiry** is enforced on the consumer side
  (`reset-password` checks `passwordResetExpires > now`).
- **Old tokens are silently overwritten** when a new one is generated.
- **Failures are swallowed** in the try/catch so a transient outage cannot
  be turned into an enumeration oracle.

---

## 10. Files involved

| File | Role |
|------|------|
| `src/auth/auth.controller.ts` | `forgotPassword()` route |
| `src/auth/auth.service.ts`    | `forgotPassword()` business logic, `checkRateLimit()` |
| `src/auth/dto/forgot-password.dto.ts` | Request validation |
| `src/mail/mail.service.ts`    | Sends the reset email via AWS SES |
| `prisma/schema.prisma`        | `User.passwordResetToken`, `User.passwordResetExpires`; `RateLimitedRequest` model |

---

## 11. Things NOT to change without coordination

- The "always-200" behavior on unknown emails. Surfacing a 404 (or even a
  different message) here is a user-enumeration vulnerability.
- The fact that the rate-limit check + insert happens **before** the user
  lookup. Reversing the order would let attackers enumerate by observing
  which calls cost a row in `RateLimitedRequest`.
- The 1-hour expiry without a security review.
- The plaintext-token-in-email pattern. Storing the plaintext in the DB
  would defeat the SHA-256 hashing.
