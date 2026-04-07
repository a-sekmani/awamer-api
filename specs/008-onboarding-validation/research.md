# Research: Onboarding Validation Enforcement

**Feature**: 008-onboarding-validation
**Date**: 2026-04-06

## Research Summary

No NEEDS CLARIFICATION items exist — the reference spec (`docs/onboarding/onboarding.md`) provides complete data contracts, valid values, validation rules, and error cases. This research documents the decisions made.

## Decision 1: DTO Validation Strategy

**Decision**: Use class-validator decorators at the DTO level for structural validation (array size, types, allowed keys) and service-level validation for business logic (JSON parsing of interests, cross-field consistency between questionKey and stepNumber).

**Rationale**: class-validator handles structural constraints declaratively. Business rules like "parse interests as JSON array and validate each item" require procedural logic that belongs in the service layer.

**Alternatives considered**:
- Custom class-validator decorator for interests JSON parsing — rejected because the validation logic is complex (parse → check array → check length → check values → check duplicates) and would be hard to test and debug inside a decorator.
- Validate everything in the service — rejected because basic structural checks (array size, required fields, allowed enum values) are better expressed declaratively via decorators.

## Decision 2: Interests Storage Format

**Decision**: Store interests as a JSON array string on UserProfile.interests (e.g., `'["ai","programming"]'`). The frontend sends it this way, and we store it as-is after validation.

**Rationale**: The existing UserProfile.interests field is `String?` in Prisma. Changing it to `Json` would require a migration, which is out of scope. The JSON string format is already established in the existing implementation.

**Alternatives considered**:
- Change the Prisma field to `Json` type — rejected because it requires a migration and the spec explicitly states no migration needed.
- Store interests as comma-separated string — rejected because JSON array is more structured and the frontend already sends JSON.

## Decision 3: Duplicate Submission Prevention

**Decision**: Check `userProfile.onboardingCompleted` before processing. If `true`, throw `BadRequestException` with `ONBOARDING_ALREADY_COMPLETED` error code.

**Rationale**: Simple, efficient, and idempotent. The profile flag is the source of truth for completion status.

**Alternatives considered**:
- Check OnboardingResponse count — rejected because responses could exist from a partial/failed attempt without completion being true.
- Use a database unique constraint — rejected because the check is business logic, not a schema concern.

## Decision 4: Idempotency for Retry Submissions

**Decision**: Delete existing OnboardingResponse records for the user before creating new ones, within the same transaction. This handles the case where a user's previous attempt partially saved data.

**Rationale**: Using `deleteMany` + `createMany` inside `$transaction` ensures atomicity. The user always ends up with exactly 3 clean response records.

**Alternatives considered**:
- Upsert — rejected because `createMany` doesn't support upsert, and the questionKey isn't a unique constraint.
- Skip deletion if no existing records — rejected because the extra check adds complexity without benefit; `deleteMany` with 0 matches is a no-op.

## Decision 5: Error Code Addition

**Decision**: Add `ONBOARDING_ALREADY_COMPLETED` to the existing `ErrorCode` enum in `src/common/error-codes.enum.ts`. This code already has a placeholder in the enum file.

**Rationale**: The error code enum already contains `ONBOARDING_ALREADY_COMPLETED` — it was added during the initial users module implementation. Verify it exists; if not, add it.

## Technology Choices

No new dependencies required. All validation uses existing class-validator decorators and native JSON.parse().
