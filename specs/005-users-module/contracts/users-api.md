# API Contract: Users Module

**Base URL**: `/api/v1/users`
**Authentication**: All endpoints require JwtAuthGuard (access_token cookie)

---

## GET /me

**Access**: Authenticated

**Success Response** (200):
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "Ahmad Sekmani",
      "email": "ahmad@example.com",
      "country": "SA",
      "locale": "ar",
      "status": "active"
    },
    "profile": {
      "displayName": "Ahmad",
      "avatarUrl": "https://...",
      "background": "Software Engineer",
      "goals": "Learn AI",
      "interests": "Machine Learning, Cloud",
      "preferredLanguage": "ar",
      "onboardingCompleted": true
    },
    "role": "learner",
    "subscription": {
      "id": "uuid",
      "status": "active",
      "stripeSubscriptionId": null,
      "stripeCustomerId": null,
      "currentPeriodStart": null,
      "currentPeriodEnd": null,
      "plan": {
        "id": "uuid",
        "name": "Free",
        "billingCycle": "free",
        "price": 0,
        "currency": "USD",
        "durationDays": 0
      }
    }
  },
  "message": "Success"
}
```

**Error Responses**:
- 401: Not authenticated

---

## PATCH /me

**Access**: Authenticated

**Request Body** (all fields optional):
```json
{
  "name": "Ahmad S.",
  "country": "SA",
  "locale": "ar"
}
```

**Success Response** (200):
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "Ahmad S.",
      "email": "ahmad@example.com",
      "country": "SA",
      "locale": "ar",
      "status": "active"
    }
  },
  "message": "Success"
}
```

**Error Responses**:
- 400: Validation errors (invalid locale, field too long)
- 401: Not authenticated

---

## PATCH /me/profile

**Access**: Authenticated

**Request Body** (all fields optional):
```json
{
  "displayName": "Ahmad",
  "avatarUrl": "https://...",
  "background": "Software Engineer",
  "goals": "Learn AI and Cybersecurity",
  "interests": "Machine Learning, Cloud, DevOps",
  "preferredLanguage": "en"
}
```

**Success Response** (200):
```json
{
  "data": {
    "profile": {
      "displayName": "Ahmad",
      "avatarUrl": "https://...",
      "background": "Software Engineer",
      "goals": "Learn AI and Cybersecurity",
      "interests": "Machine Learning, Cloud, DevOps",
      "preferredLanguage": "en",
      "onboardingCompleted": true
    }
  },
  "message": "Success"
}
```

**Error Responses**:
- 400: Validation errors (invalid preferredLanguage, field too long)
- 401: Not authenticated

---

## PATCH /me/password

**Access**: Authenticated

**Request Body**:
```json
{
  "currentPassword": "OldPass123",
  "newPassword": "NewPass456"
}
```

**Success Response** (200):
```json
{
  "data": null,
  "message": "Password updated"
}
```

**Error Responses**:
- 400: `{ "statusCode": 400, "message": "Current password is incorrect" }`
- 400: Validation errors (weak new password)
- 401: Not authenticated

---

## POST /me/onboarding

**Access**: Authenticated

**Request Body**:
```json
{
  "responses": [
    { "questionKey": "experience_level", "answer": "beginner", "stepNumber": 1 },
    { "questionKey": "primary_goal", "answer": "career_change", "stepNumber": 2 },
    { "questionKey": "interests", "answer": "ai,cybersecurity", "stepNumber": 3 }
  ],
  "background": "Student",
  "goals": "Career in AI",
  "interests": "AI, Cybersecurity"
}
```

**Success Response** (200):
```json
{
  "data": {
    "profile": {
      "displayName": null,
      "avatarUrl": null,
      "background": "Student",
      "goals": "Career in AI",
      "interests": "AI, Cybersecurity",
      "preferredLanguage": null,
      "onboardingCompleted": true
    }
  },
  "message": "Success"
}
```

**Side Effects**:
- Creates OnboardingResponse records (one per response item)
- Updates UserProfile (background, goals, interests, onboardingCompleted)
- Fires analytics event: `onboarding_completed` with userId

**Error Responses**:
- 400: Validation errors (empty responses array, missing fields)
- 401: Not authenticated

---

## GET /me/onboarding

**Access**: Authenticated

**Success Response** (200):
```json
{
  "data": {
    "completed": true,
    "responses": [
      { "questionKey": "experience_level", "answer": "beginner", "stepNumber": 1, "createdAt": "2026-03-29T..." },
      { "questionKey": "primary_goal", "answer": "career_change", "stepNumber": 2, "createdAt": "2026-03-29T..." }
    ]
  },
  "message": "Success"
}
```

**Error Responses**:
- 401: Not authenticated
