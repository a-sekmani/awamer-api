# Data Model: Email Verification (007)

**Date**: 2026-04-01 | **Branch**: `007-email-verification`

## Model Changes

### Modified: User

Add `emailVerified` field to existing User model.

| Field | Type | Default | Constraints | Notes |
| ----- | ---- | ------- | ----------- | ----- |
| emailVerified | Boolean | false | NOT NULL | Migration must default existing users to `true` to avoid disrupting current access |

**Relationship added**: `User` has many `EmailVerification` records (one-to-many).

### New: EmailVerification

Stores OTP codes for email verification. Each record represents a single code instance.

| Field | Type | Default | Constraints | Notes |
| ----- | ---- | ------- | ----------- | ----- |
| id | UUID | auto-generated | PK | Standard UUID primary key |
| userId | UUID | — | FK → User, NOT NULL | Owner of this verification code |
| code | String | — | NOT NULL, 6 chars | 6-digit numeric OTP code |
| expiresAt | DateTime | — | NOT NULL | Set to `now() + 10 minutes` at creation |
| attempts | Int | 0 | NOT NULL | Failed verification attempts against this code |
| used | Boolean | false | NOT NULL | Set to `true` when code is consumed or invalidated |
| createdAt | DateTime | now() | NOT NULL | Record creation timestamp |

**Indexes**:
- `userId` — frequent lookups by user for rate limiting and code retrieval
- `userId, used, expiresAt` — composite for finding the latest valid code efficiently

**Relationships**:
- `EmailVerification.userId` → `User.id` (many-to-one, cascade delete)

## State Transitions

### EmailVerification Lifecycle

```
Created (used=false, attempts=0)
    │
    ├── User submits correct code → used=true (within transaction with User.emailVerified=true)
    │
    ├── User submits wrong code → attempts++ 
    │       │
    │       └── attempts >= 5 → used=true (invalidated)
    │
    ├── 10 minutes pass → implicitly expired (expiresAt < now())
    │
    └── New code requested → used=true (invalidated by new code creation)
```

### User.emailVerified Lifecycle

```
false (registration default)
    │
    └── Successful verify-email → true (permanent, one-way transition)
```

## Validation Rules

| Entity | Field | Rule |
| ------ | ----- | ---- |
| EmailVerification | code | Exactly 6 numeric digits, generated via `crypto.randomInt(100000, 999999)` |
| EmailVerification | expiresAt | Must be `createdAt + 10 minutes` |
| EmailVerification | attempts | Max 5; code invalidated (used=true) when exceeded |
| User | emailVerified | Cannot be set back to `false` once `true` |

## Migration Notes

- **Existing users**: The migration must set `emailVerified = true` for all existing users to avoid breaking their access.
- **New users**: Will default to `emailVerified = false` at registration time.
- This is a non-breaking migration (adds a column with a default, adds a new table).
