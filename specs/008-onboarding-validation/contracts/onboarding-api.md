# API Contract: Onboarding Submission

**Endpoint**: `POST /api/v1/users/me/onboarding`
**Auth**: JWT (httpOnly cookie) + EmailVerifiedGuard
**Rate Limit**: 5 requests / 60 seconds

## Request

```json
{
  "responses": [
    { "questionKey": "background", "answer": "student", "stepNumber": 1 },
    { "questionKey": "interests", "answer": "[\"ai\",\"programming\",\"cloud_devops\"]", "stepNumber": 2 },
    { "questionKey": "goals", "answer": "learn_new_skill", "stepNumber": 3 }
  ]
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| responses | Required array, exactly 3 items |
| questionKey | Must be one of: `background`, `interests`, `goals` |
| stepNumber | Must be 1, 2, or 3; must match questionKey |
| background answer | One of: `student`, `freelancer`, `employee`, `job_seeker` |
| goals answer | One of: `learn_new_skill`, `level_up`, `advance_career`, `switch_career`, `build_project` |
| interests answer | JSON array string, 1–4 items from 13 approved values, no duplicates |

## Responses

### 200 Success

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
      "createdAt": "2026-04-06T...",
      "updatedAt": "2026-04-06T..."
    }
  },
  "message": "Success"
}
```

### 400 Errors

| Error Code | Trigger |
|------------|---------|
| VALIDATION_FAILED | Missing/invalid fields (class-validator) |
| ONBOARDING_ALREADY_COMPLETED | User already completed onboarding |
| (no code) | Invalid background/goals value, invalid interests JSON/count/values/duplicates, missing required questionKey, mismatched stepNumber |

### 401 Unauthorized
No JWT or expired token.

### 403 Forbidden
Email not verified.

### 429 Too Many Requests
Rate limit exceeded.
