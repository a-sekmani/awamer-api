# Schema — Tag, PathTag, CourseTag

> **Source:** `prisma/schema.prisma` (`Tag`, `PathTag`, `CourseTag`)
> **Migration:** `20260414145648_v6_path_course_pages_alignment`
> **Module doc:** [../tags/README.md](../tags/README.md)

Tags are a cross-cutting taxonomy attached to both `Path` and `Course`
via independent join tables. A single `Tag` row can be associated with
any number of paths, any number of courses, or both.

---

## 1. `Tag`

```prisma
model Tag {
  id        String    @id @default(uuid())
  name      String
  slug      String    @unique
  status    TagStatus @default(ACTIVE)
  createdAt DateTime  @default(now())

  paths   PathTag[]
  courses CourseTag[]

  @@index([status])
  @@map("tags")
}
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String (uuid)` | Primary key. |
| `name` | `String` | Display name. Not unique — two tags can share a display name if they have different slugs (though current service code rejects duplicates). |
| `slug` | `String` | **Unique.** Used in public URLs / filters. Generated via `slugify(name)` in `TagsService.create`. |
| `status` | `TagStatus` | `ACTIVE` or `HIDDEN`. `HIDDEN` tags are invisible to the public list but remain attached to paths/courses. |
| `createdAt` | `DateTime` | No `updatedAt`. |

`status` is the only audit signal on a `Tag`. Tags are immutable from
the public-list perspective once `HIDDEN`.

### Indexes

- `tags.slug` — UNIQUE (declared via `@unique`).
- `tags.status` — non-unique, serves the public list query
  `{ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } }`.

---

## 2. `TagStatus`

```prisma
enum TagStatus {
  ACTIVE @map("active")
  HIDDEN @map("hidden")

  @@map("tag_status")
}
```

See [conventions.md §3](./conventions.md) for the three-layer enum
convention.

---

## 3. `PathTag` — path/tag join

```prisma
model PathTag {
  pathId String
  tagId  String

  path Path @relation(fields: [pathId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([pathId, tagId])
  @@index([tagId])
  @@map("path_tags")
}
```

- Composite primary key `(pathId, tagId)`.
- `ON DELETE CASCADE` on both FKs: deleting the path removes its tag
  links, deleting the tag removes its path links.
- `@@index([tagId])` supports the reverse query "all paths for this
  tag", which is used by the public filter `?tag=ai` on
  `GET /api/v1/paths`.

No extra columns — no `order`, no `createdAt`. Tag associations are
unordered.

---

## 4. `CourseTag` — course/tag join

```prisma
model CourseTag {
  courseId String
  tagId    String

  course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)
  tag    Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([courseId, tagId])
  @@index([tagId])
  @@map("course_tags")
}
```

Identical shape to `PathTag` with `pathId` replaced by `courseId`. The
two join tables are independent by design — a single `Tag` row is
shared across both sides, but `PathTag` and `CourseTag` have no direct
relationship.

---

## 5. Atomic association replacement

`TagsService` and `ReplaceTagAssociationsHelper` replace the full set
of tag associations for a given path or course in a single
transaction:

```
DELETE FROM path_tags  WHERE path_id  = :pathId
INSERT INTO path_tags  VALUES ...
```

This pattern is necessary because `PathTag` / `CourseTag` have a
composite PK with no auto-increment — there is nothing to "update",
only add/remove. See
[../tags/replace-tag-associations-helper.md](../tags/replace-tag-associations-helper.md).

---

## 6. Cache invalidation

Admin mutations on `Tag` always invalidate:

- `tags:public` — the public list cache key.
- `paths:list:*` — any paginated paths list that could have filtered
  by a tag.
- `courses:list:*` — any paginated courses list that could have
  filtered by a tag.

See [../cache/invalidation-flow.md](../cache/invalidation-flow.md).

---

## 7. Schema tests

| File | Asserts |
|------|---------|
| `test/schema/tag.spec.ts` | Unique `slug`, many-to-many via `PathTag` and `CourseTag`, cascade delete of a tag removes its join rows, cascade delete of a path/course removes the matching join rows, `TagStatus` defaults to `ACTIVE`. |

---

## 8. Things NOT to change without coordination

- The composite `(pathId, tagId)` / `(courseId, tagId)` primary keys —
  the replace-associations helper relies on the absence of a surrogate
  key.
- The `@@index([tagId])` reverse index — removing it would turn every
  "paths filtered by tag" query into a full scan.
- The `slug` uniqueness — the frontend treats slugs as URL segments.
- The decision to model paths and courses as independent join tables
  rather than a single polymorphic `tagged_entities` table. That
  design was considered and rejected for the sake of type safety and
  query planner friendliness.
