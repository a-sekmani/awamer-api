# Feature Specification: Email Verification

**Feature Branch**: `007-email-verification`  
**Created**: 2026-04-01  
**Status**: Draft  
**Input**: User description: "Add Email Verification as a mandatory step after registration and before onboarding"  
**Jira**: KAN-69

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New User Verifies Email After Registration (Priority: P1)

A new user registers on the platform and immediately receives a 6-digit verification code to their email. They enter the code on the verification screen to prove ownership of their email address. Once verified, they proceed to onboarding and then the dashboard.

**Why this priority**: Email verification is the core of this feature. Without it, the entire flow is incomplete. This is the primary path every new user must follow.

**Independent Test**: Can be fully tested by registering a new account, receiving the OTP via email, entering it correctly, and confirming the user gains access to onboarding. Delivers the core value of verified email addresses.

**Acceptance Scenarios**:

1. **Given** a user has just registered, **When** registration completes, **Then** a 6-digit verification code is automatically sent to their email and the response indicates email verification is required.
2. **Given** a user has received a valid verification code, **When** they submit the correct 6-digit code within 10 minutes, **Then** their email is marked as verified and they can proceed to onboarding.
3. **Given** a user has received a verification code, **When** they submit an incorrect code, **Then** they receive an error message and the attempt count increments.
4. **Given** a user submits an incorrect code 5 times, **When** they attempt a 6th submission with the same code, **Then** that code is invalidated and they must request a new one.

---

### User Story 2 - User Requests a New Verification Code (Priority: P2)

A user who did not receive the verification email, or whose code has expired (after 10 minutes), requests a new verification code. The system sends a fresh code and invalidates all previous codes.

**Why this priority**: Users frequently miss emails or take too long. Resending is essential for a complete verification flow.

**Independent Test**: Can be tested by registering, waiting for the code to expire (or simulating expiry), requesting a resend, and verifying the new code works while old codes are rejected.

**Acceptance Scenarios**:

1. **Given** a registered user whose verification code has expired, **When** they request a new code, **Then** a new 6-digit code is sent and all previous codes are invalidated.
2. **Given** a user has already requested 3 codes within 15 minutes, **When** they request another code, **Then** they receive a rate-limit error and must wait before requesting again.
3. **Given** a user whose email is already verified, **When** they request a verification code, **Then** they receive an error indicating their email is already verified.

---

### User Story 3 - Returning Unverified User Logs In (Priority: P2)

A user who registered but never completed email verification logs back in. The system indicates that email verification is still required, allowing them to resume the verification flow.

**Why this priority**: Users may abandon the flow and return later. The system must correctly communicate verification status on login to guide them back.

**Independent Test**: Can be tested by registering without verifying, logging out, logging back in, and confirming the login response indicates verification is required.

**Acceptance Scenarios**:

1. **Given** a user registered but did not verify their email, **When** they log in, **Then** the login response includes their verification status and indicates verification is required.
2. **Given** a user has verified their email, **When** they log in, **Then** the login response shows their email is verified and no verification is required.

---

### User Story 4 - Unverified User Is Blocked from Protected Actions (Priority: P1)

A user who has not verified their email attempts to access onboarding, learning content, or enrollment features. The system blocks access and directs them to complete email verification first.

**Why this priority**: This enforces the mandatory nature of email verification. Without this guard, the verification step could be bypassed entirely.

**Independent Test**: Can be tested by registering without verifying, then attempting to access onboarding or learning endpoints, and confirming access is denied with an appropriate message.

**Acceptance Scenarios**:

1. **Given** an unverified user, **When** they attempt to submit onboarding data, **Then** they are denied access with a message to verify their email first.
2. **Given** an unverified user, **When** they attempt to access learning or enrollment features, **Then** they are denied access.
3. **Given** an unverified user, **When** they access their own profile, **Then** they are allowed (profile viewing is not restricted).
4. **Given** a verified user, **When** they access any protected feature, **Then** access is granted normally (verification guard does not interfere).

---

### Edge Cases

- What happens when a user tries to verify with an expired code? They receive a clear error indicating the code has expired and should request a new one.
- What happens when a user exhausts all 5 attempts on a code? The code is invalidated; they must request a new code via the resend endpoint.
- What happens when a user hits the rate limit (3 sends in 15 minutes)? They receive a rate-limit error with guidance to wait before requesting again.
- What happens when an already-verified user tries to send or resend a verification code? They receive an error stating their email is already verified.
- What happens if the email delivery fails? The user can request a resend. The system does not guarantee delivery but provides the resend mechanism.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST send a 6-digit verification code to the user's email automatically upon registration.
- **FR-002**: System MUST allow authenticated users to submit a 6-digit code to verify their email address.
- **FR-003**: System MUST invalidate verification codes after 10 minutes.
- **FR-004**: System MUST limit failed verification attempts to 5 per code, invalidating the code after the 5th failed attempt.
- **FR-005**: System MUST rate-limit verification code requests to a maximum of 3 per user within a 15-minute window.
- **FR-006**: System MUST invalidate all previous unused codes when a new code is generated.
- **FR-007**: System MUST mark the user's email as verified upon successful code submission, updating both the verification record and user record atomically.
- **FR-008**: System MUST return the user's email verification status in registration and login responses.
- **FR-009**: System MUST prevent unverified users from accessing onboarding submission, learning endpoints, and enrollment endpoints.
- **FR-010**: System MUST allow unverified users to access their own profile and all authentication/verification endpoints.
- **FR-011**: System MUST reject verification or resend requests from users whose email is already verified.
- **FR-012**: System MUST send the verification email in both Arabic and English (bilingual).
- **FR-013**: System MUST accept only exactly 6 numeric digits as a valid verification code input.

### Key Entities

- **User**: Extended with an email verification status flag. Represents the platform user whose email ownership must be confirmed.
- **EmailVerification**: Represents a single verification code instance. Tracks the code value, expiration time, number of failed attempts, and whether it has been used. Each record belongs to one user, and a user may have multiple records over time (only the latest unused and unexpired one is valid).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly registered users receive a verification code automatically without additional user action.
- **SC-002**: Users can complete email verification (receive code and submit it) in under 2 minutes under normal conditions.
- **SC-003**: Verification codes are reliably invalidated after 10 minutes, with zero successful verifications using expired codes.
- **SC-004**: Brute-force attempts are blocked: no code can be guessed after 5 failed attempts, and no user can request more than 3 codes in 15 minutes.
- **SC-005**: Unverified users are blocked from all protected features with zero bypass scenarios.
- **SC-006**: Verified users experience no additional friction or access delays from the verification system.
- **SC-007**: Verification emails are delivered in both Arabic and English in a single message.

## Assumptions

- Users have access to their registered email inbox at the time of registration.
- The existing email sending infrastructure is operational and configured.
- The verification flow is handled on the frontend by the separate web application; this specification covers only the backend endpoints and logic.
- All verification endpoints require the user to be authenticated (JWT token obtained during registration/login).
- The 15-minute rate-limit window is a rolling window based on the creation timestamps of verification records.
- Existing users in the system (registered before this feature) will be treated as email-verified to avoid disrupting their access (migration default).
