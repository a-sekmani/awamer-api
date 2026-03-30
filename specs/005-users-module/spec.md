# Feature Specification: Complete Users Module

**Feature Branch**: `005-users-module`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "Build a complete Users module with 6 endpoints: get profile, update user, update profile, change password, submit onboarding, get onboarding status."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — View My Complete Profile (Priority: P1)

A signed-in learner wants to view their full account information — including their basic details, profile preferences, assigned role, and current subscription plan — on a single dashboard screen. This is the first thing the frontend loads after login.

**Why this priority**: This is the most frequently called user endpoint. The frontend's dashboard, sidebar, and navigation all depend on it. Without it, the app cannot display the user's name, avatar, role, or subscription status.

**Independent Test**: Call the "get me" endpoint with a valid session — verify the response includes the user's basic info, profile, role string, and subscription with its plan details.

**Acceptance Scenarios**:

1. **Given** an authenticated learner, **When** they request their profile, **Then** they receive their basic account info (name, email, country, locale, status), profile details (displayName, avatarUrl, background, goals, interests, preferredLanguage, onboardingCompleted), their role as a string, and their active subscription with the associated plan.
2. **Given** an unauthenticated request, **When** someone calls this endpoint, **Then** the system returns a 401 authentication error.
3. **Given** an authenticated user with no subscription (edge case), **When** they request their profile, **Then** the subscription field is null or omitted gracefully.

---

### User Story 2 — Update My Account Details (Priority: P1)

A learner wants to update their display name, country, or language preference. The locale setting controls the platform language (Arabic or English) and must only accept these two values.

**Why this priority**: Users need to personalize their experience immediately after registration. Language switching between Arabic and English is a core requirement for the Saudi market.

**Independent Test**: Call the update endpoint with a new name and locale, then call the "get me" endpoint and verify the changes are reflected.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they submit a valid update with name, country, and locale, **Then** the updated user record is returned.
2. **Given** a locale value other than "ar" or "en", **When** the update is submitted, **Then** the system returns a validation error rejecting the invalid locale.
3. **Given** a partial update (only name, no country or locale), **When** submitted, **Then** only the provided fields are updated; others remain unchanged.
4. **Given** an empty request body, **When** submitted, **Then** the system processes it gracefully (no fields updated, current user returned).

---

### User Story 3 — Update My Profile Preferences (Priority: P1)

A learner wants to update their profile details — display name, avatar URL, background, goals, interests, and preferred language. These fields are distinct from the basic account info and control how the learner's profile appears to others and how the platform personalizes their experience.

**Why this priority**: Profile customization is essential for learner engagement and drives the personalized learning experience. The preferred language field here applies to content preferences, separate from the account-level locale.

**Independent Test**: Update the profile with new values, then verify the "get me" endpoint returns the updated profile fields.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they submit updated profile fields (displayName, avatarUrl, background, goals, interests, preferredLanguage), **Then** the profile is updated and the new values are returned.
2. **Given** a partial profile update, **When** only some fields are provided, **Then** only those fields are updated; others remain unchanged.
3. **Given** preferredLanguage is not "ar" or "en", **When** submitted, **Then** the system returns a validation error.

---

### User Story 4 — Complete Onboarding (Priority: P1)

A newly registered learner must complete an onboarding questionnaire immediately after signup. They provide answers to a series of questions (each with a question key, answer, and step number). The system stores each answer individually, updates the profile with summary values (background, goals, interests), marks onboarding as completed, and fires an analytics event.

**Why this priority**: Onboarding is mandatory after signup (per User Flows §8.1). It drives personalization — without it, the platform cannot recommend relevant content. The analytics event tracks conversion from registration to onboarding completion.

**Independent Test**: Submit onboarding responses for a new user, then verify: individual responses are stored, profile is updated with summary fields, onboardingCompleted is true, and the analytics event was fired.

**Acceptance Scenarios**:

1. **Given** a newly registered user who has not completed onboarding, **When** they submit their onboarding responses, **Then** each response is stored as a separate record (question key, answer, step number), the profile is updated with background, goals, and interests, onboardingCompleted is set to true, and an analytics event "onboarding_completed" is fired.
2. **Given** the responses array is empty, **When** submitted, **Then** the system returns a validation error requiring at least one response.
3. **Given** a response with a missing question key or answer, **When** submitted, **Then** the system returns a field-level validation error.
4. **Given** all operations succeed, **When** the profile is returned, **Then** it reflects the newly set background, goals, interests, and onboardingCompleted = true.

---

### User Story 5 — Change My Password (Priority: P2)

A signed-in learner wants to change their password. They provide their current password for verification and a new password meeting the platform's strength requirements. The current password is checked securely using one-way hash comparison.

**Why this priority**: Password change is a security-sensitive feature but is used less frequently than profile management. It must be correct but doesn't block the core user experience.

**Independent Test**: Change the password with a valid current password, then verify login works with the new password and fails with the old one.

**Acceptance Scenarios**:

1. **Given** an authenticated user with a valid current password, **When** they submit the current password and a new strong password, **Then** the password is updated and a success message is returned.
2. **Given** an incorrect current password, **When** submitted, **Then** the system returns a 400 error with "Current password is incorrect".
3. **Given** a new password that doesn't meet strength requirements (minimum 8 characters, uppercase, lowercase, number), **When** submitted, **Then** the system returns a validation error.
4. **Given** a successful password change, **When** the user's existing sessions are checked, **Then** the refresh token is invalidated (forcing re-login on other devices).

---

### User Story 6 — View Onboarding Status (Priority: P2)

A signed-in user (or the frontend) wants to check whether onboarding has been completed and review the stored onboarding responses. The frontend uses this to decide whether to redirect the user to the onboarding flow or to the dashboard.

