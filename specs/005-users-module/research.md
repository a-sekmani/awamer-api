# Research: Complete Users Module

**Feature**: 005-users-module
**Date**: 2026-03-29

## Research Tasks

### 1. Get-Me Query Strategy

**Decision**: Use a single Prisma `findUnique` with `include` to fetch user + profile + roles + subscriptions (with plan) in one query. Extract the first role as a string and the most recent active subscription.
**Rationale**: A single query with includes is the most efficient approach — one round-trip to the database. Prisma handles the JOINs. The roles array is mapped to a single string (first role), and subscriptions are filtered to the active one with its plan.
**Alternatives considered**:
- Multiple sequential queries — slower, more DB round-trips.
- Raw SQL — loses Prisma type safety for no meaningful performance gain.

### 2. Partial Update Pattern

**Decision**: Use optional fields in DTOs (all fields decorated with `@IsOptional()`) and pass the DTO directly to Prisma's `update` with `data: dto`. Prisma ignores undefined fields, so only provided values are updated.
**Rationale**: This is the idiomatic Prisma approach for partial updates. No need to manually filter out undefined fields — Prisma handles it natively.
**Alternatives considered**:
- Manual field filtering — unnecessary code when Prisma already skips undefined.
- Full-object replacement — violates the partial update requirement.

### 3. Locale/PreferredLanguage Validation

**Decision**: Use `@IsIn(['ar', 'en'])` from class-validator on the `locale` field in UpdateUserDto and `preferredLanguage` field in UpdateProfileDto. Both are also `@IsOptional()`.
**Rationale**: `@IsIn()` provides exact value restriction with a clear error message. Simpler than creating a custom enum type for just two values.
**Alternatives considered**:
- Custom TypeScript enum — adds ceremony for a two-value constraint.
- `@Matches(/^(ar|en)$/)` — less readable than `@IsIn`.

### 4. Onboarding Transaction Scope

**Decision**: Use `prisma.$transaction()` to atomically: (1) create all OnboardingResponse records via `createMany`, (2) update UserProfile with background, goals, interests, and onboardingCompleted = true. If either fails, both roll back.
**Rationale**: The spec requires atomic creation of responses + profile update. A transaction ensures no partial state (e.g., responses created but profile not updated).
**Alternatives considered**:
- Sequential creates without transaction — risks partial data on failure.
- Nested writes — Prisma's nested create doesn't support creating OnboardingResponse records tied to the user while simultaneously updating UserProfile in one operation.

### 5. Analytics Service Integration

**Decision**: Add a `capture(userId: string, event: string, properties?: Record<string, any>)` method to the existing AnalyticsService. For now, implement as a stub that logs the event at INFO level. The UsersModule imports AnalyticsModule.
**Rationale**: The AnalyticsService already exists but is empty. Adding a `capture()` method follows the PostHog SDK pattern. The stub allows the onboarding endpoint to work end-to-end while real PostHog integration is a separate feature.
**Alternatives considered**:
- Inline logging in UsersService — violates module isolation.
- Deferring the event entirely — violates FR-011.

### 6. Password Change: Refresh Token Invalidation

**Decision**: On successful password change, set `refreshToken = null` on the user record. This forces re-login on all other sessions/devices because the old refresh token will fail bcrypt comparison against null.
**Rationale**: Same pattern used by the Auth module's `resetPassword` method. Consistent behavior across password-changing operations.
**Alternatives considered**:
- Keep refresh token valid — security risk; someone who stole the old password might still have an active session.
- Delete all sessions table entries — no separate sessions table exists; refresh token is on the User record.

### 7. DTO Field Length Limits

**Decision**: Apply `@MaxLength()` decorators: name (100), country (100), displayName (100), avatarUrl (500), background (1000), goals (1000), interests (1000), questionKey (100), answer (1000).
**Rationale**: Per spec assumptions. 1000 chars for text fields allows detailed answers while preventing abuse. 500 for URLs accommodates long pre-signed S3 URLs.
**Alternatives considered**:
- No limits — DB-level limits (VARCHAR) would cause cryptic errors. DTO validation gives clear messages.
