# Prisma Migrations — History (awamer-api)

Source: `prisma/migrations/`. Migrations are listed in execution order.
Each entry names the change and cross-references the model docs that
cover the shape in detail.

---

## 1. Execution order

| # | Directory | Purpose |
|---|-----------|---------|
| 1 | `20260329120744_init` | Baseline — every model in the v4 data model: User, UserProfile, UserRole, OnboardingResponse, Category, Path, Course, Section, Lesson, LessonContentBlock, PathEnrollment, LessonProgress, SectionProgress, CourseProgress, PathProgress, LastPosition, Certificate, Quiz, Question, Option, QuizAttempt, Project, ProjectSubmission, SubscriptionPlan, Subscription, Payment. All enums listed in `schema.prisma` up to `PaymentStatus`. |
| 2 | `20260329130229_add_password_reset_fields` | Adds `User.passwordResetToken` + `User.passwordResetExpires` for the forgot-password flow. See [../auth/forgot-password.md](../auth/forgot-password.md). |
| 3 | `20260401180957_add_email_verification` | Creates the `email_verifications` table and the `RateLimitedRequest` table + `rate_limit_type` enum. See [../auth/verify-email.md](../auth/verify-email.md). |
| 4 | `20260404200000_add_password_reset_request_tracking` | Extends `rate_limit_type` with `forgot_password` and switches forgot-password throttling from a per-row counter to the `RateLimitedRequest` table. |
| 5 | `20260405090000_add_account_lockout_fields` | Adds `User.failedLoginAttempts` and `User.lockedUntil`. See [../auth/login.md](../auth/login.md). |
| 6 | `20260405140000_hash_otp_code_varchar64` | Changes `EmailVerification.code` from `TEXT` to `VARCHAR(64)` (length of the hex SHA-256 digest). |
| 7 | `20260405143000_add_registration_ip_detected_country` | Adds `User.registrationIp` + `User.detectedCountry` for geoip audit. |
| 8 | `20260414145648_v6_path_course_pages_alignment` | **Epic E3 migration (KAN-70).** The entire content-v6 reshape in a single migration. Details below. |

`migration_lock.toml` pins the provider to PostgreSQL.

---

## 2. The v6 migration — `20260414145648_v6_path_course_pages_alignment`

One migration carries every schema change for epic E3. In order of the
raw SQL (`prisma/migrations/20260414145648_v6_path_course_pages_alignment/migration.sql`):

### 2.1 New enum types (`CREATE TYPE`)

```sql
CREATE TYPE "marketing_owner_type"    AS ENUM ('path', 'course');
CREATE TYPE "testimonial_status"      AS ENUM ('pending', 'approved', 'hidden');
CREATE TYPE "course_enrollment_status" AS ENUM ('active', 'completed', 'dropped');
CREATE TYPE "certificate_type"        AS ENUM ('path', 'course');
CREATE TYPE "course_level"            AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE "tag_status"              AS ENUM ('active', 'hidden');
```

Six new enums. **No `FeatureStatus` or `FaqStatus`** — `Feature` and
`Faq` rows have no status column.

### 2.2 Existing table alterations

- `certificates` — adds `courseId TEXT` (nullable), `type certificate_type NOT NULL`, and makes `pathId` nullable. Transforms the model from "path certificates only" to a polymorphic dual-level issuance. See [certificate-polymorphic.md](./certificate-polymorphic.md).
- `courses` — adds `categoryId TEXT NOT NULL`, `slug TEXT NOT NULL` (with a unique index), `subtitle`, `thumbnail`, `isNew`, `skills JSONB DEFAULT '[]'`, `level course_level`. Makes `pathId` and `order` nullable so a course can live without a parent path. See [course-changes.md](./course-changes.md).
- `last_positions` — makes `pathId` and `courseId` nullable so a resume position can point at a standalone course or a lesson outside any path. Drops the old `last_positions_userId_pathId_key` unique index (one `LastPosition` per user was too restrictive once courses could be standalone).
- `paths` — adds `isNew`, `promoVideoUrl`, `promoVideoThumbnail`, `skills JSONB DEFAULT '[]'`, `subtitle` to support the v6 path landing page.
- `sections` — adds `description TEXT` nullable.

### 2.3 New tables (`CREATE TABLE`)

- `tags`, `path_tags`, `course_tags` — the taxonomy introduced by KAN-71. See [tag.md](./tag.md).
- `features`, `faqs`, `testimonials` — the marketing content introduced by KAN-72. See [marketing-content.md](./marketing-content.md).
- `course_enrollments` — the standalone-course enrollment introduced by KAN-73 and used alongside the existing `path_enrollments`. See [course-enrollment.md](./course-enrollment.md).

### 2.4 Indexes

- `tags.slug` unique.
- `tags.status`, `path_tags.tagId`, `course_tags.tagId` non-unique.
- `(ownerType, ownerId)` composite on all three marketing tables.
- `testimonials.status` non-unique.
- `certificates.type` non-unique (the polymorphic discriminator).
- `course_enrollments(userId, courseId)` unique.

---

## 3. Why a single migration

The v6 reshape is a coordinated change: the new marketing tables
reference both paths and courses; the `Course` changes (categoryId,
nullable pathId) are required before the `course_enrollments` and
`certificates` changes make sense; and splitting the migration would
leave intermediate states where `courses.categoryId` is NULL and
indexes do not yet exist. One migration keeps the transition atomic.

Future migrations should prefer the opposite — one narrow migration per
conceptual change — now that the v6 baseline is in place.

---

## 4. Things NOT to change without coordination

- **Never edit an applied migration in place.** Any further schema
  change is a new migration. The `migration_lock.toml` file enforces
  that Prisma does not silently regenerate earlier ones.
- The enum names in the DB (`marketing_owner_type`, `tag_status`,
  `certificate_type`, `course_enrollment_status`, `testimonial_status`,
  `course_level`). Renaming a Postgres enum type is a multi-step
  migration; it is far easier to pick the right name up front.
