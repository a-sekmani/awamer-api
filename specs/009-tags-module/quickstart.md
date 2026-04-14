# Quickstart — Tags Module (KAN-71)

This document is the shortest path from a fresh clone of the repo to a running, tested Tags module.

## Prerequisites

- Node.js 20 LTS installed
- PostgreSQL running locally (default `postgresql://localhost:5432`)
- The KAN-70 schema migration has been applied (`prisma/migrations/20260414145648_v6_path_course_pages_alignment/`)
- `DATABASE_URL` is set in `.env`
- (Optional) `DATABASE_URL_TEST` set if you want to isolate the test database

## 1. Install and build

```bash
npm install
npm run build          # must succeed with zero TypeScript errors
```

## 2. Apply migrations and seed

```bash
npx prisma migrate deploy
npx prisma generate
npm run seed           # populates the KAN-70 v6 fixtures
```

## 3. Run the dev server

```bash
npm run start:dev      # starts NestJS on http://localhost:3001
```

## 4. Smoke test the public endpoint

```bash
curl http://localhost:3001/api/v1/tags
```

**Expected**:
- HTTP 200
- `Cache-Control: public, max-age=60` header
- JSON body `{ "data": [...], "message": "Success" }`
- Each entry has `id`, `name`, `slug`, `pathCount`, `courseCount`
- Only tags with `status = ACTIVE` appear

Arabic characters in `name` should render correctly (e.g. `"ذكاء صناعي"`).

## 5. Smoke test the admin endpoints

Admin endpoints require an authenticated admin cookie. For local smoke testing:

```bash
# 1. Register an admin user (or make an existing user admin via a DB write)
# 2. Log in to obtain the JWT cookie
curl -c /tmp/cookies.txt -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@awamer.test","password":"<password>"}'

# 3. List all tags (including hidden)
curl -b /tmp/cookies.txt http://localhost:3001/api/v1/admin/tags

# 4. Create a new tag
curl -b /tmp/cookies.txt -X POST http://localhost:3001/api/v1/admin/tags \
  -H 'Content-Type: application/json' \
  -d '{"name":"نيت","slug":"net","status":"ACTIVE"}'

# 5. Update it
curl -b /tmp/cookies.txt -X PATCH \
  http://localhost:3001/api/v1/admin/tags/<id> \
  -H 'Content-Type: application/json' \
  -d '{"status":"HIDDEN"}'

# 6. Delete it
curl -b /tmp/cookies.txt -X DELETE \
  http://localhost:3001/api/v1/admin/tags/<id>
```

## 6. Run automated tests

```bash
# Unit tests (runs tags.service.spec.ts and replace-tag-associations.helper.spec.ts)
npm test

# Schema suite (KAN-70, must still be green)
npm run test:schema

# Content e2e suite (new in KAN-71)
npm run test:content:e2e
```

All three must pass.

## 7. Verify the KAN-71 Definition of Done

```bash
# Schema unchanged:
git diff prisma/schema.prisma                  # must be empty
git diff prisma/migrations/                    # must be empty

# Protected modules unchanged:
git diff src/auth src/users src/common         # must be empty

# Build clean:
npm run build                                   # zero errors

# Everything green:
npm test && npm run test:schema && npm run test:content:e2e
```

## Known TODOs left behind for future tickets

- `// TODO(KAN-74): wire CacheService here` markers in `TagsService` — will be wired up when `CacheModule` lands.
- The atomic replace helper is exported but not yet called by any controller. Future Path/Course admin edit endpoints (KAN-72, KAN-73) will inject `ContentModule` and call `ReplaceTagAssociationsHelper.replaceForPath` / `replaceForCourse`.

## Where things live

| Concern | Location |
|---|---|
| Module registration | `src/content/content.module.ts`, registered in `src/app.module.ts` |
| Public controller | `src/content/tags/tags.controller.ts` → `GET /api/v1/tags` |
| Admin controller | `src/content/tags/admin-tags.controller.ts` → `/api/v1/admin/tags` |
| Service | `src/content/tags/tags.service.ts` |
| DTOs | `src/content/tags/dto/` |
| Atomic replace helper | `src/content/tags/helpers/replace-tag-associations.helper.ts` |
| Unit tests | `src/content/tags/tags.service.spec.ts`, `src/content/tags/helpers/replace-tag-associations.helper.spec.ts` |
| E2e tests | `test/content/tags/*.e2e-spec.ts` |
| E2e jest config | `test/content-e2e-jest.config.js` |

## Troubleshooting

**Symptom**: `GET /api/v1/tags` returns 404.
**Cause**: `ContentModule` is not registered in `src/app.module.ts`.
**Fix**: Add `ContentModule` to the `imports` array of `AppModule`.

**Symptom**: Counts come back too high (include draft/archived paths).
**Cause**: Missing `where: { path: { status: PathStatus.PUBLISHED } }` filter on the `groupBy` query.
**Fix**: See `research.md` R4 for the correct query shape.

**Symptom**: `npm run test:content:e2e` fails with "database does not exist".
**Cause**: `awamer_test` has not been created yet.
**Fix**: Run `npm run test:schema` once first — its `global-setup.ts` creates the test DB.
