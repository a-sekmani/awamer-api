# Data Model — Public Discovery

This ticket adds **no new entities, columns, or migrations** (`prisma/schema.prisma` is frozen — KAN-26 §14). It composes data from existing models created in KAN-70 / KAN-71 / KAN-72.

## Entities consumed (read-only)

### Category (`categories` table)

```
id          String         (uuid, PK)
name        String
slug        String         (unique)
description String?
icon        String?
order       Int            (default 0)
status      CategoryStatus (active | hidden)
createdAt   DateTime
updatedAt   DateTime
```

Filter for `GET /categories`: `status = ACTIVE`. Order by `order asc`.

### Path (`paths` table)

```
id                  String     (uuid, PK)
categoryId          String     (FK → categories)
title               String
slug                String     (unique)
subtitle            String?
description         String?
level               String?    (free-form — see Decision D)
thumbnail           String?
promoVideoUrl       String?
promoVideoThumbnail String?
estimatedHours      Int?
isNew               Boolean    (default false)
skills              Json       (default [])
isFree              Boolean    (default false)
status              PathStatus (draft | published | archived)
order               Int        (default 0)
createdAt           DateTime
updatedAt           DateTime
```

Filter for `GET /paths`: `status = PUBLISHED`. Joined to: `category`, `tags` (via `path_tags`), `courses` (via `courses.pathId`).

### Course (`courses` table)

```
id          String       (uuid, PK)
categoryId  String       (FK → categories, REQUIRED)
pathId      String?      (FK → paths, NULL for standalone)
slug        String       (unique — globally)
title       String
subtitle    String?
description String?
level       CourseLevel? (BEGINNER | INTERMEDIATE | ADVANCED)
thumbnail   String?
isNew       Boolean
skills      Json
order       Int?
isFree      Boolean
status      CourseStatus (draft | published | archived)
createdAt   DateTime
updatedAt   DateTime
```

Filter for `GET /courses`: `status = PUBLISHED`. Mutually exclusive `pathId` / `standalone` filter applies.

### Section (`sections` table)

```
id          String   (uuid, PK)
courseId    String   (FK → courses)
title       String
description String?
order       Int      (default 0)
```

Always loaded as a child of Course. Order by `order asc`.

### Lesson (`lessons` table)

```
id               String     (uuid, PK)
sectionId        String     (FK → sections)
title            String
type             LessonType (text | video | interactive | mixed)
order            Int        (default 0)
isFree           Boolean    (default false)
estimatedMinutes Int?
```

Always loaded as a child of Section. Order by `order asc`. Content blocks are NOT loaded by these endpoints.

### Tag (`tags` table) + join tables (`path_tags`, `course_tags`)

Read via existing `TagsService.listPublic` for `GET /tags` (already wired). For path/course detail, joined inline via `Prisma.include.tags.tag`. Order by `tag.name asc`.

### Feature, Faq, Testimonial (marketing tables)

Read via existing `PublicMarketingQueries`. Scoped by `(ownerType, ownerId)`. Three separate methods called in parallel via `Promise.all` — see Decision B.

### Project (`projects` table)

Counted via `_count: { select: { projects: true } }` on Course, summed across courses for `Path.stats.projectCount`.

## Derived (response-only) shapes

### `pathStats`

```
courseCount          = path.courses.filter(c => c.status === PUBLISHED).length
lessonCount          = sum(course.sections[].lessons[].length)
totalDurationMinutes = sum(course.sections[].lessons[].estimatedMinutes ?? 0)
projectCount         = sum(course._count.projects)
```

### `courseStats`

```
sectionCount         = course.sections.length
lessonCount          = sum(course.sections[].lessons.length)
totalDurationMinutes = sum(course.sections[].lessons[].estimatedMinutes ?? 0)
projectCount         = course._count.projects
```

### `normalizeLevel(value: string | null): 'beginner' | 'intermediate' | 'advanced' | null`

```
if value is null → null
const lower = value.toLowerCase()
return ['beginner','intermediate','advanced'].includes(lower) ? lower : null
```

## Indexes relied upon

Existing single-column indexes are sufficient for the MVP cold-cache budget (Decision C):

- `paths.slug @unique`
- `paths.categoryId @@index`
- `courses.slug @unique`
- `courses.pathId @@index`
- `courses.categoryId @@index`
- `sections.courseId @@index`
- `lessons.sectionId @@index`

Composite indexes `[pathId, status, order]` on Course and `[status, order]` on Path are deferred (see Known Limitation #1).

## No new entities, no new migrations, no schema diff

`git diff master prisma/` MUST be empty at the end of this ticket.
