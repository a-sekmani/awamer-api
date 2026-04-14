# Data Model — Tags Module (KAN-71)

This ticket **does not modify `prisma/schema.prisma`**. All entities below already exist as of KAN-70. The document below captures the subset of the schema that `TagsService` and `ReplaceTagAssociationsHelper` read from and write to, expressed at the level the spec and tests care about.

## Entities

### Tag

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (UUID) | Primary key, auto-generated | Prisma `@default(uuid())` |
| `name` | `String` | 1–100 chars, not whitespace-only | Validated by DTO via `class-validator` `@Length(1,100)` + a custom `@IsNotBlank()` or `.trim()`-then-`@MinLength(1)` |
| `slug` | `String` | 1–60 chars, matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`, globally unique | DB uniqueness enforced by `@unique` on the model |
| `status` | `TagStatus` enum | `ACTIVE` \| `HIDDEN`, defaults to `ACTIVE` | No `DRAFT` / `ARCHIVED` state |
| `createdAt` | `DateTime` | Auto-set on create, never updated | No `updatedAt` field on the model (intentional per Data Model v6) |

**Relationships**:
- `paths`: `PathTag[]` (many-to-many through pivot) — cascade delete on `Tag` removal
- `courses`: `CourseTag[]` (many-to-many through pivot) — cascade delete on `Tag` removal

**State transitions**:
- `(none)` → `ACTIVE` (create default)
- `(none)` → `HIDDEN` (create with explicit status)
- `ACTIVE` ↔ `HIDDEN` (admin update)
- `* → (deleted)` (admin delete; cascades pivot rows)

No other transitions exist. There is no soft-delete.

---

### PathTag (pivot)

| Field | Type | Constraints |
|---|---|---|
| `pathId` | `String` (UUID) | FK → `Path.id`, cascade on path delete |
| `tagId` | `String` (UUID) | FK → `Tag.id`, cascade on tag delete |

**Composite primary key**: `(pathId, tagId)` — ensures a given path-tag pair exists at most once.
**Index**: `(tagId)` for reverse lookups (`tag → paths`).

No other columns. No audit fields. No nullable fields.

---

### CourseTag (pivot)

| Field | Type | Constraints |
|---|---|---|
| `courseId` | `String` (UUID) | FK → `Course.id`, cascade on course delete |
| `tagId` | `String` (UUID) | FK → `Tag.id`, cascade on tag delete |

**Composite primary key**: `(courseId, tagId)` — ensures a given course-tag pair exists at most once.
**Index**: `(tagId)` for reverse lookups.

---

### Path (read-only in this ticket)

Only two fields are relevant to `TagsService`:
- `id: String`
- `status: PathStatus` — one of `DRAFT`, `PUBLISHED`, `ARCHIVED`. Only `PUBLISHED` rows contribute to `pathCount`.

No writes to `Path` happen in this ticket.

### Course (read-only in this ticket)

Only two fields are relevant:
- `id: String`
- `status: CourseStatus` — one of `DRAFT`, `PUBLISHED`, `ARCHIVED`. Only `PUBLISHED` rows contribute to `courseCount`.

No writes to `Course` happen in this ticket.

---

## Validation rules (enforced by DTOs, not by Prisma)

These map directly to spec FR-019 / FR-020 / FR-037 and must be enforced before any Prisma call:

```
CreateTagDto {
  name:   @IsString @Length(1, 100) @Transform(trim) @IsNotBlankString()
  slug:   @IsString @Length(1, 60)  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  status: @IsOptional @IsEnum(TagStatus)   // defaults to ACTIVE on service side
}

UpdateTagDto extends PartialType(CreateTagDto) {
  // class-validator will reject empty bodies via a custom @HasAtLeastOneField() validator
  // OR the service layer throws BadRequestException when Object.keys(dto).length === 0
}
```

The "at least one field" rule (spec FR-013) is simplest to enforce in the service as a one-line guard rather than a custom validator class — keeps the decorator surface clean.

---

## Response shapes (service → controller → client)

### Public tag response (returned by `GET /api/v1/tags`)

```ts
type TagResponseDto = {
  id: string;
  name: string;
  slug: string;
  pathCount: number;
  courseCount: number;
};
```

### Admin tag response (returned by all `/api/v1/admin/tags` endpoints)

```ts
type AdminTagResponseDto = TagResponseDto & {
  status: 'ACTIVE' | 'HIDDEN';
  createdAt: string; // ISO 8601
};
```

Both shapes are wrapped by the global `ResponseTransformInterceptor` into:

```json
{ "data": [...], "message": "Success" }
```

or, for single-entity responses (create, update):

```json
{ "data": { ... }, "message": "Success" }
```

---

## Derived values (computed, never stored)

### `pathCount` for a tag

Definition: number of distinct `Path` rows with `status = PUBLISHED` that have at least one `PathTag` row linking them to the tag.

Computation: one `prisma.pathTag.groupBy` query with `where: { path: { status: PathStatus.PUBLISHED } }`, grouped `by: ['tagId']`, with `_count: { _all: true }`. Returns `{ tagId, _count }` rows which are zipped into the tag list in memory (default `0` for absent tagIds).

### `courseCount` for a tag

Symmetric to `pathCount`, using `prisma.courseTag.groupBy` with `where: { course: { status: CourseStatus.PUBLISHED } }`.

These values are recomputed on every request. No caching, no staleness, no stored counter columns.

---

## Invariants this module relies on

1. `Tag.slug` is globally unique (enforced by `@unique` in `prisma/schema.prisma`).
2. `PathTag.pathId + PathTag.tagId` is unique (enforced by composite primary key).
3. `CourseTag.courseId + CourseTag.tagId` is unique (enforced by composite primary key).
4. Deleting a `Tag` cascades to all `PathTag` and `CourseTag` rows referencing it (`onDelete: Cascade` on both relations).
5. Deleting a `Path` or `Course` cascades to its pivot rows but does NOT delete tags.
6. `TagStatus` is exactly `{ ACTIVE, HIDDEN }` — enforced by Prisma enum.

All six invariants are already in place from KAN-70 and verified by `test/schema/tag.spec.ts`. No additional schema work is needed.
