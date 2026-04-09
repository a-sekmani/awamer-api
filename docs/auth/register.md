# Register — Backend Spec (awamer-api)

> **Module:** `AuthModule`
> **Endpoint:** `POST /api/v1/auth/register`
> **Frontend page:** `/auth/register` (awamer-web)
> **Decorator:** `@Public()` — does not require an existing JWT
> **Status code:** `201 Created`

This document describes the registration endpoint as implemented in
`src/auth/auth.controller.ts` and `src/auth/auth.service.ts`. It is intended as
a complete reference for any developer or AI agent who needs to read, modify,
or consume the endpoint.

---

## 1. Summary

`register` creates a brand new user account. In a single atomic Prisma
transaction it provisions:

1. The `User` row (hashed password, country, IP for geoip).
2. The `UserProfile` row (`onboardingCompleted: false`).
3. A `UserRole` row with role `LEARNER`.
4. A `Subscription` row pointing at the default subscription plan
   (only if a plan with `isDefault: true` exists).

After the transaction commits, the service issues a JWT access token and
refresh token, persists the hashed refresh token on the user row, and
attempts to send a verification code by email. The controller writes both
tokens to httpOnly cookies. The new account is **active but
`emailVerified: false`** — protected routes guarded by `EmailVerifiedGuard`
will refuse it until the verification flow completes.

---

## 2. Request

### HTTP

```
POST /api/v1/auth/register
Content-Type: application/json
```

### Body — `RegisterDto` (`src/auth/dto/register.dto.ts`)

| Field        | Type      | Required | Validation |
|--------------|-----------|----------|------------|
| `name`       | `string`  | yes      | `@IsString`, `@IsNotEmpty`, `@MaxLength(100)` |
| `email`      | `string`  | yes      | `@IsEmail`, `@MaxLength(255)`, transformed to lowercase + trimmed |
| `password`   | `string`  | yes      | `@MinLength(8)`, `@MaxLength(128)`, must match `(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{}\|;:'",.<>?/\\\`~])` |
| `country`    | `string?` | no       | `@MaxLength(100)` — falls back to geoip detection if absent |
| `rememberMe` | `boolean?`| no       | extends refresh-token TTL from 7d → 30d |

> The global `ValidationPipe` is configured with `whitelist: true` and
> `forbidNonWhitelisted: true` (`src/main.ts`), so any unknown field on the
> request body causes a 400 `VALIDATION_FAILED`.

### Example

```json
{
  "name": "Ahmad Sekmani",
  "email": "ahmad@example.com",
  "password": "Strong#Pass1",
  "country": "SA",
  "rememberMe": true
}
```

---

## 3. Behavior — `AuthService.register()`

Source: `src/auth/auth.service.ts` (around lines 56–133).

1. **Email uniqueness check.** `prisma.user.findUnique({ where: { email } })`.
   If a row exists, throw `ConflictException` with
   `errorCode: ErrorCode.EMAIL_ALREADY_EXISTS`.
2. **Password hashing.** `bcrypt.hash(dto.password, BCRYPT_ROUNDS)` where
   `BCRYPT_ROUNDS = 12`.
3. **Country resolution.** If `dto.country` is missing, the service calls
   `GeoipService.getCountryFromIp(ip)` using the request IP.
   `detectedCountry` is always stored separately on the `User` row for audit.
4. **Default plan lookup.** `prisma.subscriptionPlan.findFirst({ where: { isDefault: true } })`.
   The result is used inside the transaction below; if no default plan exists
   the user is still created — the subscription step is simply skipped.
5. **Atomic provisioning transaction.** Inside `prisma.$transaction`:
   - Create `User` (status defaults to `ACTIVE`, `emailVerified: false`).
   - Create `UserProfile` with `onboardingCompleted: false`.
   - Create `UserRole` with role `LEARNER`.
   - Create `Subscription` linked to the default plan (if any) with status `ACTIVE`.
6. **Token generation.** Calls the private `generateTokens(user, rememberMe)`:
   - Loads `userRoles` and `userProfile.onboardingCompleted` in parallel.
   - Builds the JWT payload `{ sub, email, emailVerified, onboardingCompleted, roles }`.
   - Signs the access token with `JWT_SECRET` (`expiresIn` from `JWT_EXPIRATION`,
     default 900s).
   - Signs the refresh token with `JWT_REFRESH_SECRET`. `expiresIn` is `'7d'`
     by default or `'30d'` when `rememberMe` is true.
   - Hashes the refresh token with bcrypt and persists it to `user.refreshToken`.
7. **Send verification code (best-effort).** Calls
   `sendVerificationCode(user.id)` (no IP — skips per-IP rate limiting on
   the very first send). Failures are caught and logged via `Logger.error`
   so a transient mail outage cannot break registration.
8. **Return** `{ user: sanitizeUser(user), accessToken, refreshToken, cookieMaxAge }`
   to the controller. `cookieMaxAge` is `COOKIE_MAX_AGE_REMEMBER` (30d) when
   `rememberMe` is true, otherwise `COOKIE_MAX_AGE_DEFAULT` (7d).

`sanitizeUser()` strips `passwordHash`, `refreshToken`, and any other
sensitive fields, exposing only:

```
{ id, name, email, country, locale, status, emailVerified, requiresVerification }
```

