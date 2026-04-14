# REFACTOR — Migrate Prisma schema and existing code to camelCase + @map convention

> **Type:** Tech debt / refactor
> **Scope:** `awamer-api` repository
> **Estimated effort:** 1–2 hours
> **No Jira ticket yet** — this is a developer-driven cleanup before resuming KAN-70

---

## Why this refactor

The current `prisma/schema.prisma` uses `snake_case` for Prisma field names directly (not just for database column names). This means the generated Prisma client also exposes `snake_case` properties, which conflicts with the JavaScript/TypeScript convention of `camelCase` for object properties.

The downsides of the current state:

- DTOs in NestJS use `camelCase` (per class-validator and standard TypeScript), forcing manual mapping between DTO fields and Prisma client fields in every service
- API responses sent to the frontend will be `snake_case` unless a transformation layer is added
- ESLint's `camelcase` rule fires warnings on every Prisma query
- New developers joining the project will find the convention surprising and inconsistent with their muscle memory
- Every future ticket compounds the cost of this technical debt

The fix is to follow the standard Prisma convention used by 90%+ of TypeScript projects:

- **Field names in `schema.prisma` use `camelCase`** (which becomes the Prisma client property name)
- **Database column names stay `snake_case`** via `@map("snake_case_name")` directives
- **Table names stay `snake_case` plural** via `@@map("table_name")`
- **Enum values use `UPPER_SNAKE_CASE` in code** via `@map("lowercase_value")` for the database

This refactor is being done now because:

1. The project has no production data — the migration is risk-free
2. Only `auth` and `onboarding` modules are implemented in `src/`, which limits the code surface to update
3. Doing this before KAN-70 means every downstream ticket (KAN-70, 71, 72, 73, 26) starts from a clean foundation
4. Postponing it makes it more expensive over time as the codebase grows

---

## Goal

After this refactor, the following must all be true:

1. Every Prisma field in `schema.prisma` uses `camelCase`
2. Every field has an `@map("snake_case_name")` directive matching its current database column name (so the database itself is unchanged)
3. Every model has a `@@map("table_name")` directive matching its current database table name
4. Every enum has uppercase values with `@map("lowercase_value")` directives, and a `@@map("enum_name")` directive
5. All code in `src/auth` and `src/onboarding` uses the new `camelCase` Prisma client property names
6. All existing DTOs use `camelCase` (most likely they already do, but verify)
7. All existing tests pass
8. `npm run build` succeeds
9. The database itself (column names, table names, enum values stored in PostgreSQL) is **not changed** at all — only the Prisma DSL representation
10. No business logic changes

---

## Critical constraint: database stays the same

This is the most important rule of the refactor.

**The actual PostgreSQL database — table names, column names, and stored enum values — must remain exactly as they are today.** Only the Prisma DSL representation changes. The `@map` and `@@map` directives are the bridge: they tell Prisma "the developer-facing name is X but the database name is Y".

This means:

- After running `npx prisma migrate dev`, **no migration SQL should be generated**, because the database schema didn't actually change. If Prisma tries to generate a migration with `ALTER TABLE` or `RENAME COLUMN` statements, something is wrong with the `@map` directives — stop and check.
- The existing data in the local database (whatever stale seed data exists) should still be readable through the Prisma client after the refactor, because it's the same database with the same columns.
- No `db:reset` is needed for this refactor.

If you find yourself thinking "I need to write a migration to rename columns", **stop**. The whole point of the `@map` directives is to avoid touching the database.

---

## Step 1 — Audit the current schema

Before changing anything, read `prisma/schema.prisma` in full and produce a mental map of:

- Every model and its current name (probably already snake_case plural like `users`, or PascalCase like `User`)
- Every field on every model and its current snake_case name
- Every enum and its current values
- Every existing `@@map` and `@map` directive (some may already exist)

Then read every file in `src/auth/**` and `src/onboarding/**` and identify every place that calls the Prisma client. Note which models and fields are referenced. This is the surface area you'll need to update in Step 3.

Report your findings to me before making any edits. Specifically tell me:

