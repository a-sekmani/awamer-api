# Check Email — Backend Spec (awamer-api)

> **Module:** none — this is a frontend-only screen.
> **Endpoint:** **none on the backend.**
> **Frontend page:** `/auth/check-email` (awamer-web)

This document exists for completeness in `docs/auth/`, but `check-email`
is **not** a backend route. It is a static confirmation screen the
frontend shows after a successful `POST /api/v1/auth/forgot-password`
call. There is nothing to consume on the backend, no DTO, no service
method, no database mutation directly tied to this URL.

---

## 1. Why this file exists

The frontend project (`awamer-web`) lists `/auth/check-email` as one of
its public auth pages. The flow is:

```
/auth/forgot-password
   └─ user submits email
       └─ POST /api/v1/auth/forgot-password  (200, generic success message)
            └─ frontend redirects to /auth/check-email
                 └─ static "we sent you an email" screen
```

The check-email page does not call any backend endpoint at load time. It
typically renders the masked email address from the URL/query string or
from frontend state, and offers the user two actions:

1. **Open mail app** — `mailto:` link, no backend call.
2. **Resend** — re-runs the same `POST /api/v1/auth/forgot-password` call
   from the previous step.

---

## 2. Backend endpoints the screen depends on

| Action on `/auth/check-email` | Backend endpoint                         | Documented in |
|-------------------------------|------------------------------------------|---------------|
| Initial arrival (no call)     | —                                        | — |
| Resend reset link             | `POST /api/v1/auth/forgot-password`      | [forgot-password.md](./forgot-password.md) |

The full request/response/rate-limit/security contract for the resend
action is in `forgot-password.md`. Read that document for the
authoritative reference. **Do not duplicate the contract here** — there
is exactly one source of truth, and it is `forgot-password.md`.

---

## 3. Important reminders for anyone working on this screen

- **The backend does not know the user is on `/auth/check-email`.** There
  is no session, no flag, no row, nothing. From the API's perspective,
  the user is simply an unauthenticated client who may or may not call
  `forgot-password` again.
- **The "resend" button is rate-limited the same as the original send.**
  See `forgot-password.md` §6 — the per-email cooldown is **60 seconds**,
  the per-email hourly limit is **5**, and the per-IP daily limit is
  **10**. The frontend should disable the resend button for the cooldown
  duration based on the `retryAfter` field returned in the 429 response.
- **The success message is intentionally vague** ("If an account with
  that email exists…"). Do not change the wording on the frontend to
  imply the email definitely exists — that would defeat the
  no-enumeration guarantee documented in `forgot-password.md` §9.
- **No JWT is involved.** The user is unauthenticated throughout this
  flow. Cookies are not set on `/auth/forgot-password` and are not
  expected by `/auth/reset-password` either.

---

## 4. Where the analogous email-verification "check email" screen lives

Do not confuse this page with the email-verification flow. They are
different:

| Page                      | Purpose                                          | Backend endpoint(s) |
|---------------------------|--------------------------------------------------|---------------------|
| `/auth/check-email`       | Confirm a password-reset link has been sent      | `POST /auth/forgot-password` |
| `/auth/verify-email`      | Enter a 6-digit OTP to verify an account email   | `POST /auth/send-verification`, `POST /auth/resend-verification`, `POST /auth/verify-email` |

The verification flow is documented separately in
[verify-email.md](./verify-email.md). It **does** require a JWT (the user
must be logged in) and **does** mutate the database on every call.
`check-email` does neither.

---

## 5. Files involved (frontend, for reference)

| File (in `awamer-web`)               | Role |
|--------------------------------------|------|
| `src/app/auth/check-email/page.tsx`  | The static confirmation screen |
| `src/app/auth/forgot-password/page.tsx` | Submits the email, then routes here |
| `src/lib/api.ts`                      | Wraps the `POST /auth/forgot-password` fetch |

There are no `awamer-api` files involved. If you find yourself adding a
backend endpoint named `check-email`, **stop and reconsider** — the flow
is fully covered by `forgot-password` and does not need its own route.
