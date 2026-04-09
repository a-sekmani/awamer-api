# Submit Onboarding — Backend Spec (awamer-api)

> **Module:** `UsersModule`
> **Endpoint:** `POST /api/v1/users/me/onboarding`
> **Frontend page:** `/onboarding` (awamer-web) — final "Submit" action of step 3
> **Guards:** `JwtAuthGuard` (controller-level) + `EmailVerifiedGuard` (route-level)
> **Status code:** `200 OK`

This document describes the single endpoint that submits all three
onboarding stages atomically. For the per-stage data contracts see
[step-1-background.md](./step-1-background.md),
[step-2-interests.md](./step-2-interests.md),
[step-3-goals.md](./step-3-goals.md).

---

## 1. Summary

`submitOnboarding` ingests the user's answers for **all three** steps in
a single request, validates them, persists them inside one atomic Prisma
transaction, rotates the user's refresh token (so the new
`onboardingCompleted: true` lands in the JWT payload immediately), fires
the `onboarding_completed` analytics event, and returns the updated
profile. The transaction uses a conditional `updateMany` as a lock to
prevent a TOCTOU race between concurrent submissions.

The endpoint is **idempotent at the source** in the sense that any
existing `OnboardingResponse` rows for the user are deleted and
recreated inside the same transaction — but it is **not** retryable
after first success. The conditional `updateMany` ensures only one call
per user can flip `onboardingCompleted` from `false` → `true`. All
subsequent submissions throw `ONBOARDING_ALREADY_COMPLETED`.

---

## 2. Request

```
POST /api/v1/users/me/onboarding
Content-Type: application/json
Cookie: access_token=<JWT>
```

### Auth

- `JwtAuthGuard` (declared at the controller class level on
  `UsersController`) requires a valid access token.
- `EmailVerifiedGuard` (declared on this specific route) further
  requires `req.user.emailVerified === true`. Unverified users get
  blocked with the guard's standard error before the handler runs.

### Body — `SubmitOnboardingDto` (`src/users/dto/onboarding.dto.ts`)

| Field       | Type                            | Validation |
|-------------|---------------------------------|------------|
| `responses` | `OnboardingResponseItemDto[]`   | `@IsArray`, `@ArrayMinSize(3)`, `@ArrayMaxSize(3)`, `@ValidateNested({ each: true })`, `@Type(() => OnboardingResponseItemDto)` |

The array must contain **exactly 3** entries — one per stage. Order
within the array is **not** enforced by validation; the service looks
each entry up by `questionKey`. The frontend conventionally sends them
in step order for readability.

The global `ValidationPipe` is configured with `whitelist: true` and
`forbidNonWhitelisted: true`, so any unknown top-level field rejects the
request as `VALIDATION_FAILED`.

### Example body

```json
{
  "responses": [
    { "questionKey": "background", "answer": "student", "stepNumber": 1 },
    { "questionKey": "interests", "items": ["ai", "programming", "cloud_devops"], "stepNumber": 2 },
    { "questionKey": "goals", "answer": "learn_new_skill", "stepNumber": 3 }
  ]
}
```

---

## 3. Behavior — `UsersService.submitOnboarding(userId, dto)`

Source: `src/users/users.service.ts` (around lines 110–260).

The flow is split into three phases: **validation**, **token pre-sign**,
and **atomic write**.

### 3.1 Validation phase

1. **All 3 required keys present.** Build a list of `questionKey`s from
   `dto.responses`. For each of `'background'`, `'interests'`, `'goals'`,
   throw `BadRequestException("Missing required questionKey: <name>")`
   if absent.
2. **Look up each entry by key.** `dto.responses.find(r => r.questionKey === '<name>')`.
3. **Step number consistency.**
   - background → `stepNumber === 1` (else throw).
   - interests → `stepNumber === 2` (else throw).
   - goals → `stepNumber === 3` (else throw).
4. **Background enum membership.** `backgroundResponse.answer` must be
   in `VALID_BACKGROUNDS`. Else throw `INVALID_BACKGROUND` (`field: 'background'`).
5. **Goals enum membership.** `goalsResponse.answer` must be in
   `VALID_GOALS`. Else throw `INVALID_GOALS` (`field: 'goals'`).
6. **Interests** are not re-validated by the service. The DTO's
   `@ValidateIf` decorators have already enforced length 1–4,
   uniqueness, string-each, and enum membership.

### 3.2 Token pre-sign phase

7. **Load the user with roles.** Throw if not found.
8. **Build a JWT payload** with `onboardingCompleted: true` (the
   payload reflects the future state):
   ```ts
   { sub, email, emailVerified, onboardingCompleted: true, roles }
   ```
9. **Sign access token** with `JWT_SECRET` (default expiry from
   `JWT_EXPIRATION`).
