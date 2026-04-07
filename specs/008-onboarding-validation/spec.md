# Feature Specification: Onboarding Validation Enforcement

**Feature Branch**: `008-onboarding-validation`  
**Created**: 2026-04-06  
**Status**: Draft  
**Input**: Add strict validation to existing onboarding endpoints matching the final Figma design. Validate questionKeys, answers, stepNumbers, and interest limits. Prevent duplicate submissions.  
**Reference**: `docs/onboarding/onboarding.md`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New User Completes Onboarding Successfully (Priority: P1)

A newly registered user who has verified their email submits their onboarding responses — selecting their background, interests, and goals. The system validates that all three steps are present with correct answers and saves them to the user profile.

**Why this priority**: This is the core happy path. Without valid onboarding submission, users cannot proceed to the dashboard. Every other scenario depends on this flow working correctly.

**Independent Test**: Can be fully tested by submitting a valid 3-response payload and verifying the profile is updated with `onboardingCompleted: true`, correct `background`, `goals`, and `interests` values.

**Acceptance Scenarios**:

1. **Given** a verified user who has not completed onboarding, **When** they submit valid responses for background (step 1), interests (step 2), and goals (step 3), **Then** the system saves all 3 responses, updates the user profile with the extracted values, sets `onboardingCompleted` to true, and returns the updated profile.
2. **Given** a verified user who has not completed onboarding, **When** they submit interests with 1 to 4 valid selections as a JSON array string, **Then** the system accepts the submission and stores the interests array string on the profile.

---

### User Story 2 - System Rejects Invalid Onboarding Data (Priority: P1)

A user submits onboarding data that does not match the approved design — invalid question keys, wrong answer values, incorrect step numbers, malformed interests JSON, or missing required steps. The system rejects the request with a descriptive error message.

**Why this priority**: Equally critical to the happy path — without validation, corrupted data enters the system and the frontend/backend contract is broken.

**Independent Test**: Can be tested by submitting payloads with each type of invalid data independently and verifying 400 responses with appropriate error messages.

**Acceptance Scenarios**:

1. **Given** a verified user, **When** they submit a payload missing any of the 3 required question keys (background, interests, goals), **Then** the system returns 400 with a descriptive error.
2. **Given** a verified user, **When** they submit a background answer not in the valid list (e.g., "astronaut"), **Then** the system returns 400.
3. **Given** a verified user, **When** they submit a goals answer not in the valid list, **Then** the system returns 400.
4. **Given** a verified user, **When** they submit interests that are not valid JSON, **Then** the system returns 400.
5. **Given** a verified user, **When** they submit interests with 0 items or more than 4 items, **Then** the system returns 400.
6. **Given** a verified user, **When** they submit interests containing invalid values or duplicates, **Then** the system returns 400.
7. **Given** a verified user, **When** they submit a mismatched stepNumber (e.g., background with stepNumber 2), **Then** the system returns 400.

---

### User Story 3 - System Prevents Duplicate Onboarding Submission (Priority: P2)

A user who has already completed onboarding attempts to submit again. The system rejects the request to prevent overwriting their existing profile data.

**Why this priority**: Important for data integrity, but secondary to the core submission and validation flows.

**Independent Test**: Can be tested by completing onboarding once, then submitting again and verifying the second request is rejected with `ONBOARDING_ALREADY_COMPLETED`.

**Acceptance Scenarios**:

1. **Given** a user whose profile has `onboardingCompleted: true`, **When** they submit onboarding responses again, **Then** the system returns 400 with error code `ONBOARDING_ALREADY_COMPLETED`.

---

### User Story 4 - Idempotent Submission for Incomplete Users (Priority: P3)

A user who started but did not complete onboarding (e.g., partial data from a previous failed attempt) resubmits. The system clears old responses and saves the new ones atomically.

**Why this priority**: Edge case for recovery scenarios — less common but important for robustness.