`requiresVerification` is computed as `!user.emailVerified`.

---

## 4. Cookies set by the controller

Source: `src/auth/auth.controller.ts` `setCookies(...)`.

| Cookie          | Value         | Attributes |
|-----------------|---------------|------------|
| `access_token`  | JWT (HS256)   | `httpOnly: true`, `secure: <NODE_ENV === 'production'>`, `sameSite: 'strict'`, `path: '/'`, `maxAge: 900_000` (15 minutes — hardcoded) |
| `refresh_token` | JWT (HS256)   | `httpOnly: true`, `secure: <NODE_ENV === 'production'>`, `sameSite: 'strict'`, `path: '/api/v1/auth'`, `maxAge: cookieMaxAge` (7d default, 30d remember-me) |

The refresh cookie is restricted to the `/api/v1/auth` path so it is sent
only with auth endpoints (refresh, logout). The access cookie is scoped to
`/` so all API calls receive it.

---

## 5. Rate limiting

Defined on the controller method via `@Throttle({ default: { limit: 10, ttl: 60000 } })`
— **10 requests per minute per IP**, enforced by the global `ThrottlerGuard`.

There is no per-email rate limit on register itself (uniqueness is enforced
in step 1). The downstream `sendVerificationCode` call is **not** rate
limited during register because no IP is passed in.

---

## 6. Successful response

```
HTTP/1.1 201 Created
Set-Cookie: access_token=...; HttpOnly; Path=/; SameSite=Strict
Set-Cookie: refresh_token=...; HttpOnly; Path=/api/v1/auth; SameSite=Strict
Content-Type: application/json
```

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
      "emailVerified": false,
      "requiresVerification": true
    }
  },
  "message": "Registration successful"
}
```

The wrapping `{ data, message }` shape is produced by the global
`ResponseTransformInterceptor`.

---

## 7. Error responses

All errors are normalized by `HttpExceptionFilter` to:

```json
{ "statusCode": 400, "message": "...", "errorCode": "...", "errors": [ ... ]? }
```

| Status | `errorCode`            | When |
|--------|------------------------|------|
| 400    | `VALIDATION_FAILED`    | DTO validation rejected the body (missing field, weak password, unknown field, etc.). `errors[]` lists the offending properties. |
| 409    | `EMAIL_ALREADY_EXISTS` | A user with the same lowercased email already exists. |
| 429    | `RATE_LIMIT_EXCEEDED`  | More than 10 register calls per minute from the same IP. |
| 500    | `INTERNAL_ERROR`       | Unhandled exception in the transaction. |

> A failure inside `sendVerificationCode` is **not** propagated. The user is
> still created and tokens are still issued; the verification step can be
> retried via `POST /api/v1/auth/resend-verification`.

---

## 8. Side effects (state mutations)

A successful register call mutates the database as follows:

| Table                  | Mutation |
|------------------------|----------|
| `User`                 | INSERT (status `ACTIVE`, `emailVerified: false`) |
| `UserProfile`          | INSERT (`onboardingCompleted: false`) |
| `UserRole`             | INSERT (`LEARNER`) |
| `Subscription`         | INSERT (only if default plan exists) |
| `EmailVerification`    | UPDATE existing rows for the user → `used: true`; INSERT new row with hashed 6-digit code |
| `User.refreshToken`    | UPDATE — stores the bcrypt hash of the issued refresh token |

Plus an outbound SES email containing the 6-digit verification code (if the
mail step succeeds).

---

## 9. Downstream flow (client perspective)

```
register
   ├─ 201 → cookies set, requiresVerification = true
   └─ frontend redirects to /auth/verify-email
        └─ user enters code → POST /auth/verify-email
              └─ on success: emailVerified = true, new tokens reissued
                    └─ frontend redirects to /onboarding
                          └─ POST /users/me/onboarding
                                └─ frontend redirects to /dashboard
```

---

## 10. Files involved

| File | Role |
|------|------|
| `src/auth/auth.controller.ts` | `register()` route, cookie writing |
| `src/auth/auth.service.ts`    | Business logic, transaction, token generation |
| `src/auth/dto/register.dto.ts`| Request validation |
| `src/auth/strategies/jwt.strategy.ts` | Issued access token is verified here on subsequent calls |
| `src/common/geoip.service.ts` | Resolves IP → country code |
| `src/mail/mail.service.ts`    | Sends the verification email via AWS SES |
| `src/common/error-codes.enum.ts` | `EMAIL_ALREADY_EXISTS`, `VALIDATION_FAILED` |
| `src/common/filters/http-exception.filter.ts` | Normalizes errors |
| `src/common/interceptors/response-transform.interceptor.ts` | Wraps body in `{ data, message }` |

---

## 11. Things NOT to change without coordination

- Cookie names (`access_token` / `refresh_token`) — hard-coded in
  `JwtStrategy` and asserted by e2e tests.
- Cookie attributes (`httpOnly`, `sameSite: 'strict'`, paths) — security
  invariants asserted by the e2e suite.
- The shape of the JWT payload — consumed by `JwtAuthGuard`,
  `EmailVerifiedGuard`, `RolesGuard`, and the frontend `useAuth` hook.
- The transaction scope in `register()` — splitting it would allow
  half-created accounts (User without UserProfile, etc.) and break the
  invariants every other module assumes.