**Why this priority**: Required for the frontend to implement the mandatory onboarding redirect. Lower priority than submitting onboarding because it's a read-only check.

**Independent Test**: Call the onboarding status endpoint for a user who has and hasn't completed onboarding — verify the completed flag and responses list.

**Acceptance Scenarios**:

1. **Given** a user who has completed onboarding, **When** they check their onboarding status, **Then** the response shows completed = true and includes all stored responses.
2. **Given** a user who has not completed onboarding, **When** they check their status, **Then** the response shows completed = false and an empty responses list.

---

### Edge Cases

- What happens when a user tries to update their profile but has no UserProfile record? The system should handle this gracefully (create one if missing, or return a clear error).
- What happens when the onboarding submission includes duplicate question keys? The system should store all responses (allowing re-answers) or reject duplicates — assumed: store all, as re-submission may overwrite.
- What happens when the "get me" endpoint is called for a user whose subscription has expired? The subscription data should still be returned with its current status (expired), not omitted.
- What happens when extremely long strings are submitted for profile fields (goals, interests, background)? The system must enforce reasonable maximum lengths.
- What happens when the password change is attempted with the same password as the current one? The system should allow it (no "must be different" restriction unless specified).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST return the authenticated user's complete profile including basic info, profile details, role string, and active subscription with plan on the "get me" endpoint.
- **FR-002**: System MUST allow users to update their name, country, and locale (restricted to "ar" or "en" only) via a partial update — only provided fields are changed.
- **FR-003**: System MUST allow users to update their profile fields (displayName, avatarUrl, background, goals, interests, preferredLanguage) via a partial update — only provided fields are changed.
- **FR-004**: System MUST restrict preferredLanguage on the profile to "ar" or "en" only, rejecting other values with a validation error.
- **FR-005**: System MUST verify the current password using one-way hash comparison (12 rounds cost factor) before allowing a password change.
- **FR-006**: System MUST return a 400 error with message "Current password is incorrect" when the current password verification fails.
- **FR-007**: System MUST enforce password strength on the new password: minimum 8 characters, at least one uppercase letter, one lowercase letter, and one number.
- **FR-008**: System MUST invalidate the user's refresh token upon successful password change (forcing re-login on other sessions).
- **FR-009**: System MUST store each onboarding response as a separate record with question key, answer text, and step number.
- **FR-010**: System MUST update the user's profile with summary values (background, goals, interests) and set onboardingCompleted to true upon successful onboarding submission.
- **FR-011**: System MUST fire an analytics event "onboarding_completed" with the user's ID upon successful onboarding submission.
- **FR-012**: System MUST return the onboarding completion status (boolean) and all stored onboarding responses on the status endpoint.
- **FR-013**: All 6 endpoints MUST require authentication — unauthenticated requests receive a 401 error.
- **FR-014**: All endpoints MUST validate incoming request data and return field-level validation errors for invalid input.
- **FR-015**: All successful responses MUST follow the standard wrapper format: `{ data: {...}, message: "Success" }`.
- **FR-016**: System MUST apply rate limiting to all user endpoints to prevent abuse.
- **FR-017**: System MUST never expose the password hash, refresh token, or password reset fields in any response.

### Key Entities

- **User**: The authenticated user's core identity — name, email, country, locale, status. Updated via the account update endpoint. Password hash is modified via the password change endpoint but never exposed.
- **UserProfile**: Extended user preferences — displayName, avatarUrl, background, goals, interests, preferredLanguage, onboardingCompleted. Updated via the profile update and onboarding endpoints.
- **UserRole**: Associates the user with their platform role (learner or admin). Returned as a string in the "get me" response.
- **Subscription + SubscriptionPlan**: The user's active subscription and its associated plan details. Returned in the "get me" response to show the user's current access level.
- **OnboardingResponse**: Individual question-answer records from the onboarding flow. Each has a question key, answer, step number, and timestamp. Created during onboarding submission and read during status check.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view their complete profile (including role and subscription) in under 2 seconds.
- **SC-002**: Profile updates (name, locale, preferences) are reflected immediately on the next page load.
- **SC-003**: 100% of onboarding submissions result in all individual responses being stored and the profile being updated atomically.
- **SC-004**: Password changes take effect immediately — the old password is rejected on the next login attempt.
- **SC-005**: The onboarding status check correctly identifies completed vs. incomplete users 100% of the time.
- **SC-006**: All 6 endpoints reject unauthenticated requests with a 401 error.
- **SC-007**: All validation errors include field-specific messages so users know exactly what to fix.
- **SC-008**: The "onboarding_completed" analytics event fires for every successful onboarding submission.

## Assumptions

- The database schema for User, UserProfile, UserRole, OnboardingResponse, Subscription, and SubscriptionPlan already exists (created in feature 002-prisma-schema).
- Authentication is handled by the Auth module (feature 003-auth-module) via JwtAuthGuard — the Users module does not implement its own auth logic.
- The analytics service (PostHog) is available as an injectable service or module. If not yet implemented, the onboarding endpoint will call a stub/placeholder analytics method.
- The "get me" endpoint returns the user's first (primary) role as a string, not an array — each user has exactly one active role for display purposes.
- The "get me" endpoint returns the most recent active subscription. If a user has multiple subscriptions (edge case), the most recent active one is returned.
- Onboarding responses are append-only — submitting onboarding a second time adds new responses rather than replacing existing ones. The profile summary fields (background, goals, interests) are always overwritten with the latest submission.
- The password strength validation rules match those defined in the Auth module (feature 003-auth-module) for consistency: minimum 8 characters, uppercase + lowercase + number.
- Field length limits: name (max 100), country (max 100), displayName (max 100), avatarUrl (max 500), background (max 1000), goals (max 1000), interests (max 1000).
