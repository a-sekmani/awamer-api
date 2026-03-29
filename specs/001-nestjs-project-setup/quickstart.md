# Quickstart: NestJS Project Foundation Setup

**Feature**: `001-nestjs-project-setup`
**Date**: 2026-03-29

---

## Prerequisites

- Node.js 20 LTS (`node -v` → `v20.x.x`)
- npm 10+ (`npm -v` → `10.x.x`)
- PostgreSQL 15+ running locally or via Docker
- Git

---

## 1. Clone and Install

```bash
git clone <repo-url> awamer-api
cd awamer-api
npm install
```

---

## 2. Environment Setup

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. Minimum required to start:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/awamer
JWT_SECRET=change-me-to-a-long-random-string
JWT_REFRESH_SECRET=change-me-to-a-different-long-random-string
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
AWS_ACCESS_KEY_ID=placeholder
AWS_SECRET_ACCESS_KEY=placeholder
AWS_REGION=eu-west-1
S3_BUCKET_NAME=awamer-files
SES_FROM_EMAIL=noreply@awamer.com
POSTHOG_API_KEY=phc_placeholder
```

> **Note**: The application will refuse to start if `DATABASE_URL`, `JWT_SECRET`,
> or `JWT_REFRESH_SECRET` are missing or empty.

---

## 3. Database Setup

```bash
# Generate Prisma Client
npx prisma generate

# Run migrations (creates the database schema)
npx prisma migrate dev --name init
```

---

## 4. Start the Development Server

```bash
npm run start:dev
```

The server starts on `http://localhost:3001`.

---

## 5. Verify the Setup

```bash
# Health check — should return { "data": { "status": "ok" }, "message": "Success" }
curl http://localhost:3001/api/v1/health
```

Expected response:
```json
{
  "data": { "status": "ok" },
  "message": "Success"
}
```

---

## 6. Verify Security Headers

```bash
curl -I http://localhost:3001/api/v1/health
```

Expected headers (from Helmet):
```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 0
...
```

---

## 7. Verify Rate Limiting

```bash
# Send 101 requests in quick succession — the 101st should return 429
for i in $(seq 1 105); do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/v1/health
done
```

Requests 1–100 return `200`. Requests 101+ return `429`.

---

## 8. Verify CORS

```bash
# From an allowed origin
curl -H "Origin: http://localhost:3000" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     http://localhost:3001/api/v1/health -v

# From a blocked origin — should NOT include Access-Control-Allow-Origin
curl -H "Origin: http://evil.com" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     http://localhost:3001/api/v1/health -v
```

---

## 9. Verify Validation

```bash
# Send a request with unknown fields — should return 400
curl -X POST http://localhost:3001/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@test.com","password":"pass","unknownField":"bad"}'
```

Expected:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [...]
}
```

---

## Common Development Tasks

### Add a migration after schema changes

```bash
npx prisma migrate dev --name <describe-change>
```

### Open Prisma Studio (database GUI)

```bash
npx prisma studio
```

### Run tests

```bash
npm run test           # unit tests
npm run test:e2e       # end-to-end tests
npm run test:cov       # coverage report
```

### Build for production

```bash
npm run build
npm run start:prod
```

---

## Multi-Step Operation Pattern (Transactional Integrity)

When implementing features that write to multiple tables, always use
`prisma.$transaction`:

```typescript
// Example from ProgressService
async completeLesson(userId: string, lessonId: string) {
  return this.prisma.$transaction(async (tx) => {
    await tx.lessonProgress.upsert({ ... });
    await tx.sectionProgress.update({ ... });
    await tx.courseProgress.update({ ... });
    await tx.pathProgress.update({ ... });
    await tx.lastPosition.upsert({ ... });
    // If 100%: trigger CertificateService
  });
}
```

---

## Documentation References

- Data Model: See `CLAUDE.md` → Data Model section
- API Design: See `specs/001-nestjs-project-setup/contracts/api-contracts.md`
- Constitution: See `.specify/memory/constitution.md`
- Full Spec: See `specs/001-nestjs-project-setup/spec.md`