# Onboarding Feature — Backend Spec (awamer-api)

> **Version:** 3.0 — Typed interests array
> **Task:** KAN-22 (adjustments to existing implementation)
> **Related:** KAN-24 (frontend), Figma page "Onboarding" (node 16:1035)
> **Goal:** Add strict validation to existing onboarding endpoints to match the final Figma design. All changes and tests must be completed in a single pass.
>
> **⚠️ Breaking change in v3.0:** the `interests` response is now a typed
> `items: string[]` field on the request body, **not** a JSON-stringified
> array inside `answer`. The frontend and backend updated together.

---

## 1. Current State

### Existing files (already implemented):
| File | Purpose |
|------|---------|
| `src/users/users.controller.ts` | 2 onboarding endpoints (POST + GET) |
| `src/users/users.service.ts` | `submitOnboarding()` + `getOnboardingStatus()` |
| `src/users/dto/onboarding.dto.ts` | `SubmitOnboardingDto` + `OnboardingResponseItemDto` |
| `src/users/dto/index.ts` | DTO barrel exports |
| `src/users/__tests__/users.service.spec.ts` | Service tests (7 onboarding tests exist) |
| `src/users/__tests__/users.controller.spec.ts` | Controller tests (2 onboarding tests exist) |
| `src/users/__tests__/users.dto.spec.ts` | DTO validation tests (4 onboarding tests exist) |

### What's correct (DO NOT change):
- Controller routes, HTTP methods, decorators (JwtAuthGuard, EmailVerifiedGuard, Throttle)
- `getOnboardingStatus()` method — works correctly
- Prisma schema — no migration needed (OnboardingResponse + UserProfile models are correct)
- Module imports/exports
- Analytics service integration

### What needs changes:
The DTO accepts **any** `questionKey` and `answer` without validation. The service blindly saves whatever is sent. We need strict validation matching the Figma-approved design.

---

## 2. Data Contract (Final — approved via Figma)

### Step 1: Background
| Field | Value |
|-------|-------|
| questionKey | `"background"` |
| stepNumber | `1` |
| Selection | Single-select (exactly 1) |
| Valid answers | `"student"`, `"freelancer"`, `"employee"`, `"job_seeker"` |

### Step 2: Interests
| Field | Value |
|-------|-------|
| questionKey | `"interests"` |
| stepNumber | `2` |
| Selection | Multi-select (min 1, max 4) |
| Field name | `items` (typed `string[]` — **not** the `answer` field) |
| Wire format | JSON array, e.g. `"items": ["ai", "programming"]` |
| Valid values | `"programming"`, `"data_science"`, `"ai"`, `"mobile_dev"`, `"cybersecurity"`, `"cloud_devops"`, `"game_dev"`, `"vr_ar"`, `"blockchain"`, `"iot"`, `"design_ux"`, `"digital_marketing"`, `"project_management"` |
| Storage | The service `JSON.stringify`s `items` once and writes the resulting string to both `UserProfile.interests` and `OnboardingResponse.answer`. The DB schema is unchanged. |

### Step 3: Goals
| Field | Value |
|-------|-------|
| questionKey | `"goals"` |
| stepNumber | `3` |
| Selection | Single-select (exactly 1) |
| Valid answers | `"learn_new_skill"`, `"level_up"`, `"advance_career"`, `"switch_career"`, `"build_project"` |

---

## 3. Changes Required

### 3.1 File: `src/common/error-codes.enum.ts`

Add to the ErrorCode enum:
```typescript
ONBOARDING_ALREADY_COMPLETED = 'ONBOARDING_ALREADY_COMPLETED',
```

### 3.2 File: `src/users/dto/onboarding.dto.ts`

**Replace the entire file** with the following structure:

1. Export validation constants at the top:
   - `VALID_BACKGROUNDS = ['student', 'freelancer', 'employee', 'job_seeker'] as const`
   - `VALID_INTERESTS = ['programming', 'data_science', 'ai', 'mobile_dev', 'cybersecurity', 'cloud_devops', 'game_dev', 'vr_ar', 'blockchain', 'iot', 'design_ux', 'digital_marketing', 'project_management'] as const`
   - `VALID_GOALS = ['learn_new_skill', 'level_up', 'advance_career', 'switch_career', 'build_project'] as const`
   - `VALID_QUESTION_KEYS = ['background', 'interests', 'goals'] as const`
   - `MAX_INTERESTS = 4`
   - `MIN_INTERESTS = 1`

