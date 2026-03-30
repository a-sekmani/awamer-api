# Tasks: Complete Users Module

**Input**: Design documents from `/specs/005-users-module/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/users-api.md, quickstart.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story. User stories 1-4 (P1) form the core. User stories 5-6 (P2) add password change and onboarding status.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new dependencies needed. Add analytics capture stub.

- [x] T001 Add a `capture(userId: string, event: string, properties?: Record<string, any>): void` method to `src/analytics/analytics.service.ts`. Implement as a stub that logs the event at INFO level using NestJS Logger: `this.logger.log(\`[${event}] userId=${userId}\`)`. Add `private readonly logger = new Logger(AnalyticsService.name)` to the class. Import Logger from `@nestjs/common`. Reference `specs/005-users-module/research.md` Decision #5.

**Checkpoint**: AnalyticsService has a `capture()` stub method.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create all DTOs that the service and controller depend on.

- [x] T002 [P] Create `src/users/dto/update-user.dto.ts` with UpdateUserDto class: `name` (IsString, IsOptional, MaxLength 100), `country` (IsString, IsOptional, MaxLength 100), `locale` (IsString, IsOptional, IsIn(['ar', 'en'])). All fields optional. Use class-validator decorators with `!` definite assignment. Reference `specs/005-users-module/data-model.md` DTOs section.
- [x] T003 [P] Create `src/users/dto/update-profile.dto.ts` with UpdateProfileDto class: `displayName` (IsString, IsOptional, MaxLength 100), `avatarUrl` (IsString, IsOptional, MaxLength 500), `background` (IsString, IsOptional, MaxLength 1000), `goals` (IsString, IsOptional, MaxLength 1000), `interests` (IsString, IsOptional, MaxLength 1000), `preferredLanguage` (IsString, IsOptional, IsIn(['ar', 'en'])). Use class-validator decorators with `!` definite assignment. Reference `specs/005-users-module/data-model.md` DTOs section.
- [x] T004 [P] Create `src/users/dto/change-password.dto.ts` with ChangePasswordDto class: `currentPassword` (IsString, IsNotEmpty), `newPassword` (IsString, MinLength 8, Matches regex `(?=.*[a-z])(?=.*[A-Z])(?=.*\d)` with message "Password must contain at least one uppercase letter, one lowercase letter, and one number"). Use `!` definite assignment. Reference `specs/005-users-module/data-model.md` DTOs section.
- [x] T005 [P] Create `src/users/dto/onboarding.dto.ts` with two classes: (1) `OnboardingResponseItemDto` with `questionKey` (IsString, IsNotEmpty, MaxLength 100), `answer` (IsString, IsNotEmpty, MaxLength 1000), `stepNumber` (IsInt, Min 1). (2) `SubmitOnboardingDto` with `responses` (IsArray, ArrayMinSize 1, ValidateNested each, Type(() => OnboardingResponseItemDto)), `background` (IsString, IsOptional, MaxLength 1000), `goals` (IsString, IsOptional, MaxLength 1000), `interests` (IsString, IsOptional, MaxLength 1000). Import `Type` from `class-transformer` and `ValidateNested` from `class-validator`. Use `!` definite assignment. Reference `specs/005-users-module/data-model.md` DTOs section.
- [x] T006 [P] Create `src/users/dto/index.ts` barrel export re-exporting UpdateUserDto, UpdateProfileDto, ChangePasswordDto, SubmitOnboardingDto, and OnboardingResponseItemDto.

**Checkpoint**: All 4 DTOs + barrel export created. Run `npm run build` to verify compilation.

---

## Phase 3: User Story 1 — View My Complete Profile (Priority: P1) MVP

**Goal**: Implement GET /me returning user + profile + role + subscription with plan.

**Independent Test**: GET /api/v1/users/me with valid cookie → 200 with full user data.

### Implementation for User Story 1

- [x] T007 [US1] Implement the `getMe(userId: string)` method in `src/users/users.service.ts`. Logic: (1) Query `prisma.user.findUnique` with `where: { id: userId }` and `include: { profile: true, roles: true, subscriptions: { where: { status: 'ACTIVE' }, include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 } }`. (2) Extract the first role as a string: `user.roles[0]?.role ?? 'learner'`. Convert enum to lowercase string. (3) Extract the first subscription (or null). (4) Build and return the response shape: `{ user: sanitized user fields, profile, role, subscription }`. (5) Create a private `sanitizeUser()` helper (same pattern as AuthService) that excludes passwordHash, refreshToken, passwordResetToken, passwordResetExpires. Inject PrismaService. Reference `specs/005-users-module/contracts/users-api.md` GET /me and `specs/005-users-module/data-model.md` Get-Me Response Shape.
- [x] T008 [US1] Add the `GET /me` endpoint to `src/users/users.controller.ts`. Replace the existing placeholder. Use `@Get('me')`, `@HttpCode(HttpStatus.OK)`. Accept `@Req() req: Request` and extract `userId` from `req.user`. Call `usersService.getMe(userId)`. Return `{ data: result, message: 'Success' }`. No `@Public()` decorator — JwtAuthGuard applies by default. Reference `specs/005-users-module/contracts/users-api.md` GET /me.
- [x] T009 [US1] Update `src/users/users.module.ts`: import `AnalyticsModule` from `../analytics/analytics.module`. Ensure PrismaModule is available (it's global). Add ConfigModule if needed. Keep existing exports. Reference `specs/005-users-module/plan.md` Project Structure.

**Checkpoint**: GET /me works — returns full user profile with role and subscription.

---

## Phase 4: User Story 2 — Update My Account Details (Priority: P1)

**Goal**: Implement PATCH /me for updating name, country, locale.

**Independent Test**: PATCH /api/v1/users/me with `{"locale":"en"}` → 200 with updated user.

### Implementation for User Story 2

- [x] T010 [US2] Implement the `updateUser(userId: string, dto: UpdateUserDto)` method in `src/users/users.service.ts`. Logic: (1) Update user with `prisma.user.update({ where: { id: userId }, data: dto })`. Prisma skips undefined fields (partial update). (2) Return `sanitizeUser(updatedUser)`. Reference `specs/005-users-module/research.md` Decision #2.
- [x] T011 [US2] Add the `PATCH /me` endpoint to `src/users/users.controller.ts`. Use `@Patch('me')`, `@HttpCode(HttpStatus.OK)`. Accept `@Body() dto: UpdateUserDto` and `@Req() req: Request`. Call `usersService.updateUser(userId, dto)`. Return `{ data: { user: result }, message: 'Success' }`. Reference `specs/005-users-module/contracts/users-api.md` PATCH /me.

**Checkpoint**: PATCH /me works — partial updates to name, country, locale.

---

## Phase 5: User Story 3 — Update My Profile Preferences (Priority: P1)

**Goal**: Implement PATCH /me/profile for updating profile fields.

**Independent Test**: PATCH /api/v1/users/me/profile with `{"goals":"Learn AI"}` → 200 with updated profile.

### Implementation for User Story 3

- [x] T012 [US3] Implement the `updateProfile(userId: string, dto: UpdateProfileDto)` method in `src/users/users.service.ts`. Logic: (1) Update profile with `prisma.userProfile.update({ where: { userId }, data: dto })`. Prisma skips undefined fields. (2) Return the updated profile. Reference `specs/005-users-module/research.md` Decision #2.
- [x] T013 [US3] Add the `PATCH /me/profile` endpoint to `src/users/users.controller.ts`. Use `@Patch('me/profile')`, `@HttpCode(HttpStatus.OK)`. Accept `@Body() dto: UpdateProfileDto` and `@Req() req: Request`. Call `usersService.updateProfile(userId, dto)`. Return `{ data: { profile: result }, message: 'Success' }`. Reference `specs/005-users-module/contracts/users-api.md` PATCH /me/profile.

**Checkpoint**: PATCH /me/profile works — partial profile updates.

---

## Phase 6: User Story 4 — Complete Onboarding (Priority: P1)

**Goal**: Implement POST /me/onboarding to store responses, update profile, and fire analytics event.

**Independent Test**: POST /api/v1/users/me/onboarding with responses → 200, profile updated with onboardingCompleted=true.

### Implementation for User Story 4

- [x] T014 [US4] Implement the `submitOnboarding(userId: string, dto: SubmitOnboardingDto)` method in `src/users/users.service.ts`. Logic: (1) In a `prisma.$transaction`: (a) Create OnboardingResponse records using `tx.onboardingResponse.createMany({ data: dto.responses.map(r => ({ userId, questionKey: r.questionKey, answer: r.answer, stepNumber: r.stepNumber })) })`. (b) Update UserProfile: `tx.userProfile.update({ where: { userId }, data: { background: dto.background ?? undefined, goals: dto.goals ?? undefined, interests: dto.interests ?? undefined, onboardingCompleted: true } })`. (2) After the transaction, call `this.analyticsService.capture(userId, 'onboarding_completed')`. (3) Return the updated profile. Inject AnalyticsService from `../analytics/analytics.service`. Reference `specs/005-users-module/research.md` Decision #4 and `specs/005-users-module/contracts/users-api.md` POST /me/onboarding.
- [x] T015 [US4] Add the `POST /me/onboarding` endpoint to `src/users/users.controller.ts`. Use `@Post('me/onboarding')`, `@HttpCode(HttpStatus.OK)`. Accept `@Body() dto: SubmitOnboardingDto` and `@Req() req: Request`. Call `usersService.submitOnboarding(userId, dto)`. Return `{ data: { profile: result }, message: 'Success' }`. Reference `specs/005-users-module/contracts/users-api.md` POST /me/onboarding.

**Checkpoint**: POST /me/onboarding works — creates responses, updates profile, fires event.

---

## Phase 7: User Story 5 — Change My Password (Priority: P2)

**Goal**: Implement PATCH /me/password with current password verification and refresh token invalidation.

**Independent Test**: PATCH /api/v1/users/me/password with correct current password → 200 "Password updated".

### Implementation for User Story 5

- [x] T016 [US5] Implement the `changePassword(userId: string, dto: ChangePasswordDto)` method in `src/users/users.service.ts`. Logic: (1) Find user by id. (2) Compare `dto.currentPassword` with `user.passwordHash` using `bcrypt.compare`. If no match, throw `BadRequestException('Current password is incorrect')`. (3) Hash `dto.newPassword` with bcrypt (12 rounds). (4) Update user: set `passwordHash` to new hash, set `refreshToken` to null (invalidate sessions). Import `* as bcrypt from 'bcryptjs'`. Reference `specs/005-users-module/research.md` Decision #6 and `specs/005-users-module/contracts/users-api.md` PATCH /me/password.
- [x] T017 [US5] Add the `PATCH /me/password` endpoint to `src/users/users.controller.ts`. Use `@Patch('me/password')`, `@HttpCode(HttpStatus.OK)`. Accept `@Body() dto: ChangePasswordDto` and `@Req() req: Request`. Call `usersService.changePassword(userId, dto)`. Return `{ data: null, message: 'Password updated' }`. Reference `specs/005-users-module/contracts/users-api.md` PATCH /me/password.

**Checkpoint**: PATCH /me/password works — verifies current, updates hash, invalidates refresh.

---

## Phase 8: User Story 6 — View Onboarding Status (Priority: P2)

**Goal**: Implement GET /me/onboarding returning completion flag and stored responses.

**Independent Test**: GET /api/v1/users/me/onboarding → 200 with completed boolean and responses array.

### Implementation for User Story 6

- [x] T018 [US6] Implement the `getOnboardingStatus(userId: string)` method in `src/users/users.service.ts`. Logic: (1) Find the user's profile to get `onboardingCompleted`. (2) Find all onboarding responses: `prisma.onboardingResponse.findMany({ where: { userId }, orderBy: { stepNumber: 'asc' } })`. (3) Return `{ completed: profile.onboardingCompleted, responses }`. Reference `specs/005-users-module/contracts/users-api.md` GET /me/onboarding.
- [x] T019 [US6] Add the `GET /me/onboarding` endpoint to `src/users/users.controller.ts`. Use `@Get('me/onboarding')`, `@HttpCode(HttpStatus.OK)`. Accept `@Req() req: Request`. Call `usersService.getOnboardingStatus(userId)`. Return `{ data: result, message: 'Success' }`. Reference `specs/005-users-module/contracts/users-api.md` GET /me/onboarding.

**Checkpoint**: GET /me/onboarding works — returns completion status and responses.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Rate limiting, module wiring verification, build validation.

- [x] T020 Add `@Throttle()` rate limiting decorators to endpoints in `src/users/users.controller.ts`: GET /me (20/60s), PATCH /me (10/60s), PATCH /me/profile (10/60s), PATCH /me/password (5/60s), POST /me/onboarding (5/60s), GET /me/onboarding (20/60s). Import `@Throttle` from `@nestjs/throttler`. Reference spec FR-016.
- [x] T021 Verify `src/users/users.module.ts` final state: imports (AnalyticsModule, ConfigModule if needed), controllers (UsersController), providers (UsersService), exports (UsersService). Ensure no unused imports.
- [x] T022 Run `npm run build` to verify TypeScript compilation. Fix any type errors in `src/users/`. Run `npm run lint` and fix any linting issues.
- [x] T023 Run quickstart.md validation: start the dev server, test all 6 endpoints using the curl commands from `specs/005-users-module/quickstart.md`. Verify get-me returns complete data, updates are partial, password change verifies current password, onboarding stores responses and fires event.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — add analytics stub first
- **Foundational (Phase 2)**: Depends on Phase 1 (DTOs don't depend on analytics, but setup is minimal)
- **US1 Get Me (Phase 3)**: Depends on Phase 2 (needs module update) — MVP
- **US2 Update User (Phase 4)**: Depends on Phase 2 (needs UpdateUserDto)
- **US3 Update Profile (Phase 5)**: Depends on Phase 2 (needs UpdateProfileDto)
- **US4 Onboarding (Phase 6)**: Depends on Phase 1 (needs AnalyticsService.capture) and Phase 2 (needs SubmitOnboardingDto)
- **US5 Change Password (Phase 7)**: Depends on Phase 2 (needs ChangePasswordDto)
- **US6 Onboarding Status (Phase 8)**: Independent of other stories
- **Polish (Phase 9)**: Depends on all previous phases

### User Story Dependencies

- **US1 (Get Me)**: Entry point — no story dependencies
- **US2 (Update User)**: Independent
- **US3 (Update Profile)**: Independent
- **US4 (Onboarding)**: Depends on US1 for module setup (AnalyticsModule import)
- **US5 (Change Password)**: Independent
- **US6 (Onboarding Status)**: Independent

### Within Each Phase

All story phases have 2 sequential tasks (service method → controller endpoint) targeting the same files.

---

## Parallel Opportunities

### Phase 2 (DTOs)
```
Task: "Create UpdateUserDto" [P]
Task: "Create UpdateProfileDto" [P]
Task: "Create ChangePasswordDto" [P]
Task: "Create OnboardingDto" [P]
Task: "Create barrel export" [P]
```

### Phases 4-8 (US2-US6)
US2, US3, US5, US6 are independent of each other. If the service file supported concurrent edits, they could be parallelized. In practice, they are sequential since all target `users.service.ts` and `users.controller.ts`.

---

## Implementation Strategy

### MVP First (User Story 1 — Get Me)

1. Phase 1: Analytics stub (T001)
2. Phase 2: DTOs (T002-T006)
3. Phase 3: GET /me (T007-T009)
4. **STOP and VALIDATE**: Frontend can display user dashboard

### Full Delivery

1. MVP above
2. Phase 4: Update user (T010-T011)
3. Phase 5: Update profile (T012-T013)
4. Phase 6: Onboarding (T014-T015)
5. Phase 7: Change password (T016-T017)
6. Phase 8: Onboarding status (T018-T019)
7. Phase 9: Polish (T020-T023)

---

## Notes

- All service methods in `src/users/users.service.ts` — single service file
- All endpoints in `src/users/users.controller.ts` — single controller file
- DTOs in separate files under `src/users/dto/` — can be created in parallel
- The `sanitizeUser()` helper in UsersService follows the same pattern as AuthService
- AnalyticsService.capture() is a stub — real PostHog integration is a future feature
- GET /me/onboarding must be declared BEFORE GET /me in the controller to avoid route conflict (NestJS matches routes top-down; `/me/onboarding` would match `me/:param` if `me` were parameterized — but since we use literal `me`, order within `me/*` paths matters for sub-routes)
