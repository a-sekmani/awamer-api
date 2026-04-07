# Data Model: Onboarding Validation Enforcement

**Feature**: 008-onboarding-validation
**Date**: 2026-04-06

## Entities (No Changes — Existing Schema)

No migration is required. The existing Prisma models are sufficient.

### OnboardingResponse (existing)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | — |
| userId | UUID | FK → User.id, indexed | Cascade delete |
| questionKey | String | Required | Now validated: must be `background`, `interests`, or `goals` |
| answer | String | Required, max 1000 | Now validated: must match allowed values per questionKey |
| stepNumber | Int | Required, min 1 | Now validated: must be 1, 2, or 3; must match questionKey |
| createdAt | DateTime | Auto-generated | — |

### UserProfile (existing — affected fields)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| background | String? | Optional | Set from `background` response answer |
| goals | String? | Optional | Set from `goals` response answer |
| interests | String? | Optional | Set from `interests` response answer (JSON array string) |
| onboardingCompleted | Boolean | Default false | Set to `true` after successful submission |

## Validation Constants (New — in DTO file)

### Valid Values

| Constant | Values |
|----------|--------|
| VALID_BACKGROUNDS | `student`, `freelancer`, `employee`, `job_seeker` |
| VALID_GOALS | `learn_new_skill`, `level_up`, `advance_career`, `switch_career`, `build_project` |
| VALID_INTERESTS | `programming`, `data_science`, `ai`, `mobile_dev`, `cybersecurity`, `cloud_devops`, `game_dev`, `vr_ar`, `blockchain`, `iot`, `design_ux`, `digital_marketing`, `project_management` |
| VALID_QUESTION_KEYS | `background`, `interests`, `goals` |

### Limits

| Constant | Value | Description |
|----------|-------|-------------|
| MIN_INTERESTS | 1 | Minimum interest selections |
| MAX_INTERESTS | 4 | Maximum interest selections |
| REQUIRED_RESPONSES | 3 | Exactly 3 responses required (one per key) |
| MAX_STEP_NUMBER | 3 | Maximum step number |

## Step-to-Key Mapping

| stepNumber | questionKey | Validation Type |
|------------|-------------|-----------------|
| 1 | background | Single-select from VALID_BACKGROUNDS |
| 2 | interests | Multi-select JSON array from VALID_INTERESTS (1–4 items, no duplicates) |
| 3 | goals | Single-select from VALID_GOALS |

## State Transitions

```
User registers → emailVerified: false, onboardingCompleted: false
  ↓ (verify email)
emailVerified: true, onboardingCompleted: false
  ↓ (submit onboarding — POST /users/me/onboarding)
onboardingCompleted: true, background/goals/interests populated
  ↓ (attempt resubmit)
REJECTED: ONBOARDING_ALREADY_COMPLETED (400)
```
