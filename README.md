# Awamer API

Backend REST API for the Awamer (أوامر) educational platform — an Arabic-first learning platform specializing in AI, Cybersecurity, and Cloud/DevOps, targeting the Saudi Arabia market.

Built with **NestJS 10**, **Prisma 6**, **PostgreSQL**, and **TypeScript 5**.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20 LTS | Required runtime |
| PostgreSQL | 14+ | Database server must be running |
| npm | 10+ | Comes with Node.js |

## Setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd awamer-api
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values. **Required variables** (the app will not start without these):

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:password@localhost:5432/awamer` |
| `JWT_SECRET` | Access token signing secret (random, 64+ chars) | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Refresh token signing secret (different from above) | `openssl rand -hex 32` |
| `STRIPE_SECRET_KEY` | Stripe API secret key | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `AWS_ACCESS_KEY_ID` | AWS IAM access key | — |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key | — |
| `AWS_REGION` | AWS region | `eu-west-1` |
| `S3_BUCKET_NAME` | S3 bucket for file uploads | `awamer-files` |
| `SES_FROM_EMAIL` | SES verified sender email | `noreply@awamer.com` |
| `POSTHOG_API_KEY` | PostHog project API key | `phc_...` |

**Optional variables** (have sensible defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |
| `JWT_EXPIRATION` | `900` | Access token TTL in seconds (15 min) |
| `JWT_REFRESH_EXPIRATION` | `7d` | Refresh token TTL |
| `THROTTLE_TTL` | `60000` | Rate limit window in ms |
| `THROTTLE_LIMIT` | `100` | Max requests per window per IP |

> **Tip:** Generate secure JWT secrets with `openssl rand -hex 32`.

### 3. Create the PostgreSQL database

```bash
createdb awamer
```

### 4. Run database migrations

```bash
npx prisma migrate dev
```

This applies all migrations and generates the Prisma client.

### 5. Generate Prisma client (if needed separately)

```bash
npx prisma generate
```

## Running the App

```bash
# Development (watch mode with auto-reload)
npm run start:dev

# Production build and run
npm run build
npm run start:prod

# Debug mode
npm run start:debug
```

The API runs on `http://localhost:3001` by default. All endpoints are prefixed with `/api/v1/`.

### Verify the server is running

```bash
curl http://localhost:3001/api/v1/health
# Expected: {"status":"ok"}
```

## Testing

```bash
# Run all unit tests
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Test coverage report
npm run test:cov

# Run a specific test file
npx jest src/auth/auth.service.spec.ts

# End-to-end tests
npm run test:e2e
```

**Current test count:** 245 tests across 16 suites.

### Test structure

Tests live alongside source files as `*.spec.ts`:

```
src/auth/auth.service.ts          → src/auth/auth.service.spec.ts
src/auth/auth.controller.ts       → src/auth/auth.controller.spec.ts
src/common/filters/http-exception.filter.ts → src/common/filters/http-exception.filter.spec.ts
```

## Database Management

### Apply pending migrations

```bash
npx prisma migrate dev
```

### Reset database (drop + recreate + re-migrate)

```bash
npx prisma migrate reset
```

> **Warning:** This deletes ALL data. Only use on development databases. You will be prompted to confirm.

### Apply a single migration manually (without resetting)

```bash
npx prisma db execute --schema prisma/schema.prisma --file prisma/migrations/<migration-folder>/migration.sql
```

### View database in browser (Prisma Studio)

```bash
npx prisma studio
```

Opens at `http://localhost:5555` — useful for inspecting data during development.

### Create a new migration after schema changes

```bash
npx prisma migrate dev --name describe_your_change
```

### Current migrations

| Migration | Description |
|-----------|-------------|
| `20260329120744_init` | Initial schema with all tables |
| `20260329130229_add_password_reset_fields` | Password reset token + expiry on User |
| `20260401180957_add_email_verification` | EmailVerification model |
| `20260404200000_add_password_reset_request_tracking` | RateLimitedRequest model with type enum |
| `20260405090000_add_account_lockout_fields` | failedLoginAttempts + lockedUntil on User |
| `20260405140000_hash_otp_code_varchar64` | Expand OTP code column to 64 chars (SHA-256) |
| `20260405143000_add_registration_ip_detected_country` | registrationIp + detectedCountry on User |

## Project Structure

