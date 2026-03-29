# Feature Specification: Complete Auth Module

**Feature Branch**: `003-auth-module`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "Build a complete Auth module with 6 endpoints: register, login, logout, refresh, forgot-password, reset-password."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — New User Registration (Priority: P1)

A new visitor to the Awamer platform wants to create an account so they can access educational content. They provide their name, email, password, and country. Upon successful registration, they are automatically signed in with a learner role, an empty profile is created for them, and they receive a free subscription plan — all in one seamless step.

**Why this priority**: Registration is the entry point to the platform. Without it, no other user journey (login, learning, payments) can occur. This is the foundational user acquisition flow.

**Independent Test**: Can be tested by submitting a registration form with valid data and verifying the user is created, signed in, and can access learner-level content immediately.

**Acceptance Scenarios**:

1. **Given** a visitor is not registered, **When** they submit valid name, email, password, and country, **Then** an account is created, they are automatically signed in, and they receive secure session credentials.
2. **Given** a visitor submits a registration form, **When** the email is already in use, **Then** the system returns a clear error message indicating the email is taken.
3. **Given** a visitor submits a registration form, **When** the password does not meet strength requirements (minimum 8 characters, uppercase, lowercase, number), **Then** the system returns a specific validation error describing the requirement.
4. **Given** a visitor submits a registration form, **When** the email format is invalid, **Then** the system returns a validation error for the email field.
5. **Given** registration succeeds, **When** the system creates the account, **Then** a user profile, learner role, and free subscription are all created together — if any part fails, none are saved (all-or-nothing).

---

### User Story 2 — Returning User Login (Priority: P1)

A registered user wants to sign in to their account using their email and password. Upon successful login, they receive a short-lived session credential and a long-lived refresh credential, both delivered securely. The system records their last login time.

**Why this priority**: Login is the most frequently used auth endpoint and is required for every returning user session. Without login, registered users cannot access the platform.

**Independent Test**: Can be tested by logging in with valid credentials and verifying the user receives session credentials, then making an authenticated request to confirm access.

**Acceptance Scenarios**:

1. **Given** a registered user, **When** they submit valid email and password, **Then** they are signed in and receive secure session credentials with a short-lived access credential (15 minutes) and a long-lived refresh credential (7 days).
2. **Given** a registered user, **When** they submit an incorrect password, **Then** the system returns a generic "invalid credentials" error (not specifying which field is wrong).
3. **Given** an unregistered email, **When** someone attempts to log in, **Then** the system returns the same generic "invalid credentials" error (no email enumeration).
4. **Given** a successful login, **When** the user checks their profile, **Then** the last login timestamp is updated.

---

### User Story 3 — Session Refresh (Priority: P1)

A signed-in user whose short-lived session credential has expired needs to seamlessly obtain a new one without re-entering their password. The system uses the long-lived refresh credential to issue a fresh pair, and the old refresh credential is invalidated (rotated) for security.

**Why this priority**: Without token refresh, users would be forced to log in every 15 minutes, creating an unacceptable user experience. This is critical for session continuity.

**Independent Test**: Can be tested by obtaining credentials via login, waiting for the short-lived credential to expire, then calling the refresh endpoint and verifying a new valid pair is issued while the old refresh credential no longer works.

**Acceptance Scenarios**:

1. **Given** a user has a valid refresh credential, **When** they request a session refresh, **Then** they receive a new short-lived credential and a new refresh credential.
2. **Given** a user refreshes their session, **When** they attempt to reuse the old refresh credential, **Then** the system rejects it (one-time use / rotation).
3. **Given** a user has an expired or invalid refresh credential, **When** they request a refresh, **Then** the system returns an authentication error and they must log in again.

---

### User Story 4 — User Logout (Priority: P2)

A signed-in user wants to end their session securely. This removes their session credentials and invalidates the refresh credential so it cannot be reused.

**Why this priority**: Logout is essential for security but is less frequently used than login/refresh. Users expect it to work but it does not block other flows.

**Independent Test**: Can be tested by logging in, then logging out, and verifying that the previous credentials no longer grant access and the refresh credential is invalidated.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they request logout, **Then** their session credentials are cleared and the refresh credential is removed from the system.
2. **Given** a user has logged out, **When** they attempt to use the old refresh credential, **Then** the system rejects it.
3. **Given** an unauthenticated request, **When** someone calls the logout endpoint, **Then** the system returns an authentication error.

---

### User Story 5 — Forgot Password (Priority: P2)

A user who has forgotten their password wants to initiate a password reset. They provide their email address and, if the email is registered, receive a reset link via email. The system always responds identically regardless of whether the email exists, to prevent email enumeration attacks.

**Why this priority**: Password recovery is important for user retention (users who cannot reset their password churn), but it depends on the email delivery service being available.

**Independent Test**: Can be tested by requesting a password reset for a registered email and verifying a reset email is sent, then requesting a reset for an unregistered email and verifying the same success response is returned (no information leakage).

**Acceptance Scenarios**:

1. **Given** a registered user's email, **When** they request a password reset, **Then** a reset email with a secure, time-limited link is sent to that address.
2. **Given** an unregistered email, **When** someone requests a password reset, **Then** the system returns the same success response as for a registered email (no enumeration).
3. **Given** a reset request, **When** the system generates the reset link, **Then** the link contains a secure, single-use token that expires after a limited time.
4. **Given** a reset email was sent, **When** the user checks the email, **Then** it contains clear instructions and a link to complete the password reset.

---

### User Story 6 — Reset Password (Priority: P2)

A user who received a password reset email wants to set a new password using the reset link. They provide the reset token and a new password meeting the strength requirements. Upon success, the token is invalidated and cannot be reused.

