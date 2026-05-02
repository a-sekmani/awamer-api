# Quickstart: BE Categories admin CRUD (KAN-82)

**Audience**: Backend developers running this feature locally for the first time.
**Estimated time**: under 10 minutes once the repo is checked out.

## Prerequisites

- Working `awamer-api` checkout on branch `015-categories-admin-crud`.
- Local Postgres + Redis running (typical via `docker-compose up -d`).
- `.env` populated per the project README.
- An admin JWT cookie for manual curl tests (use the `prisma/seed.ts` seeded admin or create one).

## 1. Apply the migration

```bash
npx prisma migrate dev
```

Expected:
- One migration file appears under `prisma/migrations/<timestamp>_drop_category_columns_and_restrict_content_fks/migration.sql`.
- Prisma reports "All migrations have been successfully applied."
- `npx prisma migrate status` reports "Database schema is up to date".

Sanity-check the FK actions in Postgres:

```sql
SELECT con.conname, con.confdeltype
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname IN ('paths','courses')
  AND con.conname IN ('paths_categoryId_fkey','courses_pathId_fkey');
-- Both rows: confdeltype = 'r'  (RESTRICT)
```

## 2. Run unit tests

```bash
npm test
```

Expected: ≥ 575 passing tests (KAN-78 baseline + the new spec files for `CategoriesAdminService` and the `HttpExceptionFilter` extension). Zero failures.

To narrow:

```bash
npm test -- src/admin/categories
npm test -- src/common/filters
npm test -- src/content/categories
```

## 3. Run e2e tests

```bash
npm run test:e2e
```

Expected: ≥ 332 passing tests including:
- the new `test/admin/categories.e2e-spec.ts` (covers all seven user stories)
- the existing `test/content/categories/categories.controller.e2e-spec.ts` (passing with the trimmed response shape — no `description`, no `icon`)

To narrow:

```bash
npm run test:e2e -- categories
```

## 4. Manual smoke test (admin curl)

Boot the API:

```bash
npm run start:dev
```

In another shell, with `$ADMIN_COOKIE` set to a valid admin access-token cookie:

```bash
# 1) Create a category
curl -X POST http://localhost:3001/api/v1/admin/categories \
  -H "Cookie: access_token=$ADMIN_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"name":"الذكاء الاصطناعي","slug":"ai"}' | jq

# 2) List (default — both ACTIVE and HIDDEN)
curl -H "Cookie: access_token=$ADMIN_COOKIE" \
  "http://localhost:3001/api/v1/admin/categories?page=1&limit=20" | jq

# 3) List filtered to HIDDEN only
curl -H "Cookie: access_token=$ADMIN_COOKIE" \
  "http://localhost:3001/api/v1/admin/categories?status=HIDDEN" | jq

# 4) Patch — change name only
CATEGORY_ID="<id from step 1>"
curl -X PATCH http://localhost:3001/api/v1/admin/categories/$CATEGORY_ID \
  -H "Cookie: access_token=$ADMIN_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"name":"اسم جديد"}' | jq

# 5) Delete (succeeds because no paths/courses point at it yet)
curl -X DELETE http://localhost:3001/api/v1/admin/categories/$CATEGORY_ID \
  -H "Cookie: access_token=$ADMIN_COOKIE" | jq
```

Expected envelope on every success: `{ "data": ..., "message": "Success" }`.

## 5. Manual conflict test (the high-stakes one)

```bash
# Seed includes categories with paths (FIXTURE.categories.ai). Try to delete one:
curl -X DELETE http://localhost:3001/api/v1/admin/categories/<seeded ai category id> \
  -H "Cookie: access_token=$ADMIN_COOKIE" | jq
```

Expected response (status 409):

```json
{
  "statusCode": 409,
  "errorCode": "CATEGORY_IN_USE",
  "message": "Category is in use",
  "errors": { "pathCount": 1, "courseCount": 1 }
}
```