1. The full list of models in the current schema, and their current Prisma model name
2. For each model used by `auth` or `onboarding`, list the fields used by the existing code
3. Any models or fields that already use `camelCase` + `@map` (these are already correct and shouldn't be touched)
4. Any potential surprises (unusual relations, custom types, fields with non-obvious names)

Wait for my confirmation before proceeding to Step 2.

---

## Step 2 — Refactor schema.prisma

Once I've confirmed your audit, rewrite `schema.prisma` field by field, model by model.

### Field naming rules

For every field in every model:

1. **Convert the field name to camelCase.** Examples: `is_free` → `isFree`, `created_at` → `createdAt`, `path_id` → `pathId`, `user_id` → `userId`, `first_name` → `firstName`, `last_name` → `lastName`, `email_verified_at` → `emailVerifiedAt`.

2. **Add `@map("original_snake_case_name")` to preserve the database column name.** Example:
   ```prisma
   isFree    Boolean  @default(false) @map("is_free")
   createdAt DateTime @default(now())  @map("created_at")
   pathId    String                    @map("path_id")
   ```

3. **Single-word fields don't need `@map`.** Examples: `id`, `email`, `status`, `name`, `slug`, `title`, `description`, `order`, `rating`. These are already identical in both casings, so no `@map` is needed (Prisma will use the field name as the column name).

4. **Foreign key relation field names also become camelCase, but the relation name (the related model property) was already correct.** Example:
   ```prisma
   // Before
   model PathEnrollment {
     user_id String
     path_id String
     user    User @relation(fields: [user_id], references: [id])
     path    Path @relation(fields: [path_id], references: [id])
   }

   // After
   model PathEnrollment {
     userId String @map("user_id")
     pathId String @map("path_id")
     user   User @relation(fields: [userId], references: [id])
     path   Path @relation(fields: [pathId], references: [id])
   }
   ```

### Model naming rules

5. **Convert each model name to PascalCase singular.** This is the standard Prisma convention. Examples: if the current model is `users`, rename to `User`. If `path_enrollments`, rename to `PathEnrollment`. If `lesson_progress`, rename to `LessonProgress`.

6. **Add `@@map("snake_case_plural_table_name")` to preserve the database table name.** Example:
   ```prisma
   model User {
     // ... fields
     @@map("users")
   }

   model PathEnrollment {
     // ... fields
     @@map("path_enrollments")
   }
   ```

7. **If a model already has the correct name and `@@map`, leave it alone.**

8. **Update every `@relation` reference** when you rename a model. Prisma will catch these for you — if a model `Foo` has `bar Bar[]` and you rename `Bar` to `Baz`, you must update `Foo.bar` to `bar Baz[]`. The Prisma validator will complain if you miss any.

### Enum naming rules

9. **Convert enum names to PascalCase singular.** Examples: `enrollment_status` → `EnrollmentStatus`, `subscription_status` → `SubscriptionStatus`, `lesson_type` → `LessonType`.

10. **Convert enum values to UPPER_SNAKE_CASE.** Examples: `active` → `ACTIVE`, `in_progress` → `IN_PROGRESS`, `not_started` → `NOT_STARTED`.

11. **Add `@map("original_lowercase_value")` to each enum value to preserve the database stored value.** Example:
    ```prisma
    enum EnrollmentStatus {
      ACTIVE      @map("active")
      COMPLETED   @map("completed")
      PAUSED      @map("paused")

      @@map("enrollment_status")
    }
    ```

12. **Add `@@map("snake_case_enum_name")` to preserve the database enum type name.**

### Composite indexes and unique constraints

13. **Update every `@@unique`, `@@index`, and `@@id` to use the new camelCase field names**, not the old snake_case names. Example:
    ```prisma
    // Before
    @@unique([user_id, path_id])

    // After
    @@unique([userId, pathId])
    ```

The `@@unique` directive references Prisma field names (which are now camelCase), not database column names (which stay snake_case via `@map`).

### Relation fields with no `@map` needed

14. **Pure relation fields (the ones without `fields:` and `references:`) don't need `@map`.** Example:
    ```prisma
    model User {
      id              String           @id
      pathEnrollments PathEnrollment[]   // ← no @map needed, this isn't a column
      courseProgress  CourseProgress[]   // ← same
    }
    ```

These are virtual properties that Prisma uses to navigate relations. They don't correspond to database columns.

### Validation

After rewriting the schema, run `npx prisma validate`. It should report zero errors. If it complains, fix the issues before proceeding.

Then run `npx prisma format` to clean up the formatting.

Then run `npx prisma migrate dev --create-only --name refactor_camelcase_convention` and **inspect the generated migration.sql**. It should be **empty** (or contain only comments). If it contains any `ALTER TABLE`, `RENAME COLUMN`, `CREATE TYPE`, `DROP TYPE`, or any other DDL statements, **stop immediately** — that means an `@map` directive is missing or wrong. Do not proceed until the migration file is empty.

Once the migration is empty, you can safely delete that empty migration folder (no need to commit an empty migration). Or, alternatively, commit it as a no-op migration with a comment explaining it's a representation-only change.

Finally run `npx prisma generate` to refresh the Prisma client with the new field names.

---

## Step 3 — Refactor src/auth and src/onboarding

Now that the Prisma client uses camelCase, every query in `src/auth` and `src/onboarding` will fail TypeScript compilation. Fix them all.

### What to update

For every file under `src/auth/**` and `src/onboarding/**`:

1. **Prisma client property accesses.** Example:
   ```typescript
   // Before
   const user = await this.prisma.user.findUnique({ where: { id } });
   if (user.email_verified_at) { ... }

   // After
   const user = await this.prisma.user.findUnique({ where: { id } });
   if (user.emailVerifiedAt) { ... }
   ```

2. **Prisma query field references.** Example:
   ```typescript
   // Before
   await this.prisma.user.create({
     data: {
       email,
       first_name: dto.firstName,
       last_name: dto.lastName,
       password_hash: hashedPassword,
     },
   });

   // After
   await this.prisma.user.create({
     data: {
       email,
       firstName: dto.firstName,
       lastName: dto.lastName,
       passwordHash: hashedPassword,
     },
   });
   ```

3. **Where clauses, includes, selects, orderBys** — all use the new camelCase field names.

4. **DTOs that mirror Prisma fields** — verify they already use camelCase. If any DTO uses snake_case (which would be unusual for NestJS), update it. **But do not rename DTO fields if the API contract is already public anywhere** — although for this project, no public API exists yet, so rename freely.

5. **Refresh token storage** — if there's a refresh token model, update those queries too. Pay attention to fields like `revoked_at`, `expires_at`, `user_id`.

6. **Test files under `src/auth/**/*.spec.ts` and `src/onboarding/**/*.spec.ts`** — update mocked Prisma return values and assertions to use camelCase.

### What NOT to touch

- **Do not change any business logic.** The only changes are field name renames and the necessary type adjustments. If a service does `await prisma.user.update({ where: { id }, data: { last_login_at: new Date() } })`, the only change is `last_login_at` → `lastLoginAt`. The logic, the timing, the conditions — all stay identical.
- **Do not rename functions, methods, classes, or files.**
- **Do not extract refactors or rewrite code "while you're there".** This is a mechanical refactor only.
- **Do not touch any other directory in `src/`** even if it exists. Only `src/auth` and `src/onboarding`.

### How to find all the places to fix

The fastest approach: rely on the TypeScript compiler.

```bash
npm run build
```

It will output a list of every file with type errors and the exact line numbers. Walk through them one by one. After fixing each batch, re-run the build. Repeat until the build is clean.

If the project doesn't have a `build` script, use `npx tsc --noEmit` instead, which type-checks without producing output.

---

## Step 4 — Verify everything works

Once the build is green, run the existing test suite:

```bash
npm test
```

All previously-passing tests must still pass. If any test fails, the most likely cause is a missed field rename in a mock or an assertion. Fix the test, don't change the schema or the production code unless there's a real bug exposed.

Also manually verify:

1. **Local Prisma Studio shows the same data as before.** Run `npx prisma studio` and click through a few rows. The data should be unchanged because we didn't touch the database. The column headers will still be snake_case in Studio (because Studio shows database column names), but the data is identical.

2. **The auth flow still works end-to-end.** Run the dev server (`npm run start:dev`) and manually:
   - Register a new user
   - Log in with that user
   - Hit a protected endpoint
   - Refresh the token

   These should all work exactly as before. If anything fails, investigate immediately.

3. **The onboarding flow still works.** Submit an onboarding response and verify it persists.

---

## Step 5 — Document what changed

Create a short note at `prisma/REFACTOR_NOTES.md`:

```markdown
# Refactor: Prisma schema migrated to camelCase + @map convention

**Date:** <auto>
**Reason:** Align with standard Prisma + TypeScript convention before the public discovery epic begins.

## What changed

- All Prisma field names in `schema.prisma` are now `camelCase` (e.g., `is_free` → `isFree`).
- Every field has an `@map("snake_case_name")` directive preserving the database column name.
- All model names are PascalCase singular (e.g., `users` → `User`), with `@@map("snake_case_plural")` preserving the database table name.
- All enum values are `UPPER_SNAKE_CASE` (e.g., `active` → `ACTIVE`), with `@map("lowercase")` preserving the database stored value.
- The `src/auth` and `src/onboarding` modules were updated to use the new Prisma client property names.

## What did NOT change

- The PostgreSQL database itself: table names, column names, enum types, stored data — all unchanged.
- Any business logic, API contracts, or test scenarios.
- Any module other than `auth` and `onboarding` (no other modules were implemented at the time of this refactor).

## How to verify

\`\`\`bash
npm run build      # must succeed
npm test           # all existing tests must pass
npx prisma validate  # zero errors
\`\`\`

The next ticket (KAN-70) will add new fields and entities for Data Model v6 on top of this clean foundation.
```

Add a one-line link to this file from the main `README.md` under a "History" or "Recent changes" section if such a section exists. If not, skip this — don't create new sections in the README just for one line.

---

## Step 6 — Final checklist

The refactor is complete only when **all** of these are true:

1. ✅ `npx prisma validate` reports zero errors
2. ✅ `npx prisma format` produces no further changes (idempotent)
3. ✅ `npx prisma migrate dev --create-only` produces an empty migration file (or one that only changes representation, no actual DDL)
4. ✅ `npx prisma generate` succeeds
5. ✅ `npm run build` succeeds with zero TypeScript errors
6. ✅ `npm test` shows all existing tests passing
7. ✅ The auth flow (register / login / protected route / refresh) works end-to-end manually
8. ✅ The onboarding flow works manually
9. ✅ `prisma/REFACTOR_NOTES.md` exists
10. ✅ No file outside `prisma/`, `src/auth/`, and `src/onboarding/` has been modified
11. ✅ The database has not been touched (no destructive migration ran, the local DB still contains its previous data, Prisma Studio shows the same rows as before)
12. ✅ A PR is open with a descriptive title like "REFACTOR: Migrate Prisma schema to camelCase + @map convention"

---

## When you're done

Give me a summary that includes:

- The full list of models in the schema, with their old name → new name (e.g., `users → User`, `path_enrollments → PathEnrollment`)
- The full list of enums with their old name → new name
- A count of files modified in `src/auth` and `src/onboarding`
- Any decisions you had to make on your own (e.g., a field name where the camelCase translation was ambiguous)
- Any test that failed once and you fixed (with the root cause)
- Confirmation that the database was not touched
- Confirmation that all 12 items in the final checklist are green

After this refactor is merged, we'll resume KAN-70 with a clean foundation. The KAN-70 spec file will need a small update to use camelCase for all the new fields it introduces, but I'll handle that update separately — you don't need to look at KAN-70 yet.

---

## Strict rules (repeating because they matter)

- **Do not touch the database.** All changes are representation-only via `@map` and `@@map`.
- **Do not change any business logic.** Only field name renames.
- **Do not touch any module in `src/` other than `auth` and `onboarding`.**
- **Do not rename files, classes, methods, or functions.** Only Prisma field references inside the bodies of existing methods.
- **Stop and ask me** if you encounter any genuine ambiguity (unusual field names, schemas you don't understand, business logic that breaks unexpectedly, anything that requires a non-mechanical decision).

Begin with Step 1: audit the current schema and report your findings. Wait for my confirmation before proceeding to Step 2.
