# Tasks: Complete Auth Module

**Input**: Design documents from `/specs/003-auth-module/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/auth-api.md, quickstart.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story. User stories 1-3 (P1) form the core MVP. User stories 4-6 (P2) add logout and password recovery.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and run schema migration for password reset fields

- [x] T001 Install `bcryptjs` and `@types/bcryptjs` by running `npm install bcryptjs` and `npm install -D @types/bcryptjs` at the project root.
- [x] T002 Add `passwordResetToken String?` and `passwordResetExpires DateTime?` fields to the User model in `prisma/schema.prisma` (after the `refreshToken` field). Then run `npx prisma migrate dev --name add-password-reset-fields` and `npx prisma generate`. Reference `specs/003-auth-module/data-model.md` for field details.

**Checkpoint**: Dependencies installed, schema migrated, Prisma client regenerated.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create DTOs and shared auth utilities that all user stories depend on

- [x] T003 [P] Create `src/auth/dto/register.dto.ts` with RegisterDto class: `name` (IsString, IsNotEmpty, MaxLength 100), `email` (IsEmail, MaxLength 255), `password` (IsString, MinLength 8, Matches regex for uppercase + lowercase + number), `country` (IsString, IsOptional, MaxLength 100). Use class-validator decorators. Add a custom validation message for the password regex explaining requirements. Reference `specs/003-auth-module/data-model.md` DTOs section.
- [x] T004 [P] Create `src/auth/dto/login.dto.ts` with LoginDto class: `email` (IsEmail), `password` (IsString, IsNotEmpty). Use class-validator decorators. Reference `specs/003-auth-module/data-model.md` DTOs section.
- [x] T005 [P] Create `src/auth/dto/forgot-password.dto.ts` with ForgotPasswordDto class: `email` (IsEmail). Use class-validator decorators. Reference `specs/003-auth-module/data-model.md` DTOs section.
- [x] T006 [P] Create `src/auth/dto/reset-password.dto.ts` with ResetPasswordDto class: `token` (IsString, IsNotEmpty), `password` (IsString, MinLength 8, Matches regex for uppercase + lowercase + number — same regex as RegisterDto). Use class-validator decorators. Reference `specs/003-auth-module/data-model.md` DTOs section.
- [x] T007 [P] Create `src/auth/dto/index.ts` barrel export file re-exporting all 4 DTOs from their respective files.
- [x] T008 Add `sendPasswordResetEmail(email: string, token: string, name: string): Promise<void>` method to `src/mail/mail.service.ts`. For now, implement as a stub that logs the reset link (`${FRONTEND_URL}/reset-password?token=${token}`) at INFO level using NestJS Logger. Inject ConfigService to read `FRONTEND_URL`. The method must NOT throw — catch any errors and log them. Reference `specs/003-auth-module/research.md` Decision #7.

**Checkpoint**: All 4 DTOs created, MailService has password reset stub. Auth service implementation can begin.

---

## Phase 3: User Story 1 — New User Registration (Priority: P1) MVP

**Goal**: Allow new users to register with name, email, password, country. Create User + UserProfile + UserRole + Subscription atomically. Return user data and set httpOnly cookies.

**Independent Test**: POST to /api/v1/auth/register with valid data → 201 with user data and cookies set.

### Implementation for User Story 1

- [x] T009 [US1] Implement the `register(dto: RegisterDto, res: Response)` method in `src/auth/auth.service.ts`. Logic: (1) Normalize email (trim + lowercase). (2) Check email uniqueness — if exists, throw ConflictException with "Email already registered". (3) Hash password with bcryptjs (12 rounds). (4) Generate refresh token (crypto.randomBytes 32 hex). (5) Hash refresh token with bcryptjs. (6) In a single `prisma.$transaction`: create User (with hashed password, hashed refresh token, status ACTIVE, locale "ar"), create UserProfile (linked to user, onboardingCompleted false), create UserRole (role LEARNER), find default SubscriptionPlan (where isDefault true), create Subscription (ACTIVE, linked to user + plan). (7) Sign JWT access token (payload: { sub: user.id, email: user.email }, expiresIn: 900). (8) Return { user (safe fields only — no passwordHash/refreshToken), accessToken, refreshToken (unhashed) }. Import PrismaService, JwtService, ConfigService. Reference `specs/003-auth-module/data-model.md` Transaction Scope and `specs/003-auth-module/contracts/auth-api.md` POST /register.
- [x] T010 [US1] Add the `POST /register` endpoint to `src/auth/auth.controller.ts`. Decorate with `@Public()`, `@Post('register')`, `@HttpCode(HttpStatus.CREATED)`. Accept `@Body() dto: RegisterDto` and `@Res({ passthrough: true }) res: Response`. Call `authService.register(dto, res)`. Set cookies on the response: `access_token` (httpOnly, secure based on NODE_ENV, sameSite Lax, maxAge 15min, path /) and `refresh_token` (httpOnly, secure, sameSite Lax, maxAge 7 days, path /api/v1/auth). Return `{ data: { user }, message: "Registration successful" }`. Reference `specs/003-auth-module/contracts/auth-api.md` POST /register and cookie config table.
- [x] T011 [US1] Update `src/auth/auth.module.ts`: import `MailModule`, add `PrismaModule` if not already global, ensure `ConfigModule` is available. Add a `JwtModule.registerAsync` for the refresh token secret (or use ConfigService directly in AuthService for signing refresh tokens). Verify providers include AuthService and exports include JwtAuthGuard. Reference `specs/003-auth-module/plan.md` Project Structure.

**Checkpoint**: Register endpoint works — creates user + profile + role + subscription atomically, sets cookies, returns safe user data.

---

## Phase 4: User Story 2 — Returning User Login (Priority: P1)

**Goal**: Allow registered users to log in with email/password. Issue access + refresh tokens via cookies. Update lastLoginAt.

**Independent Test**: POST to /api/v1/auth/login with valid credentials → 200 with user data and cookies set.

### Implementation for User Story 2

- [x] T012 [US2] Implement the `login(dto: LoginDto, res: Response)` method in `src/auth/auth.service.ts`. Logic: (1) Normalize email. (2) Find user by email — if not found, throw UnauthorizedException "Invalid credentials". (3) Check user.status — if not ACTIVE, throw ForbiddenException "Account is inactive or suspended". (4) Compare password with bcryptjs — if no match, throw UnauthorizedException "Invalid credentials" (same message as step 2 — no enumeration). (5) Generate new refresh token, hash it, store in DB. (6) Update lastLoginAt to now(). (7) Sign JWT access token. (8) Return { user (safe fields), accessToken, refreshToken }. Reference `specs/003-auth-module/contracts/auth-api.md` POST /login.
- [x] T013 [US2] Add the `POST /login` endpoint to `src/auth/auth.controller.ts`. Decorate with `@Public()`, `@Post('login')`, `@HttpCode(HttpStatus.OK)`. Accept `@Body() dto: LoginDto` and `@Res({ passthrough: true }) res: Response`. Call `authService.login(dto, res)`. Set the same cookie configuration as register. Return `{ data: { user }, message: "Login successful" }`. Reference `specs/003-auth-module/contracts/auth-api.md` POST /login.

**Checkpoint**: Login works — validates credentials, denies inactive accounts, sets cookies, updates lastLoginAt.

---

## Phase 5: User Story 3 — Session Refresh (Priority: P1)

**Goal**: Allow users to refresh their expired access token using the refresh token cookie. Rotate the refresh token.

**Independent Test**: POST to /api/v1/auth/refresh with valid refresh_token cookie → 200 with new cookies. Old refresh token no longer works.

### Implementation for User Story 3

- [x] T014 [US3] Implement the `refresh(req: Request, res: Response)` method in `src/auth/auth.service.ts`. Logic: (1) Extract refresh_token from req.cookies — if missing, throw UnauthorizedException. (2) Decode the refresh token to get userId (either by signing it as a JWT with JWT_REFRESH_SECRET, or by iterating — preferred: sign refresh as JWT with { sub: userId } and JWT_REFRESH_SECRET, expiresIn 7d, then verify here). (3) Find user by userId — if not found, throw UnauthorizedException. (4) Check user.status — if not ACTIVE, throw ForbiddenException. (5) Compare the refresh token with the stored hashed refreshToken using bcryptjs — if no match, throw UnauthorizedException (force re-login). (6) Generate new refresh token, hash it, update user.refreshToken in DB. (7) Sign new JWT access token. (8) Return { user (safe fields), accessToken, refreshToken }. Reference `specs/003-auth-module/contracts/auth-api.md` POST /refresh and `specs/003-auth-module/research.md` Decision #3.
- [x] T015 [US3] Add the `POST /refresh` endpoint to `src/auth/auth.controller.ts`. Decorate with `@Public()`, `@Post('refresh')`, `@HttpCode(HttpStatus.OK)`. Accept `@Req() req: Request` and `@Res({ passthrough: true }) res: Response`. Call `authService.refresh(req, res)`. Set new cookies (same config as register/login). Return `{ data: { user }, message: "Token refreshed" }`. Reference `specs/003-auth-module/contracts/auth-api.md` POST /refresh.

**Checkpoint**: Refresh works — validates refresh token, rotates it, issues new pair. MVP complete (register + login + refresh).

---

## Phase 6: User Story 4 — User Logout (Priority: P2)

**Goal**: Allow authenticated users to end their session by clearing cookies and removing the refresh token from DB.

**Independent Test**: POST to /api/v1/auth/logout with valid access_token cookie → 200, cookies cleared, refresh token no longer works.

### Implementation for User Story 4

- [x] T016 [US4] Implement the `logout(userId: string, res: Response)` method in `src/auth/auth.service.ts`. Logic: (1) Update user record: set refreshToken to null. (2) Clear cookies on response. Reference `specs/003-auth-module/contracts/auth-api.md` POST /logout.
- [x] T017 [US4] Add the `POST /logout` endpoint to `src/auth/auth.controller.ts`. This endpoint is NOT @Public() — it requires JwtAuthGuard (user must be authenticated). Decorate with `@Post('logout')`, `@HttpCode(HttpStatus.OK)`. Accept `@Req() req: Request` (extract userId from req.user) and `@Res({ passthrough: true }) res: Response`. Call `authService.logout(userId, res)`. Clear `access_token` cookie (path /) and `refresh_token` cookie (path /api/v1/auth) by setting maxAge 0. Return `{ data: null, message: "Logout successful" }`. Reference `specs/003-auth-module/contracts/auth-api.md` POST /logout.

**Checkpoint**: Logout works — clears cookies, removes refresh token from DB.

---

## Phase 7: User Story 5 — Forgot Password (Priority: P2)

**Goal**: Allow users to request a password reset email. Always return 200 to prevent email enumeration.

**Independent Test**: POST to /api/v1/auth/forgot-password with any email → 200 with same message. If email exists, reset token is stored and email is sent (logged in dev).

### Implementation for User Story 5

- [x] T018 [US5] Implement the `forgotPassword(dto: ForgotPasswordDto)` method in `src/auth/auth.service.ts`. Logic: (1) Normalize email. (2) Find user by email — if not found, return silently (no error, no email). (3) Generate reset token: crypto.randomBytes(32).toString('hex'). (4) Hash reset token with SHA-256 (crypto.createHash('sha256').update(token).digest('hex')). (5) Update user: set passwordResetToken to hashed value, set passwordResetExpires to Date.now() + 1 hour. (6) Call mailService.sendPasswordResetEmail(user.email, token (unhashed), user.name). (7) Wrap steps 3-6 in try/catch — log any errors but never throw. Reference `specs/003-auth-module/data-model.md` State Transitions and `specs/003-auth-module/research.md` Decision #4.
- [x] T019 [US5] Add the `POST /forgot-password` endpoint to `src/auth/auth.controller.ts`. Decorate with `@Public()`, `@Post('forgot-password')`, `@HttpCode(HttpStatus.OK)`. Accept `@Body() dto: ForgotPasswordDto`. Call `authService.forgotPassword(dto)`. Return `{ data: null, message: "If an account with that email exists, a password reset link has been sent" }` — always the same response. Reference `specs/003-auth-module/contracts/auth-api.md` POST /forgot-password.

**Checkpoint**: Forgot-password works — generates and stores token, sends email (stubbed), always returns 200.

---

## Phase 8: User Story 6 — Reset Password (Priority: P2)

**Goal**: Allow users to set a new password using a valid reset token from the forgot-password email.

**Independent Test**: POST to /api/v1/auth/reset-password with valid token + strong password → 200, old password no longer works, new password works.

### Implementation for User Story 6

- [x] T020 [US6] Implement the `resetPassword(dto: ResetPasswordDto)` method in `src/auth/auth.service.ts`. Logic: (1) Hash the incoming token with SHA-256 (same algorithm as forgot-password). (2) Find user where passwordResetToken matches the hash AND passwordResetExpires > now. If not found, throw BadRequestException "Invalid or expired reset token". (3) Hash the new password with bcryptjs (12 rounds). (4) Update user: set passwordHash to new hash, set passwordResetToken to null, set passwordResetExpires to null, set refreshToken to null (invalidate existing sessions). (5) Return void. Reference `specs/003-auth-module/data-model.md` State Transitions and `specs/003-auth-module/contracts/auth-api.md` POST /reset-password.
- [x] T021 [US6] Add the `POST /reset-password` endpoint to `src/auth/auth.controller.ts`. Decorate with `@Public()`, `@Post('reset-password')`, `@HttpCode(HttpStatus.OK)`. Accept `@Body() dto: ResetPasswordDto`. Call `authService.resetPassword(dto)`. Return `{ data: null, message: "Password reset successful" }`. Reference `specs/003-auth-module/contracts/auth-api.md` POST /reset-password.

**Checkpoint**: Reset-password works — validates token, updates password hash, clears reset token and sessions.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Rate limiting, helper extraction, final cleanup

- [x] T022 Add `@Throttle()` rate limiting decorators to auth endpoints in `src/auth/auth.controller.ts`: login (5 requests / 60 seconds), forgot-password (5 / 60), reset-password (5 / 60), register (10 / 60), refresh (20 / 60). Import `@Throttle` from `@nestjs/throttler`. Reference `specs/003-auth-module/research.md` Decision #6.
- [x] T023 Extract a private helper method `setCookies(res: Response, accessToken: string, refreshToken: string)` in `src/auth/auth.controller.ts` (or `src/auth/auth.service.ts`) to DRY the cookie-setting logic used by register, login, and refresh. Cookie config: access_token (httpOnly, secure: NODE_ENV === 'production', sameSite: 'lax', maxAge: 15 * 60 * 1000, path: '/'), refresh_token (httpOnly, secure: NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/v1/auth'). Reference `specs/003-auth-module/contracts/auth-api.md` Cookie Configuration table.
- [x] T024 Extract a private helper method `sanitizeUser(user: User)` in `src/auth/auth.service.ts` that returns only safe fields: id, name, email, country, locale, status. Excludes: passwordHash, refreshToken, passwordResetToken, passwordResetExpires. Use this in register, login, and refresh return values. Reference Constitution Principle II (Security-First).
- [x] T025 Verify `src/auth/auth.module.ts` final state: imports (PrismaModule if not global, JwtModule with async config, PassportModule, MailModule, ConfigModule), providers (AuthService, JwtStrategy, JwtAuthGuard), exports (JwtAuthGuard, JwtModule). Ensure no unused imports. Reference `specs/003-auth-module/plan.md` Project Structure.
- [x] T026 Run `npx prisma validate` and `npm run build` to verify schema and TypeScript compilation. Fix any type errors in `src/auth/`. Run `npm run lint` and fix any linting issues.
- [x] T027 Run quickstart.md validation: start the dev server (`npm run start:dev`), test all 6 endpoints using the curl commands from `specs/003-auth-module/quickstart.md`. Verify register creates 4 records, login returns cookies, refresh rotates token, logout clears state, forgot-password always returns 200, reset-password updates the hash.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — install deps + migrate schema first
- **Foundational (Phase 2)**: Depends on Phase 1 (Prisma client must be regenerated for new fields)
- **US1 Registration (Phase 3)**: Depends on Phase 2 (needs DTOs, MailModule)
- **US2 Login (Phase 4)**: Depends on Phase 3 (shares cookie logic and service patterns from register)
- **US3 Refresh (Phase 5)**: Depends on Phase 4 (refresh validates tokens issued by login)
- **US4 Logout (Phase 6)**: Depends on Phase 3 (needs authenticated user from login/register)
- **US5 Forgot Password (Phase 7)**: Depends on Phase 2 (needs ForgotPasswordDto + MailService)
- **US6 Reset Password (Phase 8)**: Depends on Phase 7 (completes the forgot-password flow)
- **Polish (Phase 9)**: Depends on all previous phases

### User Story Dependencies

- **US1 (Registration)**: Entry point — no story dependencies
- **US2 (Login)**: Needs a registered user (depends on US1 for realistic testing)
- **US3 (Refresh)**: Needs tokens from login (depends on US2)
- **US4 (Logout)**: Needs an authenticated session (depends on US2)
- **US5 (Forgot Password)**: Independent of US2-US4 (only needs a User in DB from US1)
- **US6 (Reset Password)**: Depends on US5 (needs a reset token from forgot-password)

### Within Each Phase

Tasks within a phase are **sequential** unless marked [P]. Foundational DTOs are all [P] (separate files). All other phases are sequential (they build on the same service/controller files).

### Execution Order

```
Phase 1 (T001-T002)
  → Phase 2 (T003-T008) [T003-T007 are parallel]
    → Phase 3/US1 (T009-T011)
      → Phase 4/US2 (T012-T013)
        → Phase 5/US3 (T014-T015) ← MVP complete
          → Phase 6/US4 (T016-T017)
    → Phase 7/US5 (T018-T019) [can start after Phase 2]
      → Phase 8/US6 (T020-T021)
        → Phase 9 (T022-T027)
