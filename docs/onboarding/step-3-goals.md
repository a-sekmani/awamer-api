# Onboarding Step 3 — Goals

> **questionKey:** `"goals"`
> **stepNumber:** `3`
> **Selection:** single-select (exactly 1)
> **Persisted to:** `UserProfile.goals` (string) and `OnboardingResponse` (one row)
> **Source files:** `src/users/dto/onboarding.dto.ts`, `src/users/users.service.ts`, `src/users/users.controller.ts`
> **Figma:** "Onboarding" page, step 3

This document describes the **Goals** stage of onboarding. For the
wrapping endpoint contract see
[submit-onboarding.md](./submit-onboarding.md).

---

## 1. Purpose

Captures the user's primary motivation for using the platform. Used to
personalize the dashboard greeting, recommend a path, and segment
analytics. Mandatory; cannot be skipped.

---

## 2. Data contract

| Property      | Value |
|---------------|-------|
| `questionKey` | `"goals"` |
| `stepNumber`  | `3` |
| Field carrying the answer | `answer` (string) |
| Field NOT used | `items` (only used by step 2) |
| Selection cardinality | exactly 1 |
| Valid answers | `"learn_new_skill"`, `"level_up"`, `"advance_career"`, `"switch_career"`, `"build_project"` |

### Wire shape (one entry inside the `responses` array)

```json
{ "questionKey": "goals", "answer": "learn_new_skill", "stepNumber": 3 }
```

The exported constant `VALID_GOALS` in
`src/users/dto/onboarding.dto.ts` is the single source of truth:

```ts
export const VALID_GOALS = [
  'learn_new_skill',
  'level_up',
  'advance_career',
  'switch_career',
  'build_project',
] as const;
```

---

## 3. Validation — DTO layer

`OnboardingResponseItemDto` (in `src/users/dto/onboarding.dto.ts`)
applies the following decorators when `questionKey === "goals"`:

| Field         | Decorators |
|---------------|------------|
| `questionKey` | `@IsString`, `@IsNotEmpty`, `@IsIn([...VALID_QUESTION_KEYS])` |
| `answer`      | `@ValidateIf(o => o.questionKey !== 'interests')` → `@IsString`, `@IsNotEmpty`, `@MaxLength(50)` |
| `items`       | not validated for goals (`@ValidateIf` skips it) |
| `stepNumber`  | `@IsInt`, `@Min(1)`, `@Max(3)` |

> **The DTO does not pin `stepNumber` to `3`** — only to the `[1, 3]`
> range. The "goals must be stepNumber 3" rule lives in
> `UsersService.submitOnboarding()`.

> **The DTO does not check enum membership** for `answer` — only that
> it is a non-empty string ≤ 50 chars. Enum membership is enforced in
> the service.

---

## 4. Validation — Service layer

`UsersService.submitOnboarding()` (in `src/users/users.service.ts`)
applies these checks specifically for the goals entry:

1. **Required key.** The `goals` entry must be present in
   `dto.responses`. If absent →
   `BadRequestException("Missing required questionKey: goals")`.
2. **Step number consistency.** `goalsResponse.stepNumber` must equal
   `3`. If not → `BadRequestException("goals must have stepNumber 3")`.
3. **Enum membership.** `goalsResponse.answer` must be in `VALID_GOALS`.
   If not → `BadRequestException` with:
   ```json
   {
     "message": "Invalid goals value",
     "errorCode": "INVALID_GOALS",
     "field": "goals"
   }
   ```

---

## 5. Persistence

When the submission succeeds (see
[submit-onboarding.md](./submit-onboarding.md)), the goals value is
written to two places inside the same atomic Prisma transaction:

| Table                | Column              | Value                       |
|----------------------|---------------------|-----------------------------|
| `UserProfile`        | `goals`             | the validated answer string |
| `OnboardingResponse` | `answer` (one row)  | the same string             |
| `OnboardingResponse` | `questionKey`       | `"goals"`                   |
| `OnboardingResponse` | `stepNumber`        | `3`                         |
| `OnboardingResponse` | `userId`            | the authenticated user      |

The `OnboardingResponse` row is the audit trail; `UserProfile.goals` is
the live value the rest of the system reads.

---

## 6. Reading the value back

- `GET /api/v1/users/me/onboarding` returns the `OnboardingResponse`
  rows ordered by `stepNumber`. The goals entry will be the third item
  in `responses`. See
  [get-onboarding-status.md](./get-onboarding-status.md).
- `GET /api/v1/users/me` includes `profile.goals` directly.

---

## 7. Errors specific to step 3

| Status | `errorCode`         | Trigger |
|--------|---------------------|---------|
| 400    | `VALIDATION_FAILED` | DTO rejected the entry: missing `answer`, empty string, length > 50, wrong type, or unexpected `items` field present. |
| 400    | (no errorCode, message `"Missing required questionKey: goals"`) | Service: the entry is missing entirely from `responses`. |
| 400    | (no errorCode, message `"goals must have stepNumber 3"`)        | Service: `stepNumber` is not exactly `3`. |
| 400    | `INVALID_GOALS`     | Service: `answer` is not in `VALID_GOALS`. |

---

## 8. Adding or renaming a goal value

Same pattern as background:

1. Add the new value to `VALID_GOALS` in
   `src/users/dto/onboarding.dto.ts`.
2. Update tests in `src/users/dto/users.dto.spec.ts` and
   `src/users/users.service.spec.ts`.
3. Coordinate with the frontend to add the option and translation.
4. No Prisma migration needed.

Renaming an existing value requires a backfill of `UserProfile.goals`
and `OnboardingResponse.answer` rows.

---

## 9. Things NOT to change without coordination

- The string identifier `"goals"` for the question key.
- The `stepNumber: 3` invariant.
- The dual-write pattern (`UserProfile.goals` + `OnboardingResponse`).
- The enum members in `VALID_GOALS` without a coordinated frontend +
  analytics rename.
