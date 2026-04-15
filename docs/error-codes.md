# Error Codes — Backend Reference (awamer-api)

This document is the full catalog of every value declared in
`src/common/error-codes.enum.ts`, the HTTP status each is returned with,
a one-sentence description of when it is thrown, and the service method
(or DTO) that throws it.

The `ErrorCode` enum is the **machine-readable** half of the error
contract. The string `message` is a human description and is not
suitable for conditional frontend logic. When the frontend needs to
branch on "what went wrong", it branches on `errorCode`.

---

## 1. The enum

Source: `src/common/error-codes.enum.ts` (verbatim).

```ts
export enum ErrorCode {
  // Auth
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  WEAK_PASSWORD = 'WEAK_PASSWORD',
  MISSING_REQUIRED_FIELDS = 'MISSING_REQUIRED_FIELDS',
  INVALID_EMAIL_FORMAT = 'INVALID_EMAIL_FORMAT',
  INVALID_RESET_TOKEN = 'INVALID_RESET_TOKEN',
  INVALID_SESSION = 'INVALID_SESSION',
  UNAUTHORIZED = 'UNAUTHORIZED',

  // Users
  WRONG_CURRENT_PASSWORD = 'WRONG_CURRENT_PASSWORD',
  INVALID_LOCALE = 'INVALID_LOCALE',
  ONBOARDING_ALREADY_COMPLETED = 'ONBOARDING_ALREADY_COMPLETED',
  ONBOARDING_REQUIRED = 'ONBOARDING_REQUIRED',
  EMPTY_ONBOARDING_RESPONSES = 'EMPTY_ONBOARDING_RESPONSES',
  INVALID_BACKGROUND = 'INVALID_BACKGROUND',
  INVALID_GOALS = 'INVALID_GOALS',

  // General
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

**18 values.** No new `ErrorCode` values were introduced during epic E3
(KAN-70 → KAN-26). The new content/enrollment/cache/discovery modules
deliberately reuse the general-purpose codes and rely on
`NotFoundException`, `ForbiddenException`, and `ConflictException` for
anything more specific.

---

## 2. Auth codes

### `INVALID_CREDENTIALS`
- **HTTP status:** `401`
- **When:** Unknown email, inactive user, locked account, or wrong
  password — all four failure modes collapse to this code to prevent
  user enumeration.
- **Thrown by:** `AuthService.login()` in `src/auth/auth.service.ts`.
- **Reference:** [auth/login.md](./auth/login.md).

### `EMAIL_ALREADY_EXISTS`
- **HTTP status:** `409`
- **When:** Register body carries an email that already matches an
  existing `User` row (case-insensitive — emails are lowercased on write).
- **Thrown by:** `AuthService.register()`.
- **Reference:** [auth/register.md](./auth/register.md).

### `VALIDATION_FAILED`
- **HTTP status:** `400`
- **When:** Class-validator rejected the DTO. Auto-assigned by
  `HttpExceptionFilter` whenever the exception response's `message` is
  an array (the Nest default shape for validation errors). The offending
  constraint strings are placed on `errors[]`.
- **Thrown by:** Global `ValidationPipe` on every endpoint.
- **Reference:** [api-conventions.md §3](./api-conventions.md),
  [api-conventions.md §9](./api-conventions.md).

### `WEAK_PASSWORD`
- **HTTP status:** `400`
- **When:** Declared in the enum for symmetry with the frontend form.
  The register DTO enforces password complexity via `@Matches(...)` and
  raises `VALIDATION_FAILED` instead of `WEAK_PASSWORD`. **No service
  method throws `WEAK_PASSWORD`** in the current codebase.
- **Thrown by:** (unused)

### `MISSING_REQUIRED_FIELDS`
- **HTTP status:** `400`
- **When:** Declared for frontend symmetry. In practice, missing
  required fields are caught by class-validator and surface as
  `VALIDATION_FAILED`. **No service method throws
  `MISSING_REQUIRED_FIELDS`**.
- **Thrown by:** (unused)

### `INVALID_EMAIL_FORMAT`
- **HTTP status:** `400`
- **When:** Declared for frontend symmetry. `@IsEmail()` on register /
  login / forgot-password DTOs surfaces as `VALIDATION_FAILED`. **No
  service method throws `INVALID_EMAIL_FORMAT`**.
- **Thrown by:** (unused)

### `INVALID_RESET_TOKEN`
- **HTTP status:** `400`
- **When:** The reset-password token is missing, malformed, expired, or
  does not match a `User.passwordResetToken` row.
- **Thrown by:** `AuthService.resetPassword()`.
- **Reference:** [auth/reset-password.md](./auth/reset-password.md).

### `INVALID_SESSION`
- **HTTP status:** `401`
- **When:** Refresh endpoint receives a refresh token whose bcrypt hash
  does not match the one stored on `User.refreshToken`, or no token
  row exists.
- **Thrown by:** `AuthService.refresh()`.

### `UNAUTHORIZED`
- **HTTP status:** `401`
- **When:** Generic "you are not logged in" — reserved for manual service
  throws when a more specific code does not apply. In practice most
  unauthenticated requests are blocked upstream by `JwtAuthGuard` and
  surface as a plain `401` without an `errorCode` field.
- **Thrown by:** ad-hoc.

---

## 3. User / onboarding codes

### `WRONG_CURRENT_PASSWORD`
- **HTTP status:** `400`
- **When:** `PATCH /users/me/password` is called with a `currentPassword`
  that does not match the stored bcrypt hash.
- **Thrown by:** `UsersService.changePassword()`.

### `INVALID_LOCALE`
- **HTTP status:** `400`
- **When:** `PATCH /users/me` receives a `locale` not in the accepted
  list (`ar`, `en`).
- **Thrown by:** `UsersService.updateUser()`.

### `ONBOARDING_ALREADY_COMPLETED`
- **HTTP status:** `400`
- **When:** The conditional `updateMany` lock in `submitOnboarding`
  finds `count === 0` — either the user already finished onboarding
  before this call, or a concurrent submission won the race.
- **Thrown by:** `UsersService.submitOnboarding()`.
- **Reference:** [onboarding/submit-onboarding.md §3.3](./onboarding/submit-onboarding.md).

### `ONBOARDING_REQUIRED`
- **HTTP status:** `403`
- **When:** Declared for use by a future guard that blocks learning
  endpoints until onboarding is complete. Currently unused — the
  frontend enforces the redirect.
- **Thrown by:** (unused)

### `EMPTY_ONBOARDING_RESPONSES`
- **HTTP status:** `400`
- **When:** Declared for symmetry with the frontend form. The current
  DTO requires `@ArrayMinSize(3)`, so an empty array surfaces as
  `VALIDATION_FAILED`. **No service method throws
  `EMPTY_ONBOARDING_RESPONSES`**.
- **Thrown by:** (unused)

### `INVALID_BACKGROUND`
- **HTTP status:** `400`
- **When:** `submitOnboarding` finds the `background` answer is not in
  `VALID_BACKGROUNDS`.
- **Thrown by:** `UsersService.submitOnboarding()`.
- **Reference:** [onboarding/step-1-background.md](./onboarding/step-1-background.md).

### `INVALID_GOALS`
- **HTTP status:** `400`
- **When:** `submitOnboarding` finds the `goals` answer is not in
  `VALID_GOALS`.
- **Thrown by:** `UsersService.submitOnboarding()`.
- **Reference:** [onboarding/step-3-goals.md](./onboarding/step-3-goals.md).

---

## 4. General codes

### `RATE_LIMIT_EXCEEDED`
- **HTTP status:** `429`
- **When:** Either the global `ThrottlerGuard` has tripped on a
  per-route `@Throttle()` limit, or `AuthService.checkRateLimit()` has
  tripped one of its three per-row layers. The filter copies
  `retryAfter` (if present) onto the `Retry-After` HTTP header.
- **Thrown by:** `ThrottlerGuard` (global), `AuthService.checkRateLimit()`
  (forgot-password, send-verification).
- **Reference:** [api-conventions.md §8](./api-conventions.md),
  [auth/verify-email.md §6](./auth/verify-email.md).

### `INTERNAL_ERROR`
- **HTTP status:** `500`
- **When:** Any unhandled non-`HttpException` exception bubbles up to
  `HttpExceptionFilter`. The real error is logged with stack; the
  client only sees `"An unexpected error occurred"`.
- **Thrown by:** `HttpExceptionFilter` itself (the catch-all branch).

---

## 5. Errors without an `errorCode`

Many endpoints added during epic E3 raise domain errors **without**
attaching an `ErrorCode`. They rely on the HTTP status and the human
`message` string alone. This is a deliberate convention for modules
whose error space is narrow enough that the frontend can branch on the
status:

| Module | Pattern |
|--------|---------|
| Tags (`src/content/tags/`) | `NotFoundException('Tag not found')`, `ConflictException('Tag slug already exists')` — no `errorCode`. |
| Marketing (`src/content/marketing/*`) | `NotFoundException`, `BadRequestException('Owner not found')`, `BadRequestException('ids must cover every <type> for the owner')` — no `errorCode`. |
| Enrollment (`src/enrollment/`) | `NotFoundException`, `ConflictException('Already enrolled')`, `BadRequestException` with `parentPathId` passthrough — no `errorCode`. |
| Learning / Progress (`src/learning/`, `src/progress/`) | `NotFoundException`, `BadRequestException('Lesson already completed')` — no `errorCode`. |
| Certificates (`src/certificates/`) | `NotFoundException('Certificate not found')` — no `errorCode`. |
| Public discovery (`src/content/categories/`, `paths/`, `courses/`) | `NotFoundException('Path not found')` etc. — no `errorCode`. |

When adding a new module, you do not need to introduce a new `ErrorCode`
value unless the frontend needs to discriminate two errors that share a
status code. If a single human message is enough, throw a plain
`NotFoundException` / `BadRequestException` / `ConflictException` and
leave `errorCode` unset.

---

## 6. Files involved

| File | Role |
|------|------|
| `src/common/error-codes.enum.ts` | The enum itself |
| `src/common/filters/http-exception.filter.ts` | Reads `errorCode` / `retryAfter` / passthrough keys from exception responses; writes the final error body |
| `src/auth/auth.service.ts` | Throws the majority of the enum values |
| `src/users/users.service.ts` | Throws the onboarding / password / locale codes |

---

## 7. Things NOT to change without coordination

- The string values of existing enum members. The frontend form logic
  compares on these strings; renaming is a breaking change.
- The "one error code, one meaning" rule. Do not reuse
  `INVALID_CREDENTIALS` for anything outside login. Do not reuse
  `VALIDATION_FAILED` for business-rule violations.
- The "unused for frontend symmetry" entries (`WEAK_PASSWORD`,
  `MISSING_REQUIRED_FIELDS`, `INVALID_EMAIL_FORMAT`,
  `EMPTY_ONBOARDING_RESPONSES`, `ONBOARDING_REQUIRED`). Do not delete
  them without confirming the frontend no longer references them.