**Independent Test**: Can be tested by inserting partial onboarding responses into the database, then submitting a complete valid payload and verifying old responses are replaced.

**Acceptance Scenarios**:

1. **Given** a user with existing partial onboarding responses but `onboardingCompleted: false`, **When** they submit a complete valid payload, **Then** the system deletes old responses, saves the new ones, and marks onboarding as complete.

---

### Edge Cases

- What happens when interests JSON contains valid values but as numbers instead of strings? System rejects — all values must be strings.
- How does the system handle a payload with all 3 correct keys but with extra unexpected keys in the responses array? The DTO enforces exactly 3 items via `ArrayMaxSize(3)`, so extra items are rejected.
- What happens when the same questionKey appears twice (e.g., two "background" entries)? The service validates that all 3 distinct keys are present — duplicates would cause a missing key and be rejected.
- What happens when interests JSON is a valid array but contains null or empty string values? System rejects — each item must be a string present in `VALID_INTERESTS`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST require exactly 3 responses in the onboarding submission, one for each of: `background`, `interests`, and `goals`.
- **FR-002**: System MUST validate that `background` answer is one of: `student`, `freelancer`, `employee`, `job_seeker`.
- **FR-003**: System MUST validate that `goals` answer is one of: `learn_new_skill`, `level_up`, `advance_career`, `switch_career`, `build_project`.
- **FR-004**: System MUST validate that `interests` answer is a valid JSON array string containing 1 to 4 items, each from the approved list of 13 interest categories, with no duplicates.
- **FR-005**: System MUST enforce stepNumber consistency: `background` = 1, `interests` = 2, `goals` = 3.
- **FR-006**: System MUST reject onboarding submission if the user has already completed onboarding, returning error code `ONBOARDING_ALREADY_COMPLETED`.
- **FR-007**: System MUST delete existing partial responses before saving new ones within a single atomic operation.
- **FR-008**: System MUST store the validated background, goals, and interests values on the user profile after successful submission.
- **FR-009**: System MUST set `onboardingCompleted` to `true` on the user profile after successful submission.
- **FR-010**: System MUST reject any `questionKey` not in the approved list (`background`, `interests`, `goals`).
- **FR-011**: System MUST reject `stepNumber` values outside the range 1-3.
- **FR-012**: System MUST return descriptive error messages for each validation failure to enable frontend error handling.

### Key Entities

- **OnboardingResponse**: Stores individual question/answer pairs (questionKey, answer, stepNumber) linked to a user. Exactly 3 records per completed onboarding.
- **UserProfile**: Stores aggregated onboarding results (background, goals, interests as JSON string) and the `onboardingCompleted` flag. One-to-one with User.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All valid onboarding submissions (correct keys, valid answers, proper step numbers) are accepted and saved within 2 seconds.
- **SC-002**: 100% of invalid submissions (wrong keys, invalid answers, bad JSON, duplicates, out-of-range steps) are rejected with a 400 status and descriptive error message — no invalid data reaches the database.
- **SC-003**: Duplicate onboarding submissions from users who already completed are rejected 100% of the time with `ONBOARDING_ALREADY_COMPLETED`.
- **SC-004**: All onboarding operations (delete old + create new + update profile) complete atomically — partial writes never persist.
- **SC-005**: All existing tests continue to pass after the changes — zero regressions.
- **SC-006**: New validation test suite covers all 12 functional requirements with at least 40 test cases (DTO + service layers).

## Assumptions

- The Prisma schema (OnboardingResponse and UserProfile models) is already correct and requires no migration.
- The controller routes, guards (JwtAuthGuard, EmailVerifiedGuard), and rate limiting are already correctly configured and will not be modified.
- The `getOnboardingStatus()` endpoint works correctly and will not be modified.
- The frontend will send interests as a JSON array string (e.g., `'["ai","programming"]'`), not as a native array.
- The 13 interest categories and 4 background options are final and approved via the Figma design.
- The analytics integration (`onboarding_completed` event) is already in place and only needs to be preserved.
