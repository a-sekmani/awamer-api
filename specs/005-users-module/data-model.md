# Data Model: Complete Users Module

**Feature**: 005-users-module
**Date**: 2026-03-29

## Schema Changes

No schema changes needed — all entities exist from feature 002-prisma-schema.

## Entities Involved (Existing — Read/Write)

### User (read/write)
| Field | Users Module Usage |
|-------|-------------------|
| id | Primary identifier — extracted from JWT |
| name | Returned in get-me; updated via PATCH /me |
| email | Returned in get-me (read-only in this module) |
| passwordHash | Compared in change-password; updated with new hash. Never exposed. |
| country | Returned in get-me; updated via PATCH /me |
| locale | Returned in get-me; updated via PATCH /me (restricted: "ar" or "en") |
| status | Returned in get-me (read-only in this module) |
| refreshToken | Set to null on password change (invalidate sessions). Never exposed. |

### UserProfile (read/write)
| Field | Users Module Usage |
|-------|-------------------|
| displayName | Returned in get-me; updated via PATCH /me/profile |
| avatarUrl | Returned in get-me; updated via PATCH /me/profile |
| background | Returned in get-me; updated via PATCH /me/profile and POST /me/onboarding |
| goals | Returned in get-me; updated via PATCH /me/profile and POST /me/onboarding |
| interests | Returned in get-me; updated via PATCH /me/profile and POST /me/onboarding |
| preferredLanguage | Returned in get-me; updated via PATCH /me/profile (restricted: "ar" or "en") |
| onboardingCompleted | Returned in get-me and GET /me/onboarding; set to true by POST /me/onboarding |

### UserRole (read-only)
| Field | Users Module Usage |
|-------|-------------------|
| role | First role returned as a string in get-me response |

### Subscription (read-only)
| Field | Users Module Usage |
|-------|-------------------|
| All fields | Active subscription returned in get-me with included plan |

### SubscriptionPlan (read-only)
| Field | Users Module Usage |
|-------|-------------------|
| All fields | Included with subscription in get-me response |

### OnboardingResponse (read/write)
| Field | Users Module Usage |
|-------|-------------------|
| userId | FK to User — set during onboarding submission |
| questionKey | Stored from submission; returned in GET /me/onboarding |
| answer | Stored from submission; returned in GET /me/onboarding |
| stepNumber | Stored from submission; returned in GET /me/onboarding |
| createdAt | Auto-set on creation; represents answered_at |

## DTOs (Validation Rules)

### UpdateUserDto
| Field | Type | Validation |
|-------|------|------------|
| name | string | Optional, max 100 |
| country | string | Optional, max 100 |
| locale | string | Optional, must be "ar" or "en" |

### UpdateProfileDto
| Field | Type | Validation |
|-------|------|------------|
| displayName | string | Optional, max 100 |
| avatarUrl | string | Optional, max 500 |
| background | string | Optional, max 1000 |
| goals | string | Optional, max 1000 |
| interests | string | Optional, max 1000 |
| preferredLanguage | string | Optional, must be "ar" or "en" |

### ChangePasswordDto
| Field | Type | Validation |
|-------|------|------------|
| currentPassword | string | Required, non-empty |
| newPassword | string | Required, min 8, must contain uppercase + lowercase + number |

### OnboardingResponseItemDto
| Field | Type | Validation |
|-------|------|------------|
| questionKey | string | Required, non-empty, max 100 |
| answer | string | Required, non-empty, max 1000 |
| stepNumber | number | Required, integer, min 1 |

### SubmitOnboardingDto
| Field | Type | Validation |
|-------|------|------------|
| responses | OnboardingResponseItemDto[] | Required, array, min 1 item, each item validated |
| background | string | Optional, max 1000 |
| goals | string | Optional, max 1000 |
| interests | string | Optional, max 1000 |

## Get-Me Response Shape

```
{
  data: {
    user: { id, name, email, country, locale, status },
    profile: { displayName, avatarUrl, background, goals, interests, preferredLanguage, onboardingCompleted },
    role: "learner",
    subscription: {
      id, status, stripeSubscriptionId, stripeCustomerId,
      currentPeriodStart, currentPeriodEnd,
      plan: { id, name, billingCycle, price, currency, durationDays }
    }
  },
  message: "Success"
}
```