```
src/
├── app.module.ts              # Root module — imports all feature modules
├── main.ts                    # Bootstrap — Helmet, CORS, ValidationPipe
├── common/
│   ├── decorators/            # @Public(), @Roles(), @SkipEmailVerification()
│   ├── filters/               # HttpExceptionFilter (global error handler)
│   ├── guards/                # EmailVerifiedGuard, RolesGuard, ContentAccessGuard
│   ├── interceptors/          # ResponseTransformInterceptor (wraps all responses)
│   ├── interfaces/            # ApiResponse<T>, ApiError
│   ├── error-codes.enum.ts    # Centralized error codes
│   └── geoip.service.ts       # IP-to-country lookup via geoip-lite
├── auth/                      # Register, login, JWT, password reset, email verification
│   ├── dto/                   # RegisterDto, LoginDto, ForgotPasswordDto, etc.
│   ├── guards/                # JwtAuthGuard (global)
│   ├── strategies/            # JwtStrategy (cookie + bearer extraction)
│   └── interfaces/            # JwtPayload
├── users/                     # Profile CRUD, password change, onboarding
│   └── dto/                   # UpdateUserDto, ChangePasswordDto, etc.
├── prisma/                    # PrismaService (@Global — available to all modules)
├── mail/                      # Email sending (AWS SES stub)
├── tasks/                     # Scheduled jobs (rate limit cleanup cron)
├── health/                    # GET /health endpoint
├── paths/                     # Learning paths (stub)
├── lessons/                   # Lesson content (stub)
├── progress/                  # Progress tracking (stub)
├── quizzes/                   # Quizzes and grading (stub)
├── projects/                  # Project submissions (stub)
├── subscriptions/             # Stripe subscriptions (stub)
├── payments/                  # Payment records + webhooks (stub)
├── certificates/              # Certificate generation (stub)
├── admin/                     # Admin dashboard (stub)
├── analytics/                 # PostHog event tracking (stub)
└── storage/                   # AWS S3 file uploads (stub)
prisma/
├── schema.prisma              # Data model (16 enums, 20+ models)
└── migrations/                # SQL migration files
postman/
└── awamer-api.postman_collection.json  # API request collection (local copy)
specs/                         # Feature specifications and planning docs
```

## API Overview

**Base URL:** `http://localhost:3001/api/v1`

All responses follow the format: `{ data: T, message: string }`

### Auth endpoints (public)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/refresh` | Refresh access token (cookie-based) |
| POST | `/auth/forgot-password` | Request password reset email |
| POST | `/auth/reset-password` | Reset password with token |
| GET | `/auth/verify-reset-token` | Validate reset token |

### Auth endpoints (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/logout` | Logout (clears cookies) |
| POST | `/auth/send-verification` | Send email verification OTP |
| POST | `/auth/resend-verification` | Resend OTP |
| POST | `/auth/verify-email` | Verify email with 6-digit code |

### User endpoints (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users/me` | Get current user profile |
| PATCH | `/users/me` | Update user (name, locale) |
| PATCH | `/users/me/profile` | Update profile (displayName, avatar) |
| PATCH | `/users/me/password` | Change password |
| POST | `/users/me/onboarding` | Submit onboarding responses |
| GET | `/users/me/onboarding` | Get onboarding status |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (public) |

## Security Features

- **JWT authentication** via httpOnly cookies (access token 15 min, refresh token 7/30 days)
- **Password requirements**: 8-128 chars, uppercase + lowercase + digit + special character
- **Account lockout**: 10 failed attempts → 15-minute lockout
- **Rate limiting**: Global throttler + per-endpoint application-level limits with Retry-After headers
- **OTP security**: SHA-256 hashed before storage, timing-safe comparison, 5-attempt max, 10-minute expiry
- **Reset tokens**: SHA-256 hashed, 1-hour expiry, single-use
- **Timing attack prevention**: Dummy bcrypt on non-existent email login
- **GeoIP detection**: Server-side IP-to-country resolution on registration
- **Helmet**: Security headers enabled
- **CORS**: Configurable multi-origin support
- **Input validation**: class-validator with whitelist + forbidNonWhitelisted

## Postman Collection

A Postman collection with 61 requests and tests is maintained in the **Awamer** workspace. The local file at `postman/awamer-api.postman_collection.json` is a reference copy.

To use: import the collection into Postman and set the `base_url` variable to `http://localhost:3001/api/v1`.

## Linting and Formatting

```bash
# Lint and auto-fix
npm run lint

# Format with Prettier
npm run format
```

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | NestJS 10 |
| Language | TypeScript 5 |
| ORM | Prisma 6 |
| Database | PostgreSQL |
| Auth | Passport JWT + bcryptjs |
| Validation | class-validator + class-transformer |
| Rate Limiting | @nestjs/throttler |
| Scheduling | @nestjs/schedule |
| Security | Helmet |
| GeoIP | geoip-lite |
| Email | AWS SES (stub) |
| Storage | AWS S3 (stub) |
| Payments | Stripe (stub) |
| Analytics | PostHog (stub) |
