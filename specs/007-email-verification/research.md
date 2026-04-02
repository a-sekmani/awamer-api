# Research: Email Verification (007)

**Date**: 2026-04-01 | **Branch**: `007-email-verification`

## R-001: OTP Generation Strategy

**Decision**: Use `crypto.randomInt(100000, 999999)` from Node.js built-in `crypto` module.

**Rationale**: `crypto.randomInt` uses a CSPRNG (cryptographically secure pseudorandom number generator), ensuring codes are unpredictable. The range `100000–999999` guarantees exactly 6 digits (no leading zeros issue since minimum is 100000). This is the approach specified in requirements.

**Alternatives considered**:
- `Math.random()` — Not cryptographically secure; rejected for security reasons.
- `crypto.randomBytes` + modular arithmetic — More complex with no benefit over `randomInt`.
- UUID-based codes — Longer than 6 digits, poor UX for manual entry.

## R-002: OTP Storage — Plain Text vs Hashed

**Decision**: Store OTP codes as plain text strings in the database.

**Rationale**: OTP codes are 6-digit numbers with a 10-minute expiry and a 5-attempt limit. The brute-force window is extremely small (900,000 possible values, 5 attempts, 10 minutes). Hashing adds computational overhead on every verification attempt with negligible security gain. If the database is compromised, an attacker has at most 10 minutes to use a code — and they'd also need the user's JWT.

**Alternatives considered**:
- bcrypt hashing — Adds ~100ms per verify attempt; unnecessary given short expiry + attempt limits.
- SHA-256 hashing — Lower overhead but still unnecessary complexity for the threat model.

## R-003: Rate Limiting Strategy for Code Sends

**Decision**: Application-level rate limiting by counting `EmailVerification` records created in the last 15 minutes per user.

**Rationale**: The existing `@nestjs/throttler` global rate limit (100 req/60s) is too broad for this use case. The spec requires per-user rate limiting (3 sends per 15 minutes), which is a business rule best enforced at the service layer by querying the `EmailVerification` table. This avoids coupling to the throttler's IP-based or global counting.

**Alternatives considered**:
- `@Throttle()` decorator per endpoint — IP-based, not user-based; doesn't meet the per-user requirement.
- Redis-based rate limiting — Adds infrastructure dependency; overkill for low-volume per-user limits.
- Custom NestJS guard with throttler — Over-engineered; a simple count query is sufficient.

## R-004: Code Invalidation Strategy

**Decision**: When a new code is generated, update all previous codes for the user to `used = true` in the same transaction.

**Rationale**: Setting `used = true` on old codes ensures they can't be verified even if unexpired. This is simpler than deleting records (preserves audit trail) and safer than relying solely on expiry timestamps. The transaction ensures atomicity between invalidation and new code creation.

**Alternatives considered**:
- Delete old codes — Loses audit trail; harder to debug or detect abuse patterns.
- Rely only on "latest unused" query — Risk of race conditions if two codes are created nearly simultaneously.

## R-005: EmailVerifiedGuard Implementation Pattern

**Decision**: Implement as a NestJS `CanActivate` guard in `src/common/guards/` with a `@SkipEmailVerification()` decorator for exempt routes.

**Rationale**: Follows the existing guard patterns (RolesGuard, EnrollmentGuard, ContentAccessGuard are all in `src/common/guards/`). The decorator pattern mirrors `@Public()` for JwtAuthGuard. The guard reads `emailVerified` from the database via Prisma to ensure real-time accuracy (not relying on JWT claims, which could be stale for up to 15 minutes).

**Alternatives considered**:
- Include `emailVerified` in JWT payload — Stale for up to 15 minutes after verification; user would need to re-login.
- Middleware instead of guard — Guards are the NestJS convention for access control; middleware lacks Reflector access for decorators.
- Global guard with route exclusions — The decorator approach is more explicit and maintainable than a blocklist.

## R-006: Bilingual Email Template

**Decision**: Single email with both Arabic (top, RTL) and English (bottom, LTR) content sections, including the 6-digit code prominently displayed.

**Rationale**: The platform's primary market is Saudi Arabia with Arabic as default locale (`locale: "ar"`). A bilingual email ensures all users can understand the code regardless of language preference. Sending two separate emails would be confusing and wasteful.

**Alternatives considered**:
- Locale-based single language — Risks alienating users who set locale incorrectly or prefer reading in their non-primary language.
- Separate Arabic and English emails — Double the email volume; confusing inbox experience.

## R-007: Guard Application Scope

**Decision**: Apply `EmailVerifiedGuard` selectively using `@UseGuards()` on specific controllers/routes rather than globally.

**Rationale**: The guard must NOT apply to auth endpoints, verification endpoints, or `GET /users/me`. Applying it globally would require extensive `@SkipEmailVerification()` decorators on most auth routes. Instead, apply it only where needed: `POST /users/me/onboarding` and future learning/enrollment endpoints (which are currently stubs). This is more explicit and less error-prone.

**Alternatives considered**:
- Global guard with decorator exemptions — More decorators to maintain; higher risk of accidentally blocking auth routes.
- Controller-level application — Some controllers have mixed exempt/protected routes (users controller has both GET /me and POST /me/onboarding).
