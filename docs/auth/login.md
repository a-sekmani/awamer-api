# Login — Backend Spec (awamer-api)

> **Module:** `AuthModule`
> **Endpoint:** `POST /api/v1/auth/login`
> **Frontend page:** `/auth/login` (awamer-web)
> **Decorator:** `@Public()`
> **Status code:** `200 OK`

This document describes the login endpoint as implemented in
`src/auth/auth.controller.ts` and `src/auth/auth.service.ts`.

---

## 1. Summary

`login` authenticates an existing user by email + password and, on success,
issues a fresh access/refresh token pair. Failed attempts are tracked on the
`User` row; after 10 consecutive failures the account is locked for 15
minutes. Login itself is **not** gated by `emailVerified`: an unverified user
can still log in (so the frontend can route them to `/auth/verify-email`),
but they will be blocked by `EmailVerifiedGuard` from accessing protected
features.

---

## 2. Request

```
POST /api/v1/auth/login
Content-Type: application/json
```

### Body — `LoginDto` (`src/auth/dto/login.dto.ts`)

| Field        | Type      | Required | Validation |
|--------------|-----------|----------|------------|
| `email`      | `string`  | yes      | `@IsEmail`, transformed to lowercase + trimmed |
| `password`   | `string`  | yes      | `@IsString`, `@IsNotEmpty`, `@MaxLength(128)` |
| `rememberMe` | `boolean?`| no       | extends refresh token TTL from 7d → 30d |

### Example

```json
{ "email": "ahmad@example.com", "password": "Strong#Pass1", "rememberMe": false }
```

---

## 3. Behavior — `AuthService.login()`

Source: `src/auth/auth.service.ts` (around lines 135–204).

The flow is intentionally written so that a **non-existent email** and a
**wrong password** take roughly the same time and return the **same error
shape**, to prevent user enumeration.

1. **Lookup user** by email.
2. **If user does not exist:**
   - Run `bcrypt.compare(dto.password, DUMMY_HASH)` to spend the same CPU
     time as a real comparison (timing-safe negative).
   - Throw `UnauthorizedException` with `errorCode: INVALID_CREDENTIALS`.
3. **If user.status !== 'ACTIVE':** throw `INVALID_CREDENTIALS` (do not
   reveal that the account is suspended/deleted).
4. **If user.lockedUntil > now:** throw `INVALID_CREDENTIALS` (do not
   reveal that the account is locked).
5. **Compare password** with `bcrypt.compare(dto.password, user.passwordHash)`.
6. **On password mismatch:**
   - Increment `failedLoginAttempts`.
   - If the new count is `>= LOGIN_MAX_FAILED_ATTEMPTS` (10), set
     `lockedUntil = now + LOGIN_LOCKOUT_DURATION_MS` (15 minutes).
   - Persist both fields in a single update.
   - Throw `INVALID_CREDENTIALS`.
7. **On password match:**
   - Call `generateTokens(user, rememberMe)` (see register.md §3 step 6
     for the full description). This signs the JWTs, hashes the refresh
     token, and persists the hash on `user.refreshToken`.
   - Update `user`: set `lastLoginAt = now`, reset `failedLoginAttempts = 0`,
     clear `lockedUntil`.
8. **Return** `{ user: sanitizeUser(user), accessToken, refreshToken, cookieMaxAge }`
   where `cookieMaxAge` is `30d` if `rememberMe` is true, else `7d`.

`sanitizeUser()` returns `{ id, name, email, country, locale, status, emailVerified, requiresVerification }`.

### Constants

```ts
LOGIN_MAX_FAILED_ATTEMPTS  = 10
LOGIN_LOCKOUT_DURATION_MS  = 15 * 60 * 1000      // 15 minutes
REFRESH_TOKEN_EXPIRY_DEFAULT  = '7d'
REFRESH_TOKEN_EXPIRY_REMEMBER = '30d'
COOKIE_MAX_AGE_DEFAULT  = 7  * 24 * 60 * 60 * 1000
COOKIE_MAX_AGE_REMEMBER = 30 * 24 * 60 * 60 * 1000
```

