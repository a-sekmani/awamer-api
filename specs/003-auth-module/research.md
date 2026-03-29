# Research: Complete Auth Module

**Feature**: 003-auth-module
**Date**: 2026-03-29

## Research Tasks

### 1. Password Hashing: bcrypt Configuration

**Decision**: Use `bcrypt` with 12 salt rounds via the `bcryptjs` package (pure JS, no native compilation issues).
**Rationale**: The spec requires "one-way hash with a cost factor of 12 rounds." `bcryptjs` is a drop-in replacement for `bcrypt` that avoids native compilation problems across platforms. 12 rounds provides a good balance between security (~250ms per hash) and user experience.
**Alternatives considered**:
- Native `bcrypt` — requires node-gyp and platform-specific compilation; fragile in CI/Docker.
- `argon2` — stronger but not specified in the requirements and adds a native dependency.
- `scrypt` — built into Node.js but lacks the explicit round-count control the spec asks for.

### 2. JWT Cookie Configuration

**Decision**: Set two httpOnly cookies: `access_token` (15min, httpOnly, secure, sameSite: Lax) and `refresh_token` (7 days, httpOnly, secure, sameSite: Lax, path: `/api/v1/auth`).
**Rationale**: httpOnly prevents XSS-based token theft. sameSite: Lax allows top-level navigations while preventing CSRF for POST requests. The refresh token cookie is scoped to `/api/v1/auth` so it's only sent to auth endpoints. In development, `secure` should be false for localhost.
**Alternatives considered**:
- `sameSite: Strict` — breaks cross-origin redirects from email links (password reset).
- `sameSite: None` — too permissive; requires `secure` and allows third-party contexts.
- Authorization header with Bearer token — spec requires httpOnly cookies; headers expose tokens to JS.

### 3. Refresh Token Storage Strategy

**Decision**: Store the refresh token as a hashed value in the existing `User.refreshToken` field. On each refresh, compare the presented token against the stored hash, then rotate (generate new, hash, store).
**Rationale**: The User model already has a `refreshToken` nullable String field. Storing the hash (not plaintext) means a database breach doesn't expose active refresh tokens. Single-token-per-user aligns with the spec's rotation requirement (old token is immediately invalidated).
**Alternatives considered**:
- Separate RefreshToken table — enables multi-device sessions but is out of scope for this feature.
- Plaintext storage — database breach would expose all active sessions.
- JWT-based refresh without DB storage — no way to invalidate on logout or detect reuse.

### 4. Password Reset Token Strategy

**Decision**: Add two fields to User model: `passwordResetToken` (String, nullable, stores hashed token) and `passwordResetExpires` (DateTime, nullable). Generate a random 32-byte hex token, hash it with SHA-256 before storing. Send the unhashed token in the email link. On reset, hash the incoming token and compare.
**Rationale**: Hashing the reset token in the DB means a breach doesn't expose active reset links. SHA-256 is sufficient for this use case (the token is random, not a password). 1-hour expiry matches the spec. Token is cleared after successful use.
**Alternatives considered**:
- JWT-based reset token — self-contained but cannot be invalidated without a blacklist.
- Storing plaintext — database breach exposes active reset tokens.
- Separate PasswordReset table — unnecessary complexity for a single-use token per user.

### 5. Schema Migration for Reset Fields

**Decision**: Add `passwordResetToken String?` and `passwordResetExpires DateTime?` to the User model in `prisma/schema.prisma`. Run `prisma migrate dev --name add-password-reset-fields`.
**Rationale**: The existing User model has no fields for password reset. These two nullable fields are the minimal addition needed. No separate table required since only one active reset token per user is needed.
**Alternatives considered**:
- Encoding reset token in the existing `refreshToken` field — conflates two different concerns.
- A separate table — adds join complexity for a simple per-user field.

### 6. Rate Limiting Strategy

**Decision**: Use `@nestjs/throttler` (already installed) with `@Throttle()` decorator on auth endpoints. Default: 5 requests per 60 seconds for login/forgot-password/reset-password. Higher limit for register (10/60s) and refresh (20/60s).
**Rationale**: Auth endpoints are prime targets for brute-force attacks. The throttler is already configured globally in the project. Per-endpoint overrides via `@Throttle()` allow different limits based on abuse risk.
**Alternatives considered**:
- IP-based rate limiting at reverse proxy level — complementary but not application-layer.
- No rate limiting — violates FR-018 and is a security risk.

### 7. Email Service Integration

**Decision**: Add a `sendPasswordResetEmail(email: string, token: string, name: string)` method to the existing MailService. For now, implement as a stub that logs the email content (since AWS SES configuration is a separate concern). The method should be async and not throw if sending fails (forgot-password always returns 200).
**Rationale**: The MailService already exists but is empty. The auth module needs to send exactly one type of email (password reset). Stubbing allows the auth flow to work end-to-end while SES integration is handled separately.
**Alternatives considered**:
- Inline email sending in AuthService — violates module isolation.
- Queue-based email — adds complexity; synchronous is fine for password reset.

### 8. Public vs Protected Endpoints

**Decision**: Mark register, login, forgot-password, and reset-password as `@Public()`. Logout requires `JwtAuthGuard` (user must be authenticated). Refresh reads the refresh token from cookies (no JWT required — the access token may be expired).
**Rationale**: Public endpoints are accessible without authentication. Logout needs to know which user to log out. Refresh is a special case — it uses the refresh cookie, not the access token, so it should be `@Public()` and validate the refresh token manually in the service.
**Alternatives considered**:
- Requiring JWT for refresh — defeats the purpose (the access token is expired).
- Making logout public — no way to identify the user without authentication.
