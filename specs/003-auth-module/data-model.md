# Data Model: Complete Auth Module

**Feature**: 003-auth-module
**Date**: 2026-03-29

## Schema Changes

### User Model — New Fields (Migration Required)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| passwordResetToken | String | nullable | SHA-256 hash of the reset token sent via email |
| passwordResetExpires | DateTime | nullable | Expiry time for the reset token (default: 1 hour from creation) |

These fields are added to the existing User model. All other User fields remain unchanged.

## Entities Involved (Existing — No Changes)

### User (read/write)
| Field | Auth Module Usage |
|-------|-------------------|
| id | JWT payload `sub` claim; used to identify user across all operations |
| name | Included in registration; used in password reset email greeting |
| email | Login identifier; validated for format and uniqueness on register; normalized (trim + lowercase) |
| passwordHash | Written on register and reset-password; compared on login (bcrypt.compare) |
| country | Optional field captured during registration |
| locale | Default "ar"; not modified by auth module |
| status | Checked on login and refresh — deny if INACTIVE or SUSPENDED |
| refreshToken | Written on login/register (hashed); compared on refresh; cleared on logout |
| lastLoginAt | Updated to current timestamp on each successful login |
| passwordResetToken | **NEW** — Written on forgot-password (hashed); compared on reset-password; cleared after use |
| passwordResetExpires | **NEW** — Written on forgot-password; checked for expiry on reset-password; cleared after use |

### UserProfile (write only — created during registration)
| Field | Auth Module Usage |
|-------|-------------------|
| id | Auto-generated UUID |
| userId | FK to User — set during registration |
| onboardingCompleted | Default false — set during registration |
| All other fields | Default null — populated later by user profile module |

### UserRole (write only — created during registration)
| Field | Auth Module Usage |
|-------|-------------------|
| id | Auto-generated UUID |
| userId | FK to User — set during registration |
| role | Set to LEARNER during registration |

### SubscriptionPlan (read only — queried during registration)
| Field | Auth Module Usage |
|-------|-------------------|
| id | Used to create Subscription record |
| isDefault | Queried to find the default free plan |

### Subscription (write only — created during registration)
| Field | Auth Module Usage |
|-------|-------------------|
| id | Auto-generated UUID |
| userId | FK to User — set during registration |
| planId | FK to SubscriptionPlan — set to the default free plan |
| status | Set to ACTIVE during registration |

## DTOs (Validation Rules)

### RegisterDto
| Field | Type | Validation |
|-------|------|------------|
| name | string | Required, 1-100 characters |
| email | string | Required, valid email format, max 255 characters |
| password | string | Required, min 8 characters, must contain uppercase + lowercase + number |
| country | string | Optional, 2-100 characters |

### LoginDto
| Field | Type | Validation |
|-------|------|------------|
| email | string | Required, valid email format |
| password | string | Required, non-empty |

### ForgotPasswordDto
| Field | Type | Validation |
|-------|------|------------|
| email | string | Required, valid email format |

### ResetPasswordDto
| Field | Type | Validation |
|-------|------|------------|
| token | string | Required, non-empty |
| password | string | Required, min 8 characters, must contain uppercase + lowercase + number |

## State Transitions

### User.refreshToken Lifecycle
```
null → [hashed token] (on register or login)
[hashed token] → [new hashed token] (on refresh — rotation)
[hashed token] → null (on logout)
```

### User.passwordResetToken Lifecycle
```
null → [hashed token] (on forgot-password)
[hashed token] → null (on successful reset-password)
[hashed token] → expired (if passwordResetExpires < now)
```

### User.status Impact on Auth
```
ACTIVE → login allowed, refresh allowed
INACTIVE → login denied (403), refresh denied (403)
SUSPENDED → login denied (403), refresh denied (403)
```

## Transaction Scope

### Registration Transaction (Prisma.$transaction)
Creates atomically:
1. User (with hashed password, hashed refresh token)
2. UserProfile (empty, linked to user)
3. UserRole (LEARNER, linked to user)
4. Subscription (ACTIVE, linked to user + default free plan)

If any step fails, all are rolled back.
