# Onboarding Step 2 — Interests

> **questionKey:** `"interests"`
> **stepNumber:** `2`
> **Selection:** multi-select (1–4 unique items)
> **Persisted to:** `UserProfile.interests` (JSON-stringified array) and `OnboardingResponse` (one row, JSON-stringified array in `answer`)
> **Source files:** `src/users/dto/onboarding.dto.ts`, `src/users/users.service.ts`, `src/users/users.controller.ts`
> **Figma:** "Onboarding" page, step 2

This document describes the **Interests** stage of onboarding. For the
wrapping endpoint contract see
[submit-onboarding.md](./submit-onboarding.md).

> **Wire-format note (v3.0).** Interests are sent as a typed
> `items: string[]` field — **not** as a JSON-stringified array inside
> `answer`. Clients still on v2.x that send only `answer: "[\"ai\"]"`
> will get a `VALIDATION_FAILED` 400. The DB still stores the value as a
> JSON string for schema compatibility (see §5).

---

## 1. Purpose

Captures 1 to 4 technical fields the user is interested in. Used to
recommend paths/courses, segment analytics, and seed the dashboard.
Mandatory; cannot be skipped or submitted empty.

---

## 2. Data contract

| Property                   | Value |
|----------------------------|-------|
| `questionKey`              | `"interests"` |
| `stepNumber`               | `2` |
| Field carrying the answer  | `items` (`string[]`) |
| Field NOT used             | `answer` (only used by background/goals) |
| Selection cardinality      | min 1, max 4, **unique** |
| Element type               | string, must be in `VALID_INTERESTS` |

### Wire shape (one entry inside the `responses` array)

```json
{ "questionKey": "interests", "items": ["ai", "cybersecurity"], "stepNumber": 2 }
```

The exported constant `VALID_INTERESTS` in
`src/users/dto/onboarding.dto.ts` is the single source of truth for
allowed values:

```ts
export const VALID_INTERESTS = [
  'programming', 'data_science', 'ai', 'mobile_dev',
  'cybersecurity', 'cloud_devops', 'game_dev', 'vr_ar',
  'blockchain', 'iot', 'design_ux', 'digital_marketing',
  'project_management',
] as const;

export const MIN_INTERESTS = 1;
export const MAX_INTERESTS = 4;
```

---

## 3. Validation — DTO layer

`OnboardingResponseItemDto` (in `src/users/dto/onboarding.dto.ts`)
applies the following decorators when `questionKey === "interests"`:

| Field         | Decorators |
|---------------|------------|
| `questionKey` | `@IsString`, `@IsNotEmpty`, `@IsIn([...VALID_QUESTION_KEYS])` |
| `answer`      | not validated for interests (`@ValidateIf` skips it) |
| `items`       | `@ValidateIf(o => o.questionKey === 'interests')` → `@IsArray`, `@ArrayMinSize(MIN_INTERESTS)`, `@ArrayMaxSize(MAX_INTERESTS)`, `@ArrayUnique`, `@IsString({ each: true })`, `@IsIn([...VALID_INTERESTS], { each: true })` |
| `stepNumber`  | `@IsInt`, `@Min(1)`, `@Max(3)` |

This means class-validator catches **all** of the following before the
service is even called:

- `items` missing or undefined → fails `@IsArray`.
- `items` is not an array (e.g. a string) → fails `@IsArray`.
- `items` empty → fails `@ArrayMinSize(1)`.
- `items.length > 4` → fails `@ArrayMaxSize(4)`.
- `items` contains duplicates → fails `@ArrayUnique`.
- `items` contains a non-string element → fails `@IsString({ each: true })`.
- `items` contains a string outside `VALID_INTERESTS` → fails `@IsIn([...], { each: true })`.

> **The DTO does not pin `stepNumber` to `2`.** It only requires
> `stepNumber ∈ [1, 3]`. The "interests must be stepNumber 2" rule is
> enforced in `UsersService.submitOnboarding()`.

> **`forbidNonWhitelisted` is on globally**, so sending an `answer`
> field together with an interests entry is rejected as
> `VALIDATION_FAILED` (the `answer` property is declared on the same
> class but the global pipe forbids unknown fields, not declared ones —
> in practice the frontend should simply omit `answer` for interests).

---

## 4. Validation — Service layer