10. **Sign refresh token** with `JWT_REFRESH_SECRET`, `expiresIn: '7d'`
    (`REFRESH_TOKEN_EXPIRY_DEFAULT`). The submit endpoint does **not**
    preserve any "remember me" choice from login.
11. **Bcrypt-hash the refresh token** with `BCRYPT_ROUNDS = 12`. The
    hash will be persisted inside the transaction below so the cookie
    sent to the client and the row in the DB are guaranteed to belong
    to the same successful submission.

### 3.3 Atomic write phase

12. **Serialize interests once:** `JSON.stringify(interestsItems)`. The
    same string is written to both `UserProfile.interests` and the
    matching `OnboardingResponse.answer` row (see
    [step-2-interests.md](./step-2-interests.md) §5).
13. **Open transaction** `prisma.$transaction(async (tx) => { ... })`:
    a. **Conditional `updateMany` as lock:**
    ```ts
    tx.userProfile.updateMany({
      where: { userId, onboardingCompleted: false },
      data: {
        background: backgroundResponse.answer,
        goals: goalsResponse.answer,
        interests: interestsSerialized,
        onboardingCompleted: true,
      },
    });
    ```
    Only one concurrent caller will see `count > 0`. The loser sees
    `count === 0` and throws `ONBOARDING_ALREADY_COMPLETED`, which
    rolls the transaction back without writing anything, without
    firing analytics, and without rotating refresh tokens. This is the
    TOCTOU defense.
    b. **Wipe existing onboarding responses:**
       `tx.onboardingResponse.deleteMany({ where: { userId } })`.
    c. **Insert the 3 new responses:**
    ```ts
    tx.onboardingResponse.createMany({
      data: dto.responses.map(r => ({
        userId,
        questionKey: r.questionKey,
        answer: r.questionKey === 'interests'
          ? interestsSerialized      // JSON-stringified array
          : (r.answer as string),    // background/goals plain string
        stepNumber: r.stepNumber,
      })),
    });
    ```
    d. **Rotate the refresh token in the same transaction:**
    ```ts
    tx.user.update({ where: { id: userId }, data: { refreshToken: hashedRefreshToken } });
    ```
    e. **Return the updated profile:**
       `tx.userProfile.findUnique({ where: { userId } })`.
14. **After commit — fire analytics.**
    `analyticsService.capture(userId, 'onboarding_completed')`. Only
    fires if the transaction committed (i.e. this request was the
    winner of any concurrent race).
15. **Return** `{ profile, accessToken, refreshToken }` to the controller.

---

## 4. Cookies set by the controller

`UsersController.submitOnboarding()` (in `src/users/users.controller.ts`)
takes the `accessToken` and `refreshToken` returned by the service and
writes them as httpOnly cookies via the private `setCookies()` method:

| Cookie          | Attributes |
|-----------------|------------|
| `access_token`  | `httpOnly`, `secure` (prod), `sameSite: 'strict'`, `path: '/'`, `maxAge: 15 * 60 * 1000` (15 min) |
| `refresh_token` | `httpOnly`, `secure` (prod), `sameSite: 'strict'`, `path: '/api/v1/auth'`, `maxAge: 7 * 24 * 60 * 60 * 1000` (7 days) |

This is the same scheme as the auth controller. Rotating the cookies on
this endpoint is critical: without it, the client would still hold a
JWT with `onboardingCompleted: false` and would be looped back to
`/onboarding` by the frontend redirect logic.

---

## 5. Rate limiting

`@Throttle({ default: { limit: 5, ttl: 60000 } })` — **5 requests per
minute per IP**, enforced by the global `ThrottlerGuard`. Combined with
the conditional-`updateMany` lock, this is sufficient to absorb both
double-submit accidents and brute-force attempts.

---

## 6. Successful response

```
HTTP/1.1 200 OK
Set-Cookie: access_token=...; HttpOnly; Path=/; SameSite=Strict
Set-Cookie: refresh_token=...; HttpOnly; Path=/api/v1/auth; SameSite=Strict
Content-Type: application/json
```

```json
{
  "data": {
    "profile": {
      "id": "uuid",
      "userId": "uuid",
      "displayName": null,
      "avatarUrl": null,
      "background": "student",
      "goals": "learn_new_skill",
      "interests": "[\"ai\",\"programming\",\"cloud_devops\"]",
      "preferredLanguage": "ar",
      "onboardingCompleted": true,
      "createdAt": "ISO",
      "updatedAt": "ISO"
    }
  },
  "message": "Success"
}
```

> The `interests` field in the response is the **JSON-stringified
> array** (the storage format), not the typed array sent on the wire.
> Frontend consumers must `JSON.parse` it. See
> [step-2-interests.md](./step-2-interests.md) §5.

