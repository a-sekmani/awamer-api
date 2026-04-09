# Get Onboarding Status — Backend Spec (awamer-api)

> **Module:** `UsersModule`
> **Endpoint:** `GET /api/v1/users/me/onboarding`
> **Frontend page:** `/onboarding` (awamer-web) — used on mount to decide whether to render the form or redirect
> **Guards:** `JwtAuthGuard` (controller-level) + `EmailVerifiedGuard` (route-level)
> **Status code:** `200 OK`

This document describes the read-only endpoint that returns the current
onboarding state for the authenticated user. The companion write
endpoint is documented in
[submit-onboarding.md](./submit-onboarding.md).

---

## 1. Summary

`getOnboardingStatus` returns two pieces of state:

1. `completed` — a boolean derived from `UserProfile.onboardingCompleted`.
2. `responses` — the array of `OnboardingResponse` rows for the user,
   ordered by `stepNumber` ascending.

It is read-only, makes no DB writes, fires no analytics, and has no
side effects.

---

## 2. Request

```
GET /api/v1/users/me/onboarding
Cookie: access_token=<JWT>
```

### Auth

- `JwtAuthGuard` (class-level on `UsersController`) requires a valid
  access token.
- `EmailVerifiedGuard` (route-level) requires `emailVerified === true`.
  Unverified users get blocked with the guard's standard error.

### Body / params

None.

---

## 3. Behavior — `UsersService.getOnboardingStatus(userId)`

Source: `src/users/users.service.ts` (around lines 262–276).

```ts
async getOnboardingStatus(userId: string) {
  const profile = await this.prisma.userProfile.findUnique({
    where: { userId },
  });

  const responses = await this.prisma.onboardingResponse.findMany({
    where: { userId },
    orderBy: { stepNumber: 'asc' },
  });

  return {
    completed: profile?.onboardingCompleted ?? false,
    responses,
  };
}
```

Notes:

- The two queries run **sequentially**, not in `Promise.all`. This is
  intentional and inherited from the original implementation; switching
  to `Promise.all` would be a safe micro-optimization but is not
  required.
- If the user has no `UserProfile` row at all (which should never
  happen because `register` creates it inside the same transaction as
  `User`), the `?? false` falls back to `completed: false`. The endpoint
  does **not** throw a "user not found".
- The returned `responses` array is the **raw rows** from the
  `OnboardingResponse` table. The interests row's `answer` field is the
  JSON-stringified array — clients must `JSON.parse` it. See
  [step-2-interests.md](./step-2-interests.md) §5.

---

## 4. Rate limiting

`@Throttle({ default: { limit: 20, ttl: 60000 } })` on the controller
method — **20 requests per minute per IP**, enforced by the global
`ThrottlerGuard`. Higher than `submit-onboarding` (5/min) because this
is a read-only call the frontend may issue on every page mount.

---

## 5. Successful response

```
HTTP/1.1 200 OK
Content-Type: application/json
```

Before the user has submitted onboarding:

```json
{
  "data": {
    "completed": false,
    "responses": []
  },
  "message": "Success"
}
```

After a successful submit:

```json
{
  "data": {
    "completed": true,
    "responses": [
      {
        "id": "uuid",
        "userId": "uuid",
        "questionKey": "background",
        "answer": "student",
        "stepNumber": 1,
        "createdAt": "ISO"
      },
      {
        "id": "uuid",
        "userId": "uuid",
        "questionKey": "interests",
        "answer": "[\"ai\",\"programming\",\"cloud_devops\"]",
        "stepNumber": 2,
        "createdAt": "ISO"
      },
      {
        "id": "uuid",
        "userId": "uuid",
        "questionKey": "goals",
        "answer": "learn_new_skill",
        "stepNumber": 3,
        "createdAt": "ISO"
      }
    ]
  },
  "message": "Success"
}
```

> The exact set of columns returned for each response row matches the
> Prisma model — there is no projection or sanitization step. If new
> columns are added to `OnboardingResponse` in `prisma/schema.prisma`,
> they will appear in this payload automatically. If a column should
> be hidden from the client, add an explicit `select` to the query.

---

## 6. Error responses

| Status | When |
|--------|------|
| 401    | Missing or invalid access token. |
| 403    | `EmailVerifiedGuard` blocked the request because the user is unverified. |
| 429    | More than 20 calls/min/IP. |

This endpoint never returns 400, 404, or 500 under normal operation.
The "no profile row" branch returns `200 { completed: false, responses: [] }`.

---

## 7. Side effects (state mutations)

**None.** This is a pure read endpoint.

---

## 8. Typical client usage

The frontend `/onboarding` page uses this endpoint to decide its own
state on mount:

```
mount
  ├─ GET /users/me/onboarding
  │     ├─ completed: true → redirect to /dashboard
  │     └─ completed: false → render the 3-step form
```

It also runs after a successful login when the JWT payload's
`onboardingCompleted` flag is stale (e.g. a developer flipping the DB
manually). In normal flow the JWT payload alone is enough — the
frontend reads `onboardingCompleted` from the decoded token without
calling this endpoint at all.

---

## 9. Files involved

| File | Role |
|------|------|
| `src/users/users.controller.ts`         | `getOnboardingStatus()` route |
| `src/users/users.service.ts`            | `getOnboardingStatus()` service method |
| `src/auth/guards/jwt-auth.guard.ts`     | Class-level guard on `UsersController` |
| `src/common/guards/email-verified.guard.ts` | Route-level guard on this endpoint |
| `prisma/schema.prisma`                  | `UserProfile` and `OnboardingResponse` models |
| `src/common/interceptors/response-transform.interceptor.ts` | Wraps body in `{ data, message }` |

---

## 10. Things NOT to change without coordination

- The `completed` derivation. Some frontends may treat the absence of
  `responses` as "in progress" — this endpoint deliberately separates
  the `completed` boolean from the response set so a partial-write bug
  cannot lock a user out.
- The `?? false` fallback on missing profile. Throwing here would break
  any consumer calling this immediately after register before the
  frontend redirects to `/auth/verify-email`.
- The raw `OnboardingResponse` row shape — the frontend reads
  `responses[i].stepNumber` and `responses[i].answer` directly. If you
  add a `select` to hide columns, keep these two.
- The `EmailVerifiedGuard` requirement. Without it, an unverified user
  could probe their own onboarding state, which violates the email-
  verification gate the rest of the protected surface enforces.