`UsersService.submitOnboarding()` (in `src/users/users.service.ts`)
applies these checks specifically for the interests entry:

1. **Required key.** The `interests` entry must be present in
   `dto.responses`. If absent → `BadRequestException("Missing required questionKey: interests")`.
2. **Step number consistency.** `stepNumber` must equal `2`. If not →
   `BadRequestException("interests must have stepNumber 2")`.
3. **No further validation.** All structural and enum checks are
   delegated to the DTO. The service just consumes
   `interestsResponse.items`.

---

## 5. Persistence — JSON-stringified storage

The DB schema stores interests as a single string column (it predates
the typed-array refactor). The service serializes the array exactly
once, then writes the same string to two places inside the same atomic
Prisma transaction:

```ts
const interestsSerialized = JSON.stringify(interestsItems);
```

| Table                | Column                  | Value                                  |
|----------------------|-------------------------|----------------------------------------|
| `UserProfile`        | `interests`             | `interestsSerialized`                  |
| `OnboardingResponse` | `answer` (one row)      | `interestsSerialized`                  |
| `OnboardingResponse` | `questionKey`           | `"interests"`                          |
| `OnboardingResponse` | `stepNumber`            | `2`                                    |
| `OnboardingResponse` | `userId`                | the authenticated user                 |

The serialization uses native `JSON.stringify`, which produces e.g.
`"[\"ai\",\"cybersecurity\"]"`. Consumers reading the value back must
`JSON.parse` it.

> **Why JSON-string instead of `String[]` / `Json` column?** The schema
> existed before the v3.0 typed-array refactor. Migrating the column
> would require a one-shot data migration; the typed-array refactor was
> intentionally scoped to the wire format only, leaving the storage
> layer alone.

---

## 6. Reading the value back

- `GET /api/v1/users/me/onboarding` returns the raw `OnboardingResponse`
  rows. The interests row's `answer` is the JSON-stringified array. The
  client must `JSON.parse` it. See
  [get-onboarding-status.md](./get-onboarding-status.md).
- `GET /api/v1/users/me` includes `profile.interests` (the same
  JSON-stringified string) for consumers that just need the live value.

There is no server-side helper that returns interests already parsed.
The frontend treats `profile.interests` as `string` and parses it where
needed.

---

## 7. Errors specific to step 2

| Status | `errorCode`         | Trigger |
|--------|---------------------|---------|
| 400    | `VALIDATION_FAILED` | DTO rejected the entry: `items` missing, not array, empty, > 4, duplicate, non-string element, or value outside `VALID_INTERESTS`. |
| 400    | (no errorCode, message `"Missing required questionKey: interests"`) | Service: the entry is missing entirely from `responses`. |
| 400    | (no errorCode, message `"interests must have stepNumber 2"`)        | Service: `stepNumber` is not exactly `2`. |

There is **no** dedicated `INVALID_INTERESTS` error code. The DTO catches
every interest-shape problem before the service runs, so the structured
service-level error code that the v2.x design originally had was
deleted.

---

## 8. Adding or renaming an interest value

Coordinated change. To add `"robotics"` for example:

1. Add `'robotics'` to `VALID_INTERESTS` in
   `src/users/dto/onboarding.dto.ts`.
2. Update tests in `src/users/dto/users.dto.spec.ts` and
   `src/users/users.service.spec.ts`.
3. Coordinate with the frontend (`awamer-web`) to add the new option to
   the step 2 UI and translation files.
4. No Prisma migration needed.

**Renaming** an existing value (e.g. `cloud_devops` → `cloud_engineering`)
requires a backfill of `UserProfile.interests` and the matching
`OnboardingResponse.answer` rows because existing JSON arrays will still
contain the old token.

---

## 9. Things NOT to change without coordination

- The `MIN_INTERESTS = 1` / `MAX_INTERESTS = 4` constants. The frontend
  selector enforces the same range and the design is approved against
  these bounds.
- The `items` wire-format name. v2.x clients that still send `answer:
  "[\"ai\"]"` are intentionally rejected — see migration note at top.
- The `JSON.stringify(items)` storage convention. Switching to a typed
  Postgres column would require a migration and a one-shot backfill.
- The dual-write pattern (`UserProfile.interests` + `OnboardingResponse`).
- The enum members in `VALID_INTERESTS` without a coordinated frontend
  + analytics rename.
