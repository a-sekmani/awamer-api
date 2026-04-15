# Schema — Course changes (v6)

> **Source:** `prisma/schema.prisma` (`Course`)
> **Migration:** `20260414145648_v6_path_course_pages_alignment`

The v6 reshape turned `Course` from a "child of Path" into a
first-class resource that can live on its own. This document is a
narrow summary of what changed and why — the `Course` model as a whole
is the same concept, not a new entity.

---

## 1. The final shape

```prisma
model Course {
  id          String       @id @default(uuid())
  categoryId  String
  pathId      String?
  slug        String       @unique
  title       String
  subtitle    String?
  description String?
  level       CourseLevel?
  thumbnail   String?
  isNew       Boolean      @default(false)
  skills      Json         @default("[]")
  order       Int?
  isFree      Boolean      @default(false) @map("is_free")
  status      CourseStatus @default(DRAFT)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  category       Category           @relation(fields: [categoryId], references: [id])
  path           Path?              @relation(fields: [pathId], references: [id], onDelete: Cascade)
  sections       Section[]
  quizzes        Quiz[]
  courseProgress CourseProgress[]
  lastPositions  LastPosition[]
  projects       Project[]
  tags           CourseTag[]
  enrollments    CourseEnrollment[]
  certificates   Certificate[]

  @@index([pathId])
  @@index([categoryId])
  @@map("courses")
}
```

---

## 2. What changed in v6

### 2.1 `pathId` is now nullable

Before v6, every course belonged to a path. After v6, a course with
`pathId = NULL` is a **standalone course**: it has its own category,
its own enrollment row (`CourseEnrollment`), its own certificate
issuance path, and its own public discovery page at `/courses/:slug`.

The `Path?` relation has `onDelete: Cascade` — deleting a path still
cascades to its courses. Standalone courses are orthogonal to that
cascade; they have no parent to cascade from.

### 2.2 `categoryId` was added (non-null)

Every course is now directly attached to a `Category`, independently
of whether it has a path. A path-owned course's `categoryId` may or
may not match `path.categoryId` — the two columns are not constrained
to agree. Admin tooling should keep them in sync when a course is
moved.

### 2.3 `slug` was added (non-null, unique)

`courses.slug` is now a unique URL identifier, matching the
pre-existing `paths.slug`. `GET /api/v1/courses/:slug` is powered by
this column. Slugs are generated at create time and are not
auto-updated when the title changes — the frontend treats the slug as
stable.

### 2.4 `level` was added (nullable, `CourseLevel` enum)

```prisma
enum CourseLevel {
  BEGINNER     @map("beginner")
  INTERMEDIATE @map("intermediate")
  ADVANCED     @map("advanced")

  @@map("course_level")
}
```

Path-level `level` remains a plain `String?` (legacy). Course-level
`level` is the enum above. The discrepancy is resolved in
`path-mapper.ts` / `course-mapper.ts` via a `normalizeLevel` helper
that accepts either shape and produces the same wire format.

### 2.5 Cosmetic additions

`subtitle`, `thumbnail`, `isNew`, `skills` (JSONB default `[]`). These
are all populated by the admin UI and read by the public discovery
endpoints. None of them are indexed.

### 2.6 `order` is now nullable

Before v6, `order` was `Int @default(0)`. After v6, it is `Int?` with
no default. Standalone courses do not have a natural position within a
parent — `order` only makes sense for path-owned courses. Leaving it
nullable signals "unsorted" for standalone courses and is tolerated
by `course-mapper.ts`.

---

## 3. Invariants the service layer enforces

The schema allows shapes the business rules forbid:

| Shape | Allowed by schema? | Allowed by services? |
|-------|---------------------|-----------------------|
| `pathId NULL` + `categoryId` set | yes | yes — standalone course |
| `pathId` set + `categoryId` set | yes | yes — path-owned course |
| `pathId NULL` + `categoryId NULL` | no (categoryId is NOT NULL) | N/A |
| Duplicate `slug` | no (unique) | N/A |
| Course with rows in both `path_enrollments` (via parent path) and `course_enrollments` | yes | no — `EnrollmentService` rejects a standalone enroll on a path-owned course and a path enroll has no effect on `course_enrollments` |

The last row is the critical one: **course enrollment storage depends
on `course.pathId`, not on user choice.** Every enrollment-related
query must resolve `course.pathId` first and then pick the right
table.

---

## 4. Affected indexes

- `courses.slug` — UNIQUE (new, enforces the public URL).
- `courses.categoryId` — non-unique (new, supports the categories
  discovery query).
- `courses.pathId` — non-unique (pre-existing).

---

## 5. Things NOT to change without coordination

- The nullability of `pathId`. Flipping it back to `NOT NULL` would
  require every standalone course to get an artificial parent path
  and break the discovery endpoint at `/api/v1/courses/:slug`.
- The `courses.slug` unique constraint.
- The nullability of `order`. Assigning a default would misreport the
  position of unsorted standalone courses.
- The loose coupling between `course.categoryId` and
  `path.categoryId` for path-owned courses. Enforcing them to agree
  at the DB level would require a CHECK constraint across tables;
  the project handles this in the admin UI instead.
