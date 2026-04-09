# Onboarding Step 1 — Background

> **questionKey:** `"background"`
> **stepNumber:** `1`
> **Selection:** single-select (exactly 1)
> **Persisted to:** `UserProfile.background` (string) and `OnboardingResponse` (one row)
> **Source files:** `src/users/dto/onboarding.dto.ts`, `src/users/users.service.ts`, `src/users/users.controller.ts`
> **Figma:** "Onboarding" page, step 1

This document describes the **Background** stage of onboarding. The
backend does not have a per-step endpoint — all three steps are submitted
together via `POST /api/v1/users/me/onboarding`. This file is the
authoritative reference for the contract, validation, and storage of the
background field. For the wrapping endpoint contract, see
[submit-onboarding.md](./submit-onboarding.md).

---

## 1. Purpose

Captures the user's current professional/life situation, used to tailor
recommendations and segment analytics. It is mandatory and cannot be
skipped.

---

## 2. Data contract

| Property      | Value                                                 |
|---------------|-------------------------------------------------------|
| `questionKey` | `"background"`                                        |
| `stepNumber`  | `1`                                                   |
| Field carrying the answer | `answer` (string)                          |
| Field NOT used | `items` (only used by step 2)                        |
| Selection cardinality | exactly 1                                     |
| Valid answers | `"student"`, `"freelancer"`, `"employee"`, `"job_seeker"` |

### Wire shape (one entry inside the `responses` array)

```json
{ "questionKey": "background", "answer": "student", "stepNumber": 1 }
```

The exported constant `VALID_BACKGROUNDS` in
`src/users/dto/onboarding.dto.ts` is the single source of truth for the
allowed values:

```ts
export const VALID_BACKGROUNDS = [
  'student',
  'freelancer',
  'employee',
  'job_seeker',
] as const;
```

---

## 3. Validation — DTO layer

`OnboardingResponseItemDto` (in `src/users/dto/onboarding.dto.ts`)
applies the following decorators when `questionKey === "background"`:

| Field         | Decorators |
|---------------|------------|
| `questionKey` | `@IsString`, `@IsNotEmpty`, `@IsIn([...VALID_QUESTION_KEYS])` |
| `answer`      | `@ValidateIf(o => o.questionKey !== 'interests')` → `@IsString`, `@IsNotEmpty`, `@MaxLength(50)` |
| `items`       | not validated for background (`@ValidateIf` skips it) |
| `stepNumber`  | `@IsInt`, `@Min(1)`, `@Max(3)` |

> **The DTO does not pin `stepNumber` to `1` for background.** It merely
> requires it to be an integer in `[1, 3]`. The "background must be
> stepNumber 1" rule is enforced one layer down, in
> `UsersService.submitOnboarding()`.

> **The DTO does not check that `answer` is in `VALID_BACKGROUNDS`** — it
> only enforces type, non-empty, and length ≤ 50. Enum membership is
> enforced in the service.

> **`forbidNonWhitelisted` is on globally**, so sending an `items` field
> together with a background entry is rejected as `VALIDATION_FAILED`.

---

## 4. Validation — Service layer

`UsersService.submitOnboarding()` (in `src/users/users.service.ts`)
applies these checks specifically for the background entry:

1. **Required key.** The `background` entry must be present in
   `dto.responses`. If absent → `BadRequestException("Missing required questionKey: background")`.
2. **Step number consistency.** The background entry's `stepNumber` must
   equal `1`. If not → `BadRequestException("background must have stepNumber 1")`.
3. **Enum membership.** `backgroundResponse.answer` must be one of
   `VALID_BACKGROUNDS`. If not → `BadRequestException` with:
   ```json
   {
     "message": "Invalid background value",
     "errorCode": "INVALID_BACKGROUND",
     "field": "background"
   }
   ```

The service relies on the DTO to have already enforced "is a non-empty
string ≤ 50 chars". Service-level checks only handle cross-field
consistency and enum membership.

---

## 5. Persistence

When the submission succeeds (see
[submit-onboarding.md](./submit-onboarding.md) for the full transaction),
the background value is written to **two** places inside the same atomic
Prisma transaction:

| Table                 | Column              | Value                       |
|-----------------------|---------------------|-----------------------------|
| `UserProfile`         | `background`        | the validated answer string |
| `OnboardingResponse`  | `answer` (one row)  | the same string             |
| `OnboardingResponse`  | `questionKey`       | `"background"`              |
| `OnboardingResponse`  | `stepNumber`        | `1`                         |
| `OnboardingResponse`  | `userId`            | the authenticated user      |

The `OnboardingResponse` row exists for audit/history; the
`UserProfile.background` column is the live value the rest of the system
reads.

---

## 6. Reading the value back

`GET /api/v1/users/me/onboarding` returns the full set of responses for
the current user, sorted by `stepNumber`. The background entry will be
the first item in `responses`. See
[get-onboarding-status.md](./get-onboarding-status.md).

`GET /api/v1/users/me` includes `profile.background` (via the `profile`
include) for any consumer that just needs the live value.

---

## 7. Errors specific to step 1

| Status | `errorCode`           | Trigger |
|--------|-----------------------|---------|
| 400    | `VALIDATION_FAILED`   | DTO rejected the entry: missing `answer`, empty string, length > 50, wrong type, or unexpected `items` field present. |
| 400    | (no errorCode, message `"Missing required questionKey: background"`) | Service: the entry is missing entirely from `responses`. |
| 400    | (no errorCode, message `"background must have stepNumber 1"`)       | Service: `stepNumber` is not exactly `1`. |
| 400    | `INVALID_BACKGROUND`  | Service: `answer` is not in `VALID_BACKGROUNDS`. |

---

## 8. Adding or renaming a background value

Coordinated change. To add `"researcher"` for example:

1. Add `'researcher'` to `VALID_BACKGROUNDS` in
   `src/users/dto/onboarding.dto.ts`.
2. Update DTO/service tests in `src/users/dto/users.dto.spec.ts` and
   `src/users/users.service.spec.ts`.
3. Coordinate with the frontend (`awamer-web`) to add the new option to
   the step 1 UI and translation files.
4. No Prisma migration is needed — the column is `String?`, the
   constraint lives in code.
5. No data backfill is needed for existing users.

**Renaming** an existing value (e.g. `employee` → `working_professional`)
requires a backfill of `UserProfile.background` and `OnboardingResponse.answer`
because existing rows will no longer match the new enum.

---

## 9. Things NOT to change without coordination

- The string identifier `"background"` for the question key — it is the
  contract with the frontend, the audit table, and the analytics layer.
- The `stepNumber: 1` invariant — the frontend uses it to route between
  steps and the service hard-codes it as a consistency check.
- The dual-write pattern (`UserProfile.background` + `OnboardingResponse`).
  Removing the row in `OnboardingResponse` would break the audit trail
  and `GET /users/me/onboarding`.
- The enum members in `VALID_BACKGROUNDS` without a coordinated frontend
  + analytics rename.
