# Prisma Schema Conventions — Backend Reference (awamer-api)

Source: `prisma/schema.prisma`. This document captures the naming,
mapping, and structural conventions the schema follows so new models and
migrations stay consistent.

---

## 1. Field names — camelCase in Prisma, camelCase in DB (with exceptions)

Prisma fields are declared in camelCase. Most are mapped 1:1 to
camelCase columns in PostgreSQL (Prisma's default). A small number of
legacy columns are mapped to snake_case via `@map("...")`:

```prisma
model Path {
  isFree  Boolean  @default(false)  @map("is_free")
  // ...
}

model Course {
  isFree  Boolean  @default(false)  @map("is_free")
  // ...
}

model Lesson {
  isFree  Boolean  @default(false)  @map("is_free")
  // ...
}
```

These three `is_free` columns are the **only** fields that are renamed
between Prisma and the DB. Everything else (`createdAt`, `updatedAt`,
`pathId`, `categoryId`, `onboardingCompleted`, …) uses the same
identifier on both sides.

> Do not add new snake_case column mappings. The `is_free` three are
> tech debt from the original v4 migration and are kept only to avoid a
> pointless rename.

---

## 2. Model names — PascalCase in Prisma, `snake_case_plural` in DB

Every model declares an `@@map("...")` so the physical table name is
snake_case plural:

```prisma
model Course            → @@map("courses")
model Path              → @@map("paths")
model CourseEnrollment  → @@map("course_enrollments")
model PathTag           → @@map("path_tags")
model LessonContentBlock → @@map("lesson_content_blocks")
```

The plural form is the rule even for join tables (`path_tags`,
`course_tags`, `user_roles`). This is the only place the project uses
plural names — service classes, DTOs, and URL paths all use singular
forms.

---

## 3. Enums — PascalCase type, UPPERCASE values, `snake_case` DB names

Every enum follows a three-layer pattern:

```prisma
enum TagStatus {
  ACTIVE @map("active")
  HIDDEN @map("hidden")

  @@map("tag_status")
}
```

| Layer | Form | Example |
|-------|------|---------|
| Prisma type name | `PascalCase` | `TagStatus` |
| Prisma value | `UPPERCASE_SNAKE` | `ACTIVE`, `NOT_STARTED` |
| DB enum type name | `snake_case` via `@@map` | `tag_status` |
| DB enum value | `lowercase_snake` via `@map` | `active`, `not_started` |

This split means application code reads/writes uppercase enum values
(`status: TagStatus.ACTIVE`) but the physical PostgreSQL enum stores
them lowercase. The mapping is transparent at runtime; the only place
you see it is in raw SQL migrations (`CREATE TYPE "tag_status" AS
ENUM ('active', 'hidden')`).

> Never add an enum value without its `@map(...)`. Prisma will work
> without one and default to the uppercase form, breaking the
> lowercase DB convention and making the next migration a mess.

---

## 4. Primary keys — UUIDs, `@default(uuid())`

Every model has:

```prisma
id String @id @default(uuid())
```

Two exceptions are composite-key join tables:

```prisma
model PathTag {
  pathId String
  tagId  String
  @@id([pathId, tagId])
}

model CourseTag {
  courseId String
  tagId    String
  @@id([courseId, tagId])
}
```

No model uses an integer `serial` PK. Do not introduce one.

---

## 5. Timestamps — `createdAt` + `updatedAt`

Almost every model carries:

```prisma
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

Exceptions, and why:

- `PathTag`, `CourseTag` — join tables, pure relationships, no audit
  fields.
- `Tag`, `Feature`, `Faq` — only `createdAt`; these rows are rewritten
  in bulk (reorder, replace-associations) and a meaningful `updatedAt`
  is not worth the overhead.
- `Testimonial` — only `createdAt` (for the same reason) but it carries
  a `status` field that gives the equivalent signal.
- `CourseEnrollment` — only `enrolledAt`; this row is never mutated
  after creation apart from the final status flip.

When adding a new model, include both timestamps unless you have a
specific reason not to.

---

## 6. Indexes — declared inline with `@@index`

Every foreign-key column has an index. Where a model is queried by a
composite key shape, the composite index is declared explicitly:

```prisma
model EmailVerification {
  @@index([userId])
  @@index([userId, used, expiresAt])
}

model Feature {
  @@index([ownerType, ownerId])
}

model Testimonial {
  @@index([ownerType, ownerId])
  @@index([status])
}
```

Do not add a single-column index that duplicates the prefix of a
composite index — Postgres does not use them.

---

## 7. Cascades

`onDelete: Cascade` is the default for owning relations (User → profile,
Course → sections, Path → courses, Tag ↔ join tables, etc.). The only
non-cascading relations are:

- `Course.category` — a category deletion should not orphan courses;
  the category is treated as immutable.
- `Subscription.plan` — plans are long-lived; you cannot delete a plan
  that is referenced by a subscription.

Polymorphic tables (`Feature`, `Faq`, `Testimonial`) have **no** FK to
the owner. Cleanup is handled in application code via
`MarketingCleanupHelper` — see
[../marketing/marketing-cleanup-helper.md](../marketing/marketing-cleanup-helper.md).

---

## 8. Derived statistics are not stored

The top of `schema.prisma` carries an explicit policy comment:

```
IMPORTANT POLICY — Derived statistics:
The following values are ALWAYS computed from relationships at query
time and MUST NOT be added as stored columns on Path or Course:
  - lessonCount
  - sectionCount
  - courseCount (on Path)
  - totalDurationMinutes
  - projectCount
```

Every derived stat in API responses is computed on demand by the
`path-stats.helper.ts` / `course-stats.helper.ts` helpers — see
[../content-discovery/paths/path-stats-helper.md](../content-discovery/paths/path-stats-helper.md) and
[../content-discovery/courses/course-stats-helper.md](../content-discovery/courses/course-stats-helper.md).

Adding a stored count column is an anti-pattern that the project has
already decided against.

---

## 9. Things NOT to change without coordination

- The `@@map` naming scheme (snake_case_plural). Test assertions,
  database dumps, and manual DB queries all assume it.
- The three-layer enum convention. Adding an unmapped enum value will
  land as uppercase in the DB and break every query that filters by
  status.
- The UUID primary key rule.
- The "no derived stats columns" policy.
