# KAN-70 — Prisma Schema Migration for Data Model v6

> **Jira:** [KAN-70](https://awamer.atlassian.net/browse/KAN-70)
> **Parent epic:** KAN-4 (E3: Public Discovery)
> **Blocks:** KAN-26, KAN-71, KAN-72, KAN-73
> **Authoritative reference:** [Confluence — Data Model v6](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/28835841/Data+Model)

---

## Why this ticket does not use spec-kit

KAN-70 is pure infrastructure work (schema migration + seed + tests + docs). There are no real user stories, no API, no UI. spec-kit is designed for user-facing product features, and forcing a schema migration through its template would produce an artificial spec.md that adds overhead with no value. This ticket is therefore executed via a single direct prompt to Claude Code, leaving spec-kit for the downstream tickets (KAN-71, 72, 73, 26) which contain real behavior.

---

## Overall goal

After this ticket is complete, all of the following must be true:

1. `prisma/schema.prisma` matches Data Model v6 in full
2. One new migration is generated and applied cleanly to a fresh database
3. `prisma/seed.ts` populates the database with representative test data covering every new entity and every new relationship, and is fully idempotent
4. An integration test suite under `test/schema/` proves that every constraint and invariant in Data Model v6 holds
5. `prisma/MIGRATION_NOTES.md` documents what changed and why
6. Any developer can clone the repo, run `npm install && npx prisma migrate deploy && npm run seed && npm run test:schema` and see everything green

**Explicitly out of scope:** any file under `src/`. No NestJS modules, services, controllers, DTOs, or guards are touched. All NestJS work happens in downstream tickets.

---

## Part 1 — Schema changes

### 1.1 schema.prisma header

Add this comment block at the top of `schema.prisma` (after the `generator` and `datasource` blocks):

```prisma
// ========================================================================
// Awamer Data Model v6 — schema.prisma
//
// Authoritative source: Confluence — Data Model v6
// https://awamer.atlassian.net/wiki/spaces/.../Data+Model
//
// IMPORTANT POLICY — Derived statistics:
// The following values are ALWAYS computed from relationships at query
// time and MUST NOT be added as stored columns on Path or Course:
//   - lessonCount
//   - sectionCount
//   - courseCount (on Path)
//   - totalDurationMinutes
//   - projectCount
// This policy is enforced by convention and code review.
// ========================================================================
```

### 1.2 Required enums

Check whether each of these already exists in the current schema (under any name). If not, add them. Match whatever naming convention the existing schema uses:

- `MarketingOwnerType` — values: `PATH`, `COURSE`
- `TestimonialStatus` — `PENDING`, `APPROVED`, `HIDDEN`
- `CourseEnrollmentStatus` — `ACTIVE`, `COMPLETED`, `DROPPED` (if a generic `EnrollmentStatus` is not already defined and reusable)
- `CertificateType` — `PATH`, `COURSE`
- `CourseLevel` — `BEGINNER`, `INTERMEDIATE`, `ADVANCED` (nullable on Course)
- `TagStatus` — `ACTIVE`, `HIDDEN`

### 1.3 Modify existing entity: Path

Add the following fields:

| Field | Type | Notes |
|---|---|---|
| `subtitle` | `String?` | Nullable, up to ~200 chars |
| `promoVideoUrl` | `String?` | Nullable |
| `promoVideoThumbnail` | `String?` | Nullable |
| `isNew` | `Boolean` | `@default(false)` |
| `skills` | `Json` | `@default("[]")` — flexible-length array of strings |

**Remove** any stored `courseCount` field on Path if one exists.

### 1.4 Modify existing entity: Course (significant change)

| Field | Type | Notes |
|---|---|---|
| `slug` | `String` | Required, `@unique` |
| `categoryId` | `String` | **Required** now, FK to Category |
| `category` | `Category` | `@relation(fields: [categoryId], references: [id])` |
| `pathId` | `String?` | **Nullable** now (was required) |
| `path` | `Path?` | Nullable relation |
| `order` | `Int?` | **Nullable** now (only set when `pathId` is set) |
| `subtitle` | `String?` | Nullable |
| `level` | `CourseLevel?` | Nullable |
| `thumbnail` | `String?` | Nullable |
| `isNew` | `Boolean` | `@default(false)` |
| `skills` | `Json` | `@default("[]")` |

**Notes:**
- The schema must be able to express "a Course with no path, attached directly to a Category" (a standalone course)
- The schema alone cannot enforce "if `pathId` is null then `order` must also be null". This is a service-layer rule. But the seed and tests must respect it.

### 1.5 Modify existing entity: Category

Add the new reverse relation:

```prisma
model Category {
  // ... existing fields
  paths   Path[]
  courses Course[]   // new
}
```

### 1.6 Modify existing entity: Section

Add:

| Field | Type | Notes |
|---|---|---|
| `description` | `String?` | Nullable |

### 1.7 New entity: Tag

```prisma
model Tag {
  id        String     @id @default(uuid())
  name      String
  slug      String     @unique
  status    TagStatus  @default(ACTIVE)
  createdAt DateTime   @default(now())

  paths     PathTag[]
  courses   CourseTag[]

  @@index([status])
}
```

### 1.8 New entity: PathTag (pivot)

```prisma
model PathTag {
  pathId String
  tagId  String
  path   Path @relation(fields: [pathId], references: [id], onDelete: Cascade)
  tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([pathId, tagId])
  @@index([tagId])
}
```

### 1.9 New entity: CourseTag (pivot)

```prisma
model CourseTag {
  courseId String
  tagId    String
  course   Course @relation(fields: [courseId], references: [id], onDelete: Cascade)
  tag      Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([courseId, tagId])
  @@index([tagId])
}
```

Add the reverse relations on Path (`tags PathTag[]`) and Course (`tags CourseTag[]`).

### 1.10 New entity: Feature (polymorphic)

```prisma
model Feature {
  id          String              @id @default(uuid())
  ownerType   MarketingOwnerType
  ownerId     String
  icon        String
  title       String
  description String              @db.Text
  order       Int                 @default(0)

  @@index([ownerType, ownerId])
}
```

**Important note:** there is no `@relation` block between Feature and the polymorphic owner. The integrity of `ownerId` (i.e. that the referenced Path or Course actually exists) is enforced in a later service-layer ticket (KAN-72), not in the schema.

### 1.11 New entity: Faq (polymorphic)

```prisma
model Faq {
  id        String              @id @default(uuid())
  ownerType MarketingOwnerType
  ownerId   String
  question  String              @db.Text
  answer    String              @db.Text
  order     Int                 @default(0)

  @@index([ownerType, ownerId])
}
```

### 1.12 New entity: Testimonial (polymorphic + moderation)

```prisma
model Testimonial {
  id          String              @id @default(uuid())
  ownerType   MarketingOwnerType
  ownerId     String
  authorName  String
  authorTitle String?
  avatarUrl   String?
  content     String              @db.Text
  rating      Int?
  status      TestimonialStatus   @default(PENDING)
  order       Int                 @default(0)
  createdAt   DateTime            @default(now())

  @@index([ownerType, ownerId])
  @@index([status])
}
```

### 1.13 New entity: CourseEnrollment

```prisma
model CourseEnrollment {
  id         String                  @id @default(uuid())
  userId     String
  courseId   String
  status     CourseEnrollmentStatus  @default(ACTIVE)
  enrolledAt DateTime                @default(now())

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@unique([userId, courseId])
  @@index([userId])
  @@index([courseId])
}
```

Add the reverse relations on User (`courseEnrollments CourseEnrollment[]`) and on Course (`enrollments CourseEnrollment[]`).

### 1.14 Modify existing entity: Certificate (generalize for dual-level)

| Field | Change |
|---|---|
| `pathId` | Make it `String?` (nullable) |
| `path` | Make the relation `Path?` |
| `courseId` | **New** — `String?` |
| `course` | **New** — `Course?` relation |
| `type` | **New** — `CertificateType` |

Remove any existing `@@unique([userId, pathId])` — we will rebuild unique constraints via partial indexes in raw SQL (Part 2).

Add `@@index([userId])` and `@@index([type])`.

### 1.15 Modify existing entity: LastPosition

| Field | Change |
|---|---|
| `pathId` | Make it `String?` (nullable) |
| `path` | Make the relation `Path?` |
| `courseId` | **New** — `String?` |
| `course` | **New** — `Course?` relation |

Remove any existing `@@unique([userId, pathId])` — we'll rebuild it as a partial index in raw SQL.

Add `@@index([userId])`.

---

## Part 2 — Manual migration SQL

After running `npx prisma migrate dev --create-only --name v6_path_course_pages_alignment`, the generated `migration.sql` must be hand-edited to add the constraints below (the Prisma DSL cannot express them).

### 2.1 CHECK constraints for "exactly one of"

Append this to the bottom of the generated `migration.sql`:

```sql
-- KAN-70: Certificate must point to exactly one of pathId or courseId,
-- and the type discriminator must match the populated column.
ALTER TABLE "Certificate"
  ADD CONSTRAINT "Certificate_exactly_one_target"
  CHECK (
    ("pathId" IS NOT NULL AND "courseId" IS NULL AND "type" = 'PATH')
    OR
    ("pathId" IS NULL AND "courseId" IS NOT NULL AND "type" = 'COURSE')
  );

-- KAN-70: LastPosition must be scoped to exactly one of pathId or courseId.
ALTER TABLE "LastPosition"
  ADD CONSTRAINT "LastPosition_exactly_one_scope"
  CHECK (
    ("pathId" IS NOT NULL AND "courseId" IS NULL)
    OR
    ("pathId" IS NULL AND "courseId" IS NOT NULL)
  );
```

### 2.2 Partial unique indexes

```sql
-- KAN-70: a user may have at most one path-level certificate per path.
CREATE UNIQUE INDEX "Certificate_user_path_unique"
  ON "Certificate" ("userId", "pathId")
  WHERE "pathId" IS NOT NULL;

-- KAN-70: a user may have at most one course-level certificate per course.
CREATE UNIQUE INDEX "Certificate_user_course_unique"
  ON "Certificate" ("userId", "courseId")
  WHERE "courseId" IS NOT NULL;

-- KAN-70: a user may have at most one LastPosition per path enrollment.
CREATE UNIQUE INDEX "LastPosition_user_path_unique"
  ON "LastPosition" ("userId", "pathId")
  WHERE "pathId" IS NOT NULL;

-- KAN-70: a user may have at most one LastPosition per standalone course enrollment.
CREATE UNIQUE INDEX "LastPosition_user_course_unique"
  ON "LastPosition" ("userId", "courseId")
  WHERE "courseId" IS NOT NULL;
```

### 2.3 Migration apply steps

```bash
# 1. Edit schema.prisma
# 2. Generate the migration without applying
npx prisma migrate dev --create-only --name v6_path_course_pages_alignment

# 3. Open prisma/migrations/<timestamp>_v6_path_course_pages_alignment/migration.sql
#    Append the SQL from sections 2.1 and 2.2 to the bottom

# 4. Apply the edited migration
npx prisma migrate dev

# 5. Refresh the Prisma Client
npx prisma generate
```

---

## Part 3 — Seed script

Rewrite `prisma/seed.ts` so it produces data covering **every** new capability. The goal is not realistic marketing copy — it is correctly-shaped data that downstream tickets and tests can rely on.

### 3.1 Mandatory seed contents

#### Categories (≥ 2)

At least two, with realistic-looking but placeholder Arabic names. English slugs:
- `الذكاء الاصطناعي` / `ai`
- `تطوير البرمجيات` / `software-development`

#### Tags (≥ 5)

At least five:
- `ذكاء صناعي` / `ai`
- `تطوير منتجات` / `product-dev`
- `تجربة مستخدم` / `ux`
- `أمن سيبراني` / `cybersecurity`
- `تعلم آلي` / `ml`

#### Subscription plans

Create (or preserve) the existing plans: `free`, `monthly`, `quarterly`, `yearly`. These are not part of the v6 changes, but they are required for a coherent seed.

#### At least one fully-populated Path

A published Path (`status = PUBLISHED`) under the first category, containing:
- A non-null `subtitle`
- Non-null `promoVideoUrl` and `promoVideoThumbnail`
- `isNew = true`
- A `skills` array with at least 4 strings
- **At least 3 tags** attached via PathTag
- **At least 3 Features** (`ownerType = PATH`, `ownerId = <path.id>`, ordered)
- **At least 3 Faqs** in the same shape
- **At least 3 Testimonials** distributed as follows:
  - Exactly one with `status = PENDING`
  - Exactly one with `status = HIDDEN`
  - The rest with `status = APPROVED`
  - This distribution is what lets the moderation filter be tested
- **At least 2 courses** inside it, each with:
  - `pathId = <path.id>`
  - `order` set (1 and 2)
  - `categoryId` set
  - Unique `slug`
  - At least 2 sections, each containing at least 2 lessons
  - At least one lesson with `isFree = true`, the rest paid

#### At least one Standalone Course

A published course with `pathId = null` and `order = null`, containing:
- A non-null `categoryId`
- A unique `slug`
- A non-null `subtitle`
- `level = INTERMEDIATE` (for example)
- `isNew = true`
- A `skills` array with at least 3 strings
- **At least 2 tags** via CourseTag
- **At least 2 Features** (`ownerType = COURSE`)
- **At least 2 Faqs**
- **At least 2 Testimonials** (at least one `APPROVED`)
- At least 1 section with at least 2 lessons

#### Users (≥ 2)

- **User 1:** learner enrolled in the Path via PathEnrollment, with:
  - Several LessonProgress rows showing partial progress
  - SectionProgress, CourseProgress, and PathProgress rows that are consistent with the LessonProgress
  - A LastPosition with `pathId` set
- **User 2:** learner enrolled in the standalone course via CourseEnrollment, with:
  - Partial LessonProgress
  - A LastPosition with `courseId` set
  - At least one Certificate of `type = COURSE` (`courseId` set, `pathId = null`, `type = COURSE`) — this proves course-level certificate issuance is possible

### 3.2 Idempotency

**Running `npm run seed` twice in a row must produce the same final state with no unique-constraint errors.** Recommended approaches:

- Wrap everything in a `prisma.$transaction` that starts with a targeted cleanup of the test fixtures (delete rows that match known fixture IDs)
- Or use `upsert` everywhere with a stable `where` clause based on slug or composite key

### 3.3 Implementation notes

- All Arabic strings must be saved as UTF-8 without BOM
- Use stable, human-readable IDs in test fixtures (e.g. `seed-path-1`, `seed-course-standalone-1`) so test assertions are easy to write
- Verify that `package.json` contains:
  ```json
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
  ```
  and:
  ```json
  "scripts": {
    "seed": "prisma db seed"
  }
  ```

---

## Part 4 — Integration tests

### 4.1 Test location and structure

```
test/
└── schema/
    ├── setup.ts                    # DB setup helper for the test suite
    ├── jest.config.js              # (only if no unified config exists)
    ├── category-path.spec.ts
    ├── course.spec.ts
    ├── tag.spec.ts
    ├── marketing-content.spec.ts
    ├── enrollment.spec.ts
    ├── certificate.spec.ts
    ├── last-position.spec.ts
    └── seed.spec.ts
```

### 4.2 setup.ts — requirements

- Reads `DATABASE_URL_TEST` from the environment, or derives a URL from `DATABASE_URL` by appending a `_test` suffix to the database name
- Runs `prisma migrate deploy` against the test DB before the suite (in `globalSetup`)
- Provides a helper to truncate all tables between test cases (TRUNCATE ... CASCADE)
- Exports a Prisma client configured with `DATABASE_URL_TEST`

### 4.3 npm script

Add to `package.json`:

```json
"scripts": {
  "test:schema": "jest --config test/schema/jest.config.js"
}
```

Or merge this into the existing unified Jest config if that is simpler.

### 4.4 Docker Compose

Verify that `docker-compose.yml` contains a postgres service. If not, add one. Make sure the test DB can be created easily (e.g. via an `npm run db:test:reset` script).

### 4.5 Required tests

#### `category-path.spec.ts`

- ✅ A Path can be created referencing an existing Category
- ✅ A Path cannot be created with a missing or invalid `categoryId` (Prisma throws an FK error)
- ✅ The new fields (`subtitle`, `promoVideoUrl`, `promoVideoThumbnail`, `isNew`, `skills`) round-trip correctly through `create` then `findUnique`
- ✅ `skills` JSONB accepts arrays of varying length (3, 5, 10) and returns them as arrays
- ✅ `skills` preserves element order and Arabic characters

#### `course.spec.ts`

- ✅ A Course can be created with `categoryId` set and `pathId = null` and `order = null` (standalone)
- ✅ A Course can be created with both `categoryId` and `pathId` set, with a non-null `order`
- ✅ A Course cannot be created without a `categoryId`
- ✅ `slug` is globally unique — attempting to create a second course with the same slug throws a unique-constraint error
- ✅ Updating `pathId` to null (detaching from a path) succeeds
- ✅ Updating `pathId` from one path to another succeeds
- ✅ The new fields (`subtitle`, `level`, `thumbnail`, `isNew`, `skills`) round-trip correctly

#### `tag.spec.ts`

- ✅ A Tag can be created with a unique slug
- ✅ The same Tag can be linked to multiple Paths via PathTag
- ✅ The same Tag can be linked to multiple Courses via CourseTag
- ✅ Linking the same `(pathId, tagId)` twice throws an error
- ✅ Linking the same `(courseId, tagId)` twice throws an error
- ✅ Deleting a Tag cascades to its PathTag/CourseTag rows

#### `marketing-content.spec.ts`

- ✅ A Feature can be created with `ownerType = PATH` and `ownerId = <valid path id>`
- ✅ A Feature can be created with `ownerType = COURSE` and `ownerId = <valid course id>`
- ✅ Same for Faq and Testimonial
- ✅ A Testimonial with `status = PENDING` exists in the DB but a query filtering for `status = APPROVED` does not return it
- ✅ Features/Faqs/Testimonials can be queried ordered by the `order` field
- ✅ The index on `(ownerType, ownerId)` exists (verifiable via a `pg_indexes` query)

#### `enrollment.spec.ts`

- ✅ A PathEnrollment can be created for a `(userId, pathId)` pair
- ✅ A CourseEnrollment can be created for a `(userId, courseId)` pair
- ✅ The same user can have a PathEnrollment for path A and a CourseEnrollment for course B simultaneously
- ✅ Attempting to create a second PathEnrollment for the same `(userId, pathId)` throws a unique error
- ✅ Attempting to create a second CourseEnrollment for the same `(userId, courseId)` throws a unique error

#### `certificate.spec.ts`

- ✅ A Certificate can be created with `type = PATH`, `pathId` set, and `courseId = null`
- ✅ A Certificate can be created with `type = COURSE`, `courseId` set, and `pathId = null`
- ✅ A user can hold both types simultaneously
- ✅ Attempting to create a certificate with both `pathId` and `courseId` set throws a CHECK constraint error
- ✅ Attempting to create a certificate with `pathId = null` and `courseId = null` throws a CHECK constraint error
- ✅ Attempting to create a certificate with `type = PATH` but `courseId` set (mismatch) throws a CHECK constraint error
- ✅ Attempting to create a second certificate with the same `(userId, pathId, type=PATH)` throws a unique error
- ✅ Attempting to create a second certificate with the same `(userId, courseId, type=COURSE)` throws a unique error

#### `last-position.spec.ts`

- ✅ A LastPosition can be created with `pathId` set and `courseId = null`
- ✅ A LastPosition can be created with `courseId` set and `pathId = null`
- ✅ Attempting to create a LastPosition with both set throws a CHECK constraint error
- ✅ Attempting to create a LastPosition with neither set throws a CHECK constraint error
- ✅ A user has at most one LastPosition per path (partial unique)
- ✅ A user has at most one LastPosition per standalone course (partial unique)
- ✅ Updating `lessonId` on an existing LastPosition via upsert succeeds

#### `seed.spec.ts`

- ✅ After running the seed, querying the first Path with all relations included (`courses`, `tags`, `features`, `faqs`, `testimonials`) returns all fields and all relationships fully populated
- ✅ After running the seed, querying testimonials for the path with `where: { status: APPROVED }` returns only the approved ones
- ✅ After running the seed, the standalone course exists with `pathId = null` and all marketing content
- ✅ After running the seed, at least one course-level certificate exists
- ✅ Running the seed twice in a row without dropping data produces the same row counts in every table (idempotency)

---

## Part 5 — Documentation

### 5.1 `prisma/MIGRATION_NOTES.md`

Create this file with the following content:

```markdown
# Migration: v6_path_course_pages_alignment

**Jira:** KAN-70
**Date:** <auto>
**Authoritative spec:** Confluence — Data Model v6

## What changed

- `Course` now has a mandatory `categoryId` and an optional `pathId`. Standalone courses are supported.
- `Course` now has a unique `slug` and the new fields: `subtitle`, `level`, `thumbnail`, `isNew`, `skills` (JSONB).
- `Path` has new fields: `subtitle`, `promoVideoUrl`, `promoVideoThumbnail`, `isNew`, `skills` (JSONB).
- `Section` has a new optional `description` field.
- New taxonomy entity `Tag` with many-to-many pivots `PathTag` and `CourseTag`.
- New polymorphic marketing content entities: `Feature`, `Faq`, `Testimonial` (each with `ownerType` enum + `ownerId`).
- New `CourseEnrollment` entity for standalone courses.
- `Certificate` generalized to support both path-level and course-level certificates via `type` discriminator + nullable `pathId`/`courseId` + CHECK constraint + partial unique indexes.
- `LastPosition` generalized to support both path enrollments and standalone course enrollments.
- Derived statistics (lessonCount, courseCount, etc.) are NEVER stored — they are computed at query time.

## Manually-added SQL

The following constraints were added by hand to the generated `migration.sql` because the Prisma DSL cannot express them:

- `Certificate_exactly_one_target` CHECK constraint
- `LastPosition_exactly_one_scope` CHECK constraint
- `Certificate_user_path_unique` partial unique index
- `Certificate_user_course_unique` partial unique index
- `LastPosition_user_path_unique` partial unique index
- `LastPosition_user_course_unique` partial unique index

If a future migration regenerates these tables, these constraints must be re-added.

## How to apply locally

\`\`\`bash
npx prisma migrate deploy
npx prisma generate
npm run seed
\`\`\`

## How to verify

\`\`\`bash
npm run test:schema
\`\`\`

All tests must pass. Open Prisma Studio (`npx prisma studio`) to visually confirm the new entities and relationships.

## Service-layer invariants (NOT enforced by the schema)

The schema deliberately does NOT enforce the following — they live in services that come in later tickets:

- The polymorphic `ownerId` on Feature/Faq/Testimonial actually points to an existing Path or Course
- A `CourseEnrollment` is only created for courses with `pathId = null` (the schema does not block creating one for a path-attached course)
- Course `order` is only set when `pathId` is set
```

### 5.2 README

Add a short section to `README.md` (or the main docs) under "Database":

```markdown
## Database migrations

The Prisma schema is driven by the Awamer Data Model on Confluence. For details on the most recent schema changes, see [`prisma/MIGRATION_NOTES.md`](./prisma/MIGRATION_NOTES.md).
```

---

## Part 6 — Definition of Done

The ticket is not closed until **all** of the following are verified on a clean machine (use a fresh container or drop + recreate the DB):

1. ✅ `npm install` succeeds
2. ✅ `npx prisma validate` — zero warnings
3. ✅ `npx prisma migrate deploy` applies the new migration to an empty DB without errors
4. ✅ `npx prisma generate` succeeds
5. ✅ `npm run seed` populates the DB, then running it a second time also succeeds with no errors (idempotency)
6. ✅ `npm run test:schema` shows every test green
7. ✅ `npx prisma studio` shows all the new entities (Tag, PathTag, CourseTag, Feature, Faq, Testimonial, CourseEnrollment) with their relationships
8. ✅ `prisma/MIGRATION_NOTES.md` exists and is accurate
9. ✅ No file under `src/` was touched
10. ✅ A PR is open referencing KAN-70 and summarizing the changes

---

## Part 7 — General rules and escape hatches

- **On ambiguity:** consult Data Model v6 on Confluence (link at the top of this file). If the ambiguity persists, stop and ask the human operator — do not guess
- **Do not add entities or fields not requested by this file**
- **Do not touch any file under `src/`**
- **Do not modify `package.json` dependencies** unless you absolutely need to add a single dev-dependency for tests (e.g. `@testcontainers/postgresql` if necessary) — and even then, justify it in the PR
- **Do not modify CI/CD configs**
- **When the existing schema differs from what this file assumes:** the very first task is to read the current `schema.prisma` and compare it against the v6 target. If you find unexpected differences, document them in MIGRATION_NOTES.md and proceed without deleting anything not explicitly marked for removal
- **Use the existing schema's naming conventions** (camelCase, or snake_case via `@@map`). Do not introduce a second style
