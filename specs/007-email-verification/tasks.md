# Tasks: Email Verification

**Input**: Design documents from `/specs/007-email-verification/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in spec. Skipped.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)

## Phase 1: Setup

**Purpose**: Database schema changes and migration

- [x] T001 Add `emailVerified` Boolean field (default `false`) to User model and add `EmailVerification` model with all fields (id, userId, code, expiresAt, attempts, used, createdAt), indexes (userId; userId+used+expiresAt composite), and User relation in `prisma/schema.prisma`
- [x] T002 Run `npx prisma migrate dev --name add-email-verification` to generate and apply the migration
- [x] T003 Add a data migration SQL statement inside the generated migration file to set `emailVerified = true` for all existing users (UPDATE "User" SET "emailVerified" = true)

**Checkpoint**: Schema updated, migration applied, existing users preserved as verified

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared components that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Create `VerifyEmailDto` with `code` field validated by `@IsString()`, `@Length(6, 6)`, and `@Matches(/^\d{6}$/)` in `src/auth/dto/verify-email.dto.ts`
- [x] T005 [P] Add `sendVerificationEmail(email: string, code: string, name: string)` method to `src/mail/mail.service.ts` — bilingual HTML email with Arabic (top, RTL) and English (bottom, LTR) sections displaying the 6-digit code prominently. Log the code in dev mode.
- [x] T006 [P] Add `sendVerificationCode(userId: string)` method to `src/auth/auth.service.ts` — fetch user from DB, check `emailVerified` (throw 400 if true), count codes created in last 15 minutes (throw 429 if >= 3), invalidate all previous unused codes (`used = true`) in a transaction, generate OTP via `crypto.randomInt(100000, 999999)`, create `EmailVerification` record with `expiresAt = now + 10min`, call `mailService.sendVerificationEmail`
- [x] T007 Add `verifyEmail(userId: string, code: string)` method to `src/auth/auth.service.ts` — check `emailVerified` (throw 400 if true), find latest `EmailVerification` where `used = false` and `expiresAt > now()`, throw 400 if not found, check `attempts >= 5` (set `used = true` and throw 400), compare code (on mismatch: increment attempts, if attempts reaches 5 set `used = true`, throw 400), on match: `prisma.$transaction` to set `EmailVerification.used = true` and `User.emailVerified = true`, return `{ emailVerified: true }`
- [x] T008 Update `sanitizeUser` method in `src/auth/auth.service.ts` to include `emailVerified` and computed `requiresVerification: !user.emailVerified` in the returned user object

**Checkpoint**: Foundation ready — all service methods and DTO available for controller wiring

---

## Phase 3: User Story 1 — New User Verifies Email After Registration (Priority: P1) MVP

**Goal**: After registration, user receives OTP email and can verify their email by submitting the 6-digit code.

**Independent Test**: Register → receive OTP → submit correct code → emailVerified becomes true.

### Implementation for User Story 1

- [x] T009 [US1] Modify `register()` method in `src/auth/auth.service.ts` — after user creation transaction completes, call `this.sendVerificationCode(user.id)` (wrap in try/catch so registration succeeds even if email fails). Update return to include `emailVerified: false` and `requiresVerification: true` via `sanitizeUser`.
- [x] T010 [US1] Add `POST /auth/send-verification` endpoint to `src/auth/auth.controller.ts` — protected by `JwtAuthGuard`, extract `userId` from request, call `authService.sendVerificationCode(userId)`, return `{ data: null, message: "Verification code sent to your email" }`
- [x] T011 [US1] Add `POST /auth/verify-email` endpoint to `src/auth/auth.controller.ts` — protected by `JwtAuthGuard`, accept `VerifyEmailDto` body, extract `userId` from request, call `authService.verifyEmail(userId, dto.code)`, return `{ data: { emailVerified: true }, message: "Email verified successfully" }`

**Checkpoint**: User Story 1 fully functional — register sends OTP, user can send and verify codes

---

## Phase 4: User Story 4 — Unverified User Is Blocked from Protected Actions (Priority: P1)

**Goal**: Unverified users cannot access onboarding, learning, or enrollment endpoints.

**Independent Test**: Register without verifying → attempt POST /users/me/onboarding → get 403. Verify email → retry → succeeds.

### Implementation for User Story 4

- [x] T012 [P] [US4] Create `@SkipEmailVerification()` decorator using `SetMetadata` in `src/common/decorators/skip-email-verification.decorator.ts` — follows the same pattern as `@Public()` decorator
- [x] T013 [P] [US4] Create `EmailVerifiedGuard` implementing `CanActivate` in `src/common/guards/email-verified.guard.ts` — inject `Reflector` and `PrismaService`, check for `@SkipEmailVerification()` metadata (skip if present), get `userId` from `request.user`, query `User.emailVerified` from DB, if `false` throw `ForbiddenException` with message "Email verification required. Please verify your email before accessing this resource"
- [x] T014 [US4] Apply `@UseGuards(EmailVerifiedGuard)` to `POST /users/me/onboarding` (`submitOnboarding` method) in `src/users/users.controller.ts`

**Checkpoint**: User Story 4 functional — unverified users blocked from onboarding, verified users pass through

---

## Phase 5: User Story 2 — User Requests a New Verification Code (Priority: P2)

**Goal**: User can request a new verification code, with rate limiting and automatic invalidation of previous codes.

**Independent Test**: Request resend → new code sent → old code rejected → new code works.

### Implementation for User Story 2

- [x] T015 [US2] Add `POST /auth/resend-verification` endpoint to `src/auth/auth.controller.ts` — protected by `JwtAuthGuard`, extract `userId` from request, call `authService.sendVerificationCode(userId)` (reuses same method as send-verification), return `{ data: null, message: "Verification code resent to your email" }`

**Checkpoint**: User Story 2 functional — resend works with rate limiting and code invalidation (logic already in sendVerificationCode from Phase 2)

---

## Phase 6: User Story 3 — Returning Unverified User Logs In (Priority: P2)

**Goal**: Login response includes email verification status so the frontend can redirect unverified users to the verification screen.

**Independent Test**: Register without verifying → log out → log in → response shows `emailVerified: false, requiresVerification: true`.

### Implementation for User Story 3

- [x] T016 [US3] Modify `login()` method in `src/auth/auth.service.ts` — ensure the user object returned includes `emailVerified` and `requiresVerification` fields via the updated `sanitizeUser` method (T008). Verify the `select` or `include` in the Prisma query fetches `emailVerified`.

**Checkpoint**: User Story 3 functional — login response reflects verification status

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [x] T017 [P] Update existing auth unit tests in `src/auth/auth.service.spec.ts` to account for `emailVerified` and `requiresVerification` fields in register and login responses, and mock the `sendVerificationCode` call in register
- [x] T018 [P] Add unit tests for `sendVerificationCode`, `verifyEmail` methods in `src/auth/auth.service.spec.ts` — cover: successful send, already verified (400), rate limit exceeded (429), successful verify, incorrect code, expired code, max attempts reached, code not found
- [x] T019 [P] Add unit tests for `EmailVerifiedGuard` in `src/common/guards/email-verified.guard.spec.ts` — cover: verified user passes, unverified user blocked (403), SkipEmailVerification decorator bypasses
- [x] T020 Verify full flow end-to-end per `specs/007-email-verification/quickstart.md` — register → send → verify → onboarding access

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema must exist for Prisma queries)
- **US1 (Phase 3)**: Depends on Phase 2 (needs sendVerificationCode, verifyEmail, sanitizeUser)
- **US4 (Phase 4)**: Depends on Phase 2 only (guard queries User.emailVerified directly)
- **US2 (Phase 5)**: Depends on Phase 2 (reuses sendVerificationCode)
- **US3 (Phase 6)**: Depends on Phase 2 (needs sanitizeUser update)
- **Polish (Phase 7)**: Depends on all user story phases

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational only — no cross-story dependencies
- **US4 (P1)**: Depends on Foundational only — no cross-story dependencies. Can run in parallel with US1.
- **US2 (P2)**: Depends on Foundational only — reuses existing `sendVerificationCode`. Can run in parallel with US1/US4.
- **US3 (P2)**: Depends on Foundational only — uses updated `sanitizeUser`. Can run in parallel with all other stories.

### Within Each User Story

- Service methods before controller endpoints
- Core logic before integration points

### Parallel Opportunities

- T005 and T006 can run in parallel (different files: mail.service.ts vs auth.service.ts)
- T012 and T013 can run in parallel (different files: decorator vs guard)
- T017, T018, T019 can all run in parallel (different test files)
- After Phase 2 completes, US1, US4, US2, and US3 can ALL start in parallel

---

## Parallel Example: Phase 2 (Foundational)

```
# These can run in parallel (different files):
Task T005: "Add sendVerificationEmail to src/mail/mail.service.ts"
Task T006: "Add sendVerificationCode to src/auth/auth.service.ts"