**Why this priority**: This completes the forgot-password flow and is required for full password recovery support.

**Independent Test**: Can be tested by triggering a forgot-password flow, extracting the reset token, submitting a new password with that token, and verifying the new password works for login while the token no longer works.

**Acceptance Scenarios**:

1. **Given** a valid reset token and a new password meeting requirements, **When** the user submits the reset, **Then** the password is updated and the token is invalidated.
2. **Given** an expired or already-used reset token, **When** someone attempts to reset the password, **Then** the system returns an error indicating the token is invalid or expired.
3. **Given** a valid token but a weak password, **When** the user submits the reset, **Then** the system returns a validation error describing the password requirements.
4. **Given** a successful password reset, **When** the user logs in with the new password, **Then** authentication succeeds.
5. **Given** a successful password reset, **When** the user tries to log in with the old password, **Then** authentication fails.

---

### Edge Cases

- What happens when a user registers with leading/trailing whitespace in their email? The system must normalize (trim and lowercase) the email before validation and storage.
- What happens when a user submits multiple forgot-password requests in quick succession? The system should rate-limit this endpoint to prevent abuse.
- What happens when a user attempts to register with an extremely long name or email? The system must enforce maximum field length limits.
- What happens when the refresh token stored in the system does not match the one presented by the client? The system must reject the refresh and force a re-login.
- What happens when a user's account status is suspended or inactive? Login and refresh should be denied with an appropriate error.
- What happens when the password reset token is tampered with? The system must reject invalid tokens and return a generic error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow new users to register with name, email, password, and country.
- **FR-002**: System MUST validate email format and uniqueness during registration, returning a clear error if the email is already registered.
- **FR-003**: System MUST enforce password strength: minimum 8 characters, at least one uppercase letter, one lowercase letter, and one number.
- **FR-004**: System MUST create a user account, user profile, learner role, and free subscription together in a single atomic operation during registration — if any step fails, none are persisted.
- **FR-005**: System MUST issue a short-lived access credential (15-minute lifetime) and a long-lived refresh credential (7-day lifetime) upon successful registration or login.
- **FR-006**: System MUST deliver session credentials via secure, HTTP-only, same-site cookies to prevent client-side script access.
- **FR-007**: System MUST store passwords using a one-way hash with a cost factor of 12 rounds — plaintext passwords must never be stored or logged.
- **FR-008**: System MUST return identical error responses for invalid email and invalid password during login to prevent credential enumeration.
- **FR-009**: System MUST update the user's last login timestamp on each successful login.
- **FR-010**: System MUST store the active refresh credential in the database and validate it on each refresh request.
- **FR-011**: System MUST rotate (replace) the refresh credential on each successful refresh — the old credential becomes invalid immediately.
- **FR-012**: System MUST clear session cookies and remove the stored refresh credential on logout.
- **FR-013**: System MUST return an identical success response for forgot-password requests regardless of whether the email exists, to prevent email enumeration.
- **FR-014**: System MUST generate a secure, single-use, time-limited token for password reset (default: 1 hour expiry).
- **FR-015**: System MUST send the password reset link via email to the registered address.
- **FR-016**: System MUST validate the reset token and update the password hash on reset-password, then invalidate the token.
- **FR-017**: System MUST validate all incoming request data using DTOs with field-level validation decorators for each of the 6 endpoints.
- **FR-018**: System MUST apply rate limiting on authentication endpoints to prevent brute-force attacks.
- **FR-019**: System MUST normalize email input (trim whitespace, convert to lowercase) before validation and storage.
- **FR-020**: System MUST deny login and refresh for users with inactive or suspended account status.

### Key Entities

- **User**: The central identity record holding name, email, hashed password, country, locale, account status, refresh credential, and last login timestamp. Related one-to-one with UserProfile, one-to-many with UserRole.
- **UserProfile**: Created alongside User during registration. Holds display preferences and onboarding state. Initially empty except for defaults.
- **UserRole**: Associates a user with a platform role (learner or admin). A learner role is assigned automatically on registration.
- **SubscriptionPlan**: Defines available subscription tiers. The default free plan is assigned to new users.
- **Subscription**: Links a user to a plan. A free-tier subscription is created as part of registration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: New users can complete registration and access the platform in under 5 seconds from form submission.
- **SC-002**: Returning users can sign in and reach their dashboard in under 3 seconds.
- **SC-003**: Session refresh completes transparently without user interaction in under 1 second.
- **SC-004**: 100% of password reset emails are delivered within 60 seconds of the request (when the email service is available).
- **SC-005**: Zero plaintext passwords are stored, logged, or exposed in any system output.
- **SC-006**: Email enumeration is not possible through any combination of register, login, or forgot-password responses.
- **SC-007**: All 6 authentication endpoints reject malformed input with clear, field-specific validation errors.
- **SC-008**: Expired or reused refresh credentials are rejected 100% of the time — no stale credential reuse is possible.

## Assumptions

- The database schema for User, UserProfile, UserRole, SubscriptionPlan, and Subscription already exists (created in feature 002-prisma-schema).
- A default free SubscriptionPlan record exists in the database (or will be seeded) before registration is used.
- The email delivery service is configured and available for sending password reset emails. If the email service is unavailable, the forgot-password endpoint still returns a success response but logs the failure.
- The frontend application is hosted at a known origin and will send credentials via cookies (same-site policy applies).
- Rate limiting is applied at the endpoint level using the existing throttler configuration.
- The password reset token is stored as a hashed value on the User record (or a dedicated field) with an expiry timestamp, rather than in a separate table.
- Account status checks (active/inactive/suspended) are performed during login and refresh but not during registration (new accounts are always created as active).
- The system supports only email/password authentication in this feature. Social login (OAuth) is out of scope.