```

---

## Parallel Opportunities

### Phase 2 (Foundational DTOs)
```
Task: "Create RegisterDto in src/auth/dto/register.dto.ts" [P]
Task: "Create LoginDto in src/auth/dto/login.dto.ts" [P]
Task: "Create ForgotPasswordDto in src/auth/dto/forgot-password.dto.ts" [P]
Task: "Create ResetPasswordDto in src/auth/dto/reset-password.dto.ts" [P]
Task: "Create barrel export in src/auth/dto/index.ts" [P]
```

### Phase 7-8 (Password Recovery — independent of login/refresh/logout)
US5 + US6 can be developed in parallel with US4 (logout) since they share no implementation dependencies beyond Phase 2.

---

## Implementation Strategy

### MVP First (User Stories 1-3)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: DTOs + MailService stub (T003-T008)
3. Complete Phase 3: Register (T009-T011)
4. Complete Phase 4: Login (T012-T013)
5. Complete Phase 5: Refresh (T014-T015)
6. **STOP and VALIDATE**: Users can register, log in, and maintain sessions
7. Deploy/demo as MVP

### Full Delivery

1. MVP above → then add:
2. Phase 6: Logout (T016-T017)
3. Phase 7: Forgot Password (T018-T019)
4. Phase 8: Reset Password (T020-T021)
5. Phase 9: Polish (T022-T027)

---

## Notes

- All service methods are implemented in `src/auth/auth.service.ts` — single service file
- All endpoints are in `src/auth/auth.controller.ts` — single controller file
- DTOs are in separate files under `src/auth/dto/` — can be created in parallel
- Cookie logic is shared across register, login, and refresh — extract helper in Phase 9
- The password regex pattern `(?=.*[a-z])(?=.*[A-Z])(?=.*\d)` is used in both RegisterDto and ResetPasswordDto — keep consistent
- MailService is stubbed (logs to console) — real SES integration is a separate feature