2. `OnboardingResponseItemDto` class:
   - `questionKey`: `@IsString()`, `@IsNotEmpty()`, `@IsIn([...VALID_QUESTION_KEYS])`
   - `answer`: `@IsString()`, `@IsNotEmpty()`, `@MaxLength(1000)`
   - `stepNumber`: `@IsInt()`, `@Min(1)`, `@Max(3)`

3. `SubmitOnboardingDto` class:
   - `responses`: `@IsArray()`, `@ArrayMinSize(3)`, `@ArrayMaxSize(3)`, `@ValidateNested({ each: true })`, `@Type(() => OnboardingResponseItemDto)`
   - **Remove** the optional `background`, `goals`, `interests` top-level string fields that exist in the current DTO — these values will be extracted from the `responses` array inside the service

4. Keep the `index.ts` barrel export updated

### 3.3 File: `src/users/users.service.ts` — `submitOnboarding()` method

Replace the current `submitOnboarding()` implementation. The new logic should:

1. **Check if already completed:** Query `userProfile.findUnique({ where: { userId } })`. If `onboardingCompleted === true`, throw `BadRequestException` with `{ message: 'Onboarding already completed', errorCode: ErrorCode.ONBOARDING_ALREADY_COMPLETED }`.

2. **Validate all 3 required keys are present:** Extract questionKeys from `dto.responses`. Check that `background`, `interests`, and `goals` are all present. If any is missing, throw `BadRequestException` with descriptive message.

3. **Validate stepNumber consistency:** `background` must have `stepNumber: 1`, `interests` must have `stepNumber: 2`, `goals` must have `stepNumber: 3`. Throw if mismatched.

4. **Validate background answer:** Must be one of `VALID_BACKGROUNDS`. Throw if not.

5. **Validate goals answer:** Must be one of `VALID_GOALS`. Throw if not.

6. **Validate interests answer:**
   - Parse JSON: `JSON.parse(interestsResponse.answer)`. Throw `BadRequestException` if invalid JSON.
   - Must be an array. Throw if not.
   - Length must be between `MIN_INTERESTS` (1) and `MAX_INTERESTS` (4). Throw if outside range.
   - Each item must be a string and must be in `VALID_INTERESTS`. Throw if any invalid.
   - Must not contain duplicates. Throw if duplicates found.

7. **Transaction:**
   - `deleteMany({ where: { userId } })` — remove any existing responses for idempotency
   - `createMany` — insert the 3 new responses
   - `userProfile.update` — set `background`, `goals`, `interests` (JSON array string), `onboardingCompleted: true`

8. **After transaction:** call `analyticsService.capture(userId, 'onboarding_completed')`

9. **Return** the updated profile

Import `VALID_BACKGROUNDS`, `VALID_INTERESTS`, `VALID_GOALS`, `MIN_INTERESTS`, `MAX_INTERESTS` from the DTO file.

---

## 4. API Contract

### POST /api/v1/users/me/onboarding

**Request:**
```json
{
  "responses": [
    { "questionKey": "background", "answer": "student", "stepNumber": 1 },
    { "questionKey": "interests", "items": ["ai", "programming", "cloud_devops"], "stepNumber": 2 },
    { "questionKey": "goals", "answer": "learn_new_skill", "stepNumber": 3 }
  ]
}
```

> **Migration note (v2.x → v3.0):** the `interests` entry no longer carries an
> `answer` field. Clients on v2.x that send only `answer: "[\"ai\"]"` (and no
> `items`) will get a `VALIDATION_FAILED` 400 because `items` is required when
> `questionKey === "interests"`. The `answer` field is silently ignored on
> interests entries; clients should stop sending it.

**200 Success:**
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

**400 Errors:**
- `VALIDATION_FAILED` → class-validator caught a structural problem (missing
  fields, wrong types, interests `items` not array / out-of-range / unknown
  value / duplicates / non-string element, etc.)
- `ONBOARDING_ALREADY_COMPLETED` → onboarding already flipped to true (race
  loss or repeat submission)
- `INVALID_BACKGROUND` / `INVALID_GOALS` → answer not in the enum
- Missing required questionKey / mismatched stepNumber → plain
  `BadRequestException` from the service

**401:** No JWT / expired
**403:** Email not verified
**429:** Rate limited

### GET /api/v1/users/me/onboarding
No changes. Works correctly.

---

## 5. Complete Test Suite

### 5.1 DTO Tests (`users.dto.spec.ts`) — add to existing `SubmitOnboardingDto` describe block:

```
SubmitOnboardingDto validation:
  ✓ should accept valid 3-response payload with correct keys and stepNumbers
  ✓ should reject empty responses array
  ✓ should reject responses with fewer than 3 items
  ✓ should reject responses with more than 3 items
  ✓ should reject invalid questionKey (e.g., "favorite_color")
  ✓ should reject stepNumber of 0
  ✓ should reject stepNumber of 4
  ✓ should reject stepNumber that is a string
  ✓ should reject stepNumber that is a float (e.g., 1.5)
  ✓ should reject missing questionKey in response item
  ✓ should reject missing answer in response item
  ✓ should reject missing stepNumber in response item
  ✓ should reject empty string questionKey
  ✓ should reject empty string answer
  ✓ should reject answer exceeding 1000 characters
  ✓ should reject non-array responses (e.g., object, string)
  ✓ should reject when responses is undefined/null
```

### 5.2 Service Tests (`users.service.spec.ts`) — add to existing `submitOnboarding` describe block:

```
submitOnboarding — validation:
  ✓ should throw ONBOARDING_ALREADY_COMPLETED if profile.onboardingCompleted is true
  ✓ should throw if "background" questionKey is missing from responses
  ✓ should throw if "interests" questionKey is missing from responses
  ✓ should throw if "goals" questionKey is missing from responses
  ✓ should throw if background stepNumber is not 1
  ✓ should throw if interests stepNumber is not 2
  ✓ should throw if goals stepNumber is not 3
  ✓ should throw if background answer is not in VALID_BACKGROUNDS (e.g., "astronaut")
  ✓ should throw if goals answer is not in VALID_GOALS (e.g., "become_famous")
  ✓ should throw if interests answer is not valid JSON
  ✓ should throw if interests answer is not a JSON array (e.g., JSON object)
  ✓ should throw if interests answer is an empty array
  ✓ should throw if interests has more than 4 items
  ✓ should throw if interests contains a value not in VALID_INTERESTS
  ✓ should throw if interests contains duplicate values (e.g., ["ai", "ai"])

submitOnboarding — happy path:
  ✓ should delete existing onboarding responses before creating new ones (idempotency)
  ✓ should create exactly 3 OnboardingResponse records
  ✓ should include userId in each response record
  ✓ should store background value in UserProfile.background
  ✓ should store goals value in UserProfile.goals
  ✓ should store interests JSON array string in UserProfile.interests
  ✓ should set onboardingCompleted to true
  ✓ should fire analyticsService.capture with 'onboarding_completed'
  ✓ should use prisma.$transaction for atomicity
  ✓ should return the updated UserProfile
  ✓ should throw on transaction failure (rollback)

submitOnboarding — edge cases:
  ✓ should accept interests with exactly 1 item (minimum)
  ✓ should accept interests with exactly 4 items (maximum)
  ✓ should accept all valid background values one by one
  ✓ should accept all valid goal values one by one
  ✓ should accept all valid interest values
```

### 5.3 Controller Tests (`users.controller.spec.ts`)

Keep all 6 existing tests. No new controller tests needed — validation is in DTO + service layers.

---

## 6. Files to Modify — Summary

| # | File | Action | What changes |
|---|------|--------|-------------|
| 1 | `src/common/error-codes.enum.ts` | Modify | Add `ONBOARDING_ALREADY_COMPLETED` |
| 2 | `src/users/dto/onboarding.dto.ts` | Replace | Constants + stricter validation + remove top-level fields |
| 3 | `src/users/dto/index.ts` | Verify | Ensure new constants are exported if needed |
| 4 | `src/users/users.service.ts` | Modify | Replace `submitOnboarding()` with validation logic |
| 5 | `src/users/__tests__/users.dto.spec.ts` | Modify | Add ~17 new DTO tests |
| 6 | `src/users/__tests__/users.service.spec.ts` | Modify | Add ~27 new service tests |

## 7. Execution Order

1. `src/common/error-codes.enum.ts` — add error code
2. `src/users/dto/onboarding.dto.ts` — replace with new DTO
3. `src/users/dto/index.ts` — verify exports
4. `src/users/users.service.ts` — update submitOnboarding()
5. Update test files
6. Run `npm run build` — must compile with zero errors
7. Run `npm run test` — ALL tests must pass (existing + new)
8. Run `npm run lint` — no new lint errors

## 8. DO NOT Change

- `prisma/schema.prisma` — no migration needed
- `users.controller.ts` — routes, guards, rate limits are correct
- `getOnboardingStatus()` — works correctly
- `users.module.ts` — no changes needed
- Auth module, middleware, or any other module
- Any existing passing test (only add new tests or update onboarding-specific ones)
