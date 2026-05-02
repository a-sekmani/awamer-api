# Contract: Migration `drop_category_columns_and_restrict_content_fks`

**Owner**: KAN-82
**File**: `prisma/migrations/<timestamp>_drop_category_columns_and_restrict_content_fks/migration.sql`
**Generator**: `prisma migrate dev --name drop_category_columns_and_restrict_content_fks`

## What this migration MUST do

1. Drop the column `description` from `categories`.
2. Drop the column `icon` from `categories`.
3. Replace the `paths_categoryId_fkey` foreign key so that `Path.categoryId → Category.id` is `ON DELETE RESTRICT ON UPDATE CASCADE`. (Currently `ON DELETE CASCADE`.)
4. Replace the `courses_pathId_fkey` foreign key so that `Course.pathId → Path.id` is `ON DELETE RESTRICT ON UPDATE CASCADE`. (Currently `ON DELETE CASCADE`.)

All four steps live in a single `migration.sql` file. The migration must be applied via `prisma migrate dev` against a fresh dev database and verified with `prisma migrate status` (must report up-to-date).

## What this migration MUST NOT do

- MUST NOT alter `Certificate.path`, `Certificate.course`, `QuizAttempt.quiz`, `ProjectSubmission.project` FKs — those are explicitly out of scope (separate retention-policy concern).
- MUST NOT add `@unique` to `Category.name` — deferred to KAN-101.
- MUST NOT add or remove indexes other than what the FK constraint changes implicitly.
- MUST NOT introduce data backfills (the dropped columns are nullable and unused; no data migration needed).
- MUST NOT touch any other table.

## Verification

After `prisma migrate dev`:

1. Run `prisma migrate status` → expect "Database schema is up to date".
2. Run `npm test -- src/content/categories` → existing public spec still passes after assertion edits remove `description` / `icon`.
3. Run `npm run test:e2e -- test/content/categories` → existing public e2e still passes.
4. Grep for residual references:

   ```bash
   grep -rn "category\.\(description\|icon\)\|description: row\.description\|icon: row\.icon" src/ test/ prisma/
   # Expected: no matches
   ```

5. Manually verify Postgres FK actions:

   ```sql
   SELECT con.conname, con.confdeltype
   FROM pg_constraint con
   JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname IN ('paths', 'courses')
     AND con.conname IN ('paths_categoryId_fkey', 'courses_pathId_fkey');
   -- Expected: confdeltype = 'r' (RESTRICT) for both rows
   ```

## Reversibility

The down direction is conceptually trivial (re-add `description` and `icon` as nullable text, revert the two FKs to Cascade), but no down migration is shipped in this PR. Local rollback in dev: `prisma migrate reset` + reapply.