# T007 depends on T006 (same file), so runs after T006
# T008 depends on T007 (same file), so runs after T007
```

## Parallel Example: After Phase 2

```
# All user stories can start simultaneously:
US1 (T009-T011): Register + send + verify endpoints
US4 (T012-T014): Guard + decorator + apply to onboarding
US2 (T015): Resend endpoint
US3 (T016): Login modification
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 4)

1. Complete Phase 1: Setup (schema + migration)
2. Complete Phase 2: Foundational (DTO, mail, service methods)
3. Complete Phase 3: US1 — Register sends OTP, user can verify
4. Complete Phase 4: US4 — Unverified users blocked
5. **STOP and VALIDATE**: Full verification flow works end-to-end
6. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Schema and core logic ready
2. Add US1 → Register + verify flow works (MVP core)
3. Add US4 → Access control enforced (MVP complete)
4. Add US2 → Resend capability (better UX)
5. Add US3 → Login shows verification status (frontend support)
6. Polish → Tests + cleanup

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- T006 has the most complex logic (rate limiting, invalidation, OTP generation) — review carefully
- T007 has the transactional integrity requirement — uses `prisma.$transaction`
- The `sendVerificationCode` method is shared between send-verification (T010) and resend-verification (T015)
- Mail service is currently a stub (console.log) — T005 should match this pattern for now
- Commit after each phase checkpoint