If the response is missing the `errors` object, the filter passthrough did not land — see `contracts/http-exception-filter-passthrough.contract.md`.

## 6. Cache invalidation smoke

```bash
# Prime the public cache
curl http://localhost:3001/api/v1/categories | jq '.data | length'

# Confirm the key is in Redis (via redis-cli or your tool of choice)
redis-cli GET categories:all | head -c 80

# Mutate via admin
curl -X POST http://localhost:3001/api/v1/admin/categories \
  -H "Cookie: access_token=$ADMIN_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"name":"Cache Test","slug":"cache-test"}' > /dev/null

# Confirm the key is gone (deleted on successful POST)
redis-cli GET categories:all
# Expected: (nil)
```

## 7. Final verification before commit/merge

```bash
# Lint baseline (16 known errors, no new ones from this PR)
npm run lint 2>&1 | tail -5

# Type check
npx tsc -p tsconfig.build.json --noEmit

# No leftover references to dropped columns
grep -rn "category\.\(description\|icon\)\|description: row\.description\|icon: row\.icon" src/ test/ prisma/
# Expected: no matches
```

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Nest can't resolve dependencies of <Controller>` at startup | `RolesGuard` / `AuditLogInterceptor` not registered locally in the sub-module's `providers` | See "Failure mode: NestJS DI for sub-module guards" below |
| 409 returned without `errors` object | Filter extension did not land or has a typo | Re-check `src/common/filters/http-exception.filter.ts` against `contracts/http-exception-filter-passthrough.contract.md`. |
| 500 on DELETE of an in-use category | Service is catching only one of the two Prisma error classes | Verify `isFKViolation(e)` matches both `PrismaClientKnownRequestError (P2003)` and `PrismaClientUnknownRequestError (SQLSTATE 23001)` per `contracts/delete-fk-violation.contract.md`. |
| Public e2e test fails with `expected description not to exist` style message | A leftover assertion in the public spec needs trimming | Edit `test/content/categories/categories.controller.e2e-spec.ts` to drop assertions on `description` and `icon`. |
| `prisma migrate dev` errors with "drift detected" | Local DB has data Prisma doesn't expect | `prisma migrate reset` (dev only — wipes data) and reapply. |

### Failure mode: NestJS DI for sub-module guards

**Symptom**: `Nest can't resolve dependencies of <Controller>` at startup, or a runtime "guard could not be resolved" error.

**Cause**: `@AdminEndpoint()` requires `RolesGuard` and `AuditLogInterceptor` to be available in the controller's module DI scope. NestJS DI propagates from imported modules' exports into the importing module — **not the reverse**. So even though `AdminModule` exports both providers, sub-modules registered under `AdminModule.imports` (like `CategoriesAdminModule`) do NOT receive them automatically.

**Fix**: Register `RolesGuard` and `AuditLogInterceptor` locally in the sub-module's `providers` array. They're stateless (only inject framework-provided `Reflector` and `Logger`), so per-module instances have zero functional cost.

```ts
@Module({
  imports: [PrismaModule, CacheModule, AuthModule],
  controllers: [CategoriesAdminController],
  providers: [
    CategoriesAdminService,
    RolesGuard,            // ← required locally
    AuditLogInterceptor,   // ← required locally
  ],
})
export class CategoriesAdminModule {}
```

**Why KAN-78 docs say otherwise**: The KAN-78 foundation was tested only with `AdminHealthController` registered directly in `AdminModule.controllers` — same-module DI, never exercised the sub-module case. The "import the sub-module into `AdminModule.imports` and the guards flow through" guidance is incorrect for the sub-module pattern. KAN-100 will be expanded to fix the affected docs (`docs/admin/conventions.md`, `docs/admin/audit-log-interceptor.md`, `docs/admin/roles-guard.md`, ADR-006, the foundation quickstart, and the Confluence Tech Stack §6.9.7).