---

## 4. Cookies set by the controller

Identical to `register`. The controller calls
`setCookies(res, accessToken, refreshToken, cookieMaxAge)`:

| Cookie          | Attributes |
|-----------------|------------|
| `access_token`  | `httpOnly`, `secure` (prod), `sameSite: 'strict'`, `path: '/'`, `maxAge: 900_000` (15 min hardcoded) |
| `refresh_token` | `httpOnly`, `secure` (prod), `sameSite: 'strict'`, `path: '/api/v1/auth'`, `maxAge: cookieMaxAge` |

---

## 5. Rate limiting

`@Throttle({ default: { limit: 5, ttl: 60000 } })` — **5 requests per
minute per IP**, enforced by the global `ThrottlerGuard`. The lockout
counter is the second layer (per-account, not per-IP).

---

## 6. Successful response

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "Ahmad Sekmani",
      "email": "ahmad@example.com",
      "country": "SA",
      "locale": "ar",
      "status": "ACTIVE",
      "emailVerified": true,
      "requiresVerification": false
    }
  },
  "message": "Login successful"
}
```

The frontend uses `requiresVerification` and the JWT payload's
`onboardingCompleted` to choose where to redirect:

```
emailVerified === false → /auth/verify-email
onboardingCompleted === false → /onboarding
otherwise → /dashboard
```

---

## 7. Error responses

| Status | `errorCode`            | When |
|--------|------------------------|------|
| 400    | `VALIDATION_FAILED`    | DTO validation rejected the body. |
| 401    | `INVALID_CREDENTIALS`  | Unknown email, suspended account, locked account, or wrong password — **all collapse to the same error** to prevent enumeration. |
| 429    | `RATE_LIMIT_EXCEEDED`  | More than 5 login calls per minute from the same IP. |

> The `User.lockedUntil` field is **not** exposed to the client in any way.
> The frontend cannot tell a "wrong password" apart from a "locked" account.

---

## 8. Side effects (state mutations)

| Table              | Mutation |
|--------------------|----------|
| `User`             | UPDATE `lastLoginAt`, `failedLoginAttempts`, `lockedUntil`, `refreshToken` (on success) |
| `User`             | UPDATE `failedLoginAttempts` (and possibly `lockedUntil`) on failure |

No `RateLimitedRequest` row is created — login uses only the throttler.

---

## 9. Security notes

- **No user enumeration:** all four failure cases (unknown email, inactive,
  locked, wrong password) return the same status, message, and `errorCode`.
- **Constant-time path on unknown email:** `bcrypt.compare(_, DUMMY_HASH)`
  is called so an attacker cannot distinguish "email exists" from "email
  doesn't exist" by timing.
- **Bcrypt cost 12** for the real and dummy hash.
- **Account lockout** is only on login (not on register, refresh, etc.).
- **Refresh token rotation** happens on every successful login: a freshly
  signed refresh token replaces the previous one in `user.refreshToken`.

---

## 10. Files involved

| File | Role |
|------|------|
| `src/auth/auth.controller.ts` | `login()` route, cookie writing |
| `src/auth/auth.service.ts`    | Business logic, lockout, token generation |
| `src/auth/dto/login.dto.ts`   | Request validation |
| `src/auth/strategies/jwt.strategy.ts` | Issued access token is verified here on subsequent calls |
| `src/common/error-codes.enum.ts` | `INVALID_CREDENTIALS` |
| `src/common/filters/http-exception.filter.ts` | Normalizes errors |
| `src/common/interceptors/response-transform.interceptor.ts` | Wraps body |

---

## 11. Things NOT to change without coordination

- The "all errors collapse to `INVALID_CREDENTIALS`" rule. Surfacing more
  specific errors here is a user-enumeration vulnerability.
- The `bcrypt.compare(_, DUMMY_HASH)` call on the unknown-email branch.
- The lockout thresholds without a security review.
- Cookie names and attributes (asserted by e2e tests in
  `test/auth.e2e-spec.ts`).
- The JWT payload shape (consumed by guards and the frontend).