---

## 7. Error responses

All errors are normalized by `HttpExceptionFilter` to:

```json
{ "statusCode": 400, "message": "...", "errorCode": "...", "errors": [ ... ]? }
```

| Status | `errorCode`                   | When |
|--------|-------------------------------|------|
| 400    | `VALIDATION_FAILED`           | Class-validator caught a structural problem: wrong types, missing fields, length > 3, interests `items` not array / out of range / unknown value / duplicates / non-string element, etc. |
| 400    | (none, message `"Missing required questionKey: <name>"`) | Service: one of `background` / `interests` / `goals` is absent from `responses`. |
| 400    | (none, message `"<name> must have stepNumber <n>"`)      | Service: a step's `stepNumber` does not match its required position. |
| 400    | `INVALID_BACKGROUND`          | Service: background `answer` not in `VALID_BACKGROUNDS`. |
| 400    | `INVALID_GOALS`               | Service: goals `answer` not in `VALID_GOALS`. |
| 400    | `ONBOARDING_ALREADY_COMPLETED`| Service: profile was already `onboardingCompleted: true` (race loss or repeat submission). |
| 400    | (`User not found`)            | Service: the JWT identifies a userId that no longer exists. |
| 401    | —                             | Missing or invalid access token. |
| 403    | (from `EmailVerifiedGuard`)   | The user is logged in but `emailVerified: false`. |
| 429    | `RATE_LIMIT_EXCEEDED`         | More than 5 calls/min/IP. |

---

## 8. Side effects (state mutations)

| Table                  | Mutation |
|------------------------|----------|
| `UserProfile`          | UPDATE `background`, `goals`, `interests`, `onboardingCompleted: true` (via conditional `updateMany`) |
| `OnboardingResponse`   | DELETE all rows for the user |
| `OnboardingResponse`   | INSERT 3 fresh rows (one per step) |
| `User.refreshToken`    | UPDATE — replaced with the bcrypt hash of the newly issued refresh token |
| (analytics)            | `analyticsService.capture(userId, 'onboarding_completed')` |

All four DB mutations happen inside a single `prisma.$transaction`. If
any step throws, none commit. The analytics call only runs after the
transaction commits.

---

## 9. Concurrency / TOCTOU defense

Two simultaneous `submit-onboarding` calls for the same user will race
to the conditional `updateMany`:

```
Request A: updateMany WHERE userId AND onboardingCompleted = false
   → count = 1, proceeds
Request B: updateMany WHERE userId AND onboardingCompleted = false
   → count = 0, throws ONBOARDING_ALREADY_COMPLETED, rolls back
```

The losing request:

- does **not** delete or insert any `OnboardingResponse` rows,
- does **not** rotate the refresh token (the `tx.user.update` is on the
  rolled-back path),
- does **not** fire the `onboarding_completed` analytics event.

This is the only defense against double-submission; do not rely on the
frontend to disable the button.

---

## 10. Files involved

| File | Role |
|------|------|
| `src/users/users.controller.ts` | `submitOnboarding()` route, cookie writing |
| `src/users/users.service.ts`    | Validation, transaction, token pre-sign, refresh-token rotation |
| `src/users/dto/onboarding.dto.ts` | `SubmitOnboardingDto`, `OnboardingResponseItemDto`, `VALID_*` constants |
| `src/auth/guards/jwt-auth.guard.ts` | Class-level guard on `UsersController` |
| `src/common/guards/email-verified.guard.ts` | Route-level guard on `submitOnboarding` |
| `src/common/error-codes.enum.ts` | `INVALID_BACKGROUND`, `INVALID_GOALS`, `ONBOARDING_ALREADY_COMPLETED` |
| `src/analytics/analytics.service.ts` | Captures `onboarding_completed` |
| `src/common/filters/http-exception.filter.ts` | Normalizes errors |
| `src/common/interceptors/response-transform.interceptor.ts` | Wraps body in `{ data, message }` |

---

## 11. Things NOT to change without coordination

- The conditional `updateMany` lock pattern. Replacing it with a
  read-then-write would re-introduce the TOCTOU race that this design
  closes.
- The folding of refresh-token rotation into the same transaction. The
  cookie the client receives must be the cookie whose hash is in the
  DB; rotating outside the transaction risks dangling tokens.
- The "validation throws plain `BadRequestException` for missing keys
  and stepNumber mismatches, but structured ErrorCode for enum
  membership" split. The frontend uses the ErrorCode field to highlight
  the offending input.
- The order: validate → pre-sign → transaction → analytics. Re-ordering
  would either let analytics fire on rollback or let signed tokens
  outlive a failed write.
- Cookie names and attributes (asserted by e2e tests).
