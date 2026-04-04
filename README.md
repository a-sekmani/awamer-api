# Awamer API

Backend REST API for the Awamer (أوامر) educational platform — an Arabic-first learning platform specializing in AI, Cybersecurity, and Cloud/DevOps, targeting the Saudi Arabia market.

Built with **NestJS**, **Prisma**, and **PostgreSQL**.

## Prerequisites

- Node.js 20 LTS
- PostgreSQL
- npm

## Setup

1. **Clone and install dependencies:**

   ```bash
   git clone <repo-url>
   cd awamer-api
   npm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your database credentials and secrets. At minimum, set:
   - `DATABASE_URL` — PostgreSQL connection string
   - `JWT_SECRET` / `JWT_REFRESH_SECRET` — random secret strings
   - `FRONTEND_URL` — frontend origin for CORS (default: `http://localhost:3000`)

3. **Set up the database:**

   ```bash
   npx prisma migrate dev
   ```

## Running the App

```bash
# Development (watch mode)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

The API runs on `http://localhost:3001` by default. Base URL: `/api/v1/`.

## Testing

```bash
# Unit tests
npm test

# Unit tests (watch mode)
npm run test:watch

# Test coverage
npm run test:cov

# End-to-end tests
npm run test:e2e
```

## Project Structure

```
src/
├── app.module.ts          # Root module
├── auth/                  # Authentication (register, login, JWT, password reset)
├── users/                 # User profiles, password change, onboarding
├── mail/                  # Email sending via AWS SES
├── paths/                 # Learning paths and courses
├── lessons/               # Lesson content
├── progress/              # Learning progress tracking
├── quizzes/               # Quizzes and grading
├── projects/              # Project submissions
├── subscriptions/         # Stripe subscription management
├── payments/              # Payment records and webhooks
├── certificates/          # Certificate generation
├── admin/                 # Admin dashboard and content management
├── analytics/             # PostHog event tracking
├── storage/               # AWS S3 file uploads
├── prisma/                # Prisma service
└── health/                # Health check endpoint
```

## Resetting the Database

To drop all data and re-apply migrations from scratch:

```bash
npx prisma migrate reset
```

This will drop the database, re-create it, run all migrations, and run the seed script (if one exists). You will be prompted to confirm.

## Linting & Formatting

```bash
npm run lint
npm run format
```
