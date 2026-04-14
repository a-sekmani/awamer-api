# Migration: v6_path_course_pages_alignment

**Jira:** KAN-70
**Date:** 2026-04-14
**Authoritative spec:** Confluence — Data Model v6

## ⚠️ Destructive migration — fresh database required

This migration introduces `courses.categoryId` as a required column with no
default value, makes `courses.pathId` nullable, and drops the default on
`courses.order`. Any existing rows in the `courses` table will fail the
migration.

Awamer has no production database yet, so the correct workflow is to drop
and recreate the local database before applying:

```bash
npx prisma migrate reset --force   # drops and recreates the dev DB
npx prisma migrate deploy
npm run seed
```

Anyone pulling this branch must do the same. **Do NOT run this migration
against a database with real data.**

## What changed

- `Course` now has a mandatory `categoryId` and an optional `pathId`. Standalone courses (no path) are supported.
- `Course` now has a unique `slug` and the new fields: `subtitle`, `level` (`CourseLevel?`), `thumbnail`, `isNew`, `skills` (JSONB).
- `Course.order` is now nullable with no default; it is only set when `pathId` is set (service-layer rule).
- `Path` has new fields: `subtitle`, `promoVideoUrl`, `promoVideoThumbnail`, `isNew`, `skills` (JSONB).
- `Section` has a new optional `description` field.
- New taxonomy entity `Tag` with many-to-many pivots `PathTag` and `CourseTag`.
- New polymorphic marketing content entities: `Feature`, `Faq`, `Testimonial` (each with `ownerType` enum + `ownerId`).
- New `CourseEnrollment` entity for standalone courses.
- `Certificate` generalized to support both path-level and course-level certificates via `type` discriminator + nullable `pathId`/`courseId` + CHECK constraint + partial unique indexes.
- `LastPosition` generalized to support both path enrollments and standalone course enrollments.
- Derived statistics (lessonCount, courseCount, etc.) are NEVER stored — they are computed at query time.
- New enums: `MarketingOwnerType`, `TestimonialStatus`, `CourseEnrollmentStatus`, `CertificateType`, `CourseLevel`, `TagStatus`.

At the time of this migration, only the `auth`, `users`, and `onboarding` (inside
`src/users/` and `src/common/guards/onboarding-completed.guard.ts`) modules exist
in `src/`. All other domains (paths, courses, sections, lessons, certificates,
progress, enrollments, quizzes, projects, subscriptions) will be implemented in
downstream tickets (KAN-26, KAN-71, KAN-72, KAN-73, and others) against this v6
schema. There is no existing service code that depends on the entities modified
by this migration, which is why no `src/` files were touched as part of KAN-70.

## Naming convention — Option B (camelCase columns)

Per project convention, Prisma field names and database column names are both
camelCase, except for the three legacy `is_free` columns which are hidden behind
`@map("is_free")` directives from an earlier refactor. Table names are
`snake_case_plural` (via `@@map`) and enum type names are `snake_case` with
lowercase values (via `@map`).

All Part 2 SQL (CHECK constraints + partial unique indexes) uses camelCase
column identifiers (`"userId"`, `"pathId"`, `"courseId"`) and lowercase enum
values (`'path'`, `'course'`) because those are the actual database identifiers.

## Manually-added SQL

The following constraints were added by hand at the bottom of the generated
`migration.sql` because the Prisma DSL cannot express them:

- `certificates_exactly_one_target` CHECK constraint
- `last_positions_exactly_one_scope` CHECK constraint
- `certificates_user_path_unique` partial unique index
- `certificates_user_course_unique` partial unique index
- `last_positions_user_path_unique` partial unique index
- `last_positions_user_course_unique` partial unique index

If a future migration regenerates these tables, these constraints must be
re-added.

## How to apply locally

```bash
npx prisma migrate deploy
npx prisma generate
npm run seed
```

## How to verify

```bash
npm run test:schema
```

All 48 tests in `test/schema/` must pass. Open Prisma Studio (`npx prisma
studio`) to visually confirm the new entities and relationships.

## Service-layer invariants (NOT enforced by the schema)

The schema deliberately does NOT enforce the following — they live in services
that come in later tickets:

- The polymorphic `ownerId` on `Feature`/`Faq`/`Testimonial` actually points to an existing Path or Course
- A `CourseEnrollment` is only created for courses with `pathId = null` (the schema does not block creating one for a path-attached course)
- Course `order` is only set when `pathId` is set
