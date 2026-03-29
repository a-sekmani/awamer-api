# Research: Complete Prisma Schema from Data Model

**Feature**: 002-prisma-schema
**Date**: 2026-03-29

## Research Tasks

### 1. Prisma UUID Generation Strategy

**Decision**: Use `@id @default(uuid())` on all model `id` fields.
**Rationale**: Prisma 5+ natively supports `uuid()` as a default for String fields. This generates v4 UUIDs at the database level (PostgreSQL `gen_random_uuid()`). No additional extensions needed — PostgreSQL 13+ includes `gen_random_uuid()` by default.
**Alternatives considered**:
- `cuid()` — shorter but not standard UUID format; doesn't match the spec requirement for UUIDs.
- Application-level UUID generation — adds unnecessary complexity; DB-level generation is more reliable.

### 2. Cascade Delete Strategy

**Decision**: Use `onDelete: Cascade` on all content hierarchy foreign keys (Category → Path → Course → Section → Lesson → LessonContentBlock) and on user-owned records (progress, enrollments, attempts, submissions, certificates).
**Rationale**: The spec explicitly requires cascading deletes through the content hierarchy. For user data, cascade is appropriate because orphaned progress/enrollment records have no value.
**Alternatives considered**:
- `onDelete: SetNull` — would leave orphaned records with null foreign keys; violates data integrity.
- `onDelete: Restrict` — prevents parent deletion, but the spec requires cascading behavior.
- Soft deletes — not specified in the data model; adds complexity without current need.

### 3. Enum Naming Convention in Prisma

**Decision**: Use PascalCase enum names (e.g., `UserStatus`, `LessonType`) with UPPER_SNAKE_CASE values (e.g., `ACTIVE`, `IN_PROGRESS`). Map enum values to snake_case strings in the database using `@map`.
**Rationale**: Prisma convention is PascalCase for enum types. The data model uses lowercase with underscores for values (e.g., `not_started`, `in_progress`). Using `@map` preserves database-level readability while keeping TypeScript-friendly naming in the Prisma client.
**Alternatives considered**:
- Lowercase enum values in Prisma — not idiomatic TypeScript/Prisma; would cause linting issues.
- String fields instead of enums — loses DB-level validation; the data model explicitly defines enum types.

### 4. Composite Unique Constraints

**Decision**: Use `@@unique([field1, field2])` for: UserRole (userId + role), LessonProgress (userId + lessonId), SectionProgress (userId + sectionId), CourseProgress (userId + courseId), PathProgress (userId + pathId), LastPosition (userId + pathId).
**Rationale**: These entities represent per-user-per-entity state. A user should have exactly one progress record per lesson/section/course/path and one role entry per role type. Composite unique constraints enforce this at the database level.
**Alternatives considered**:
- Application-level uniqueness checks — race conditions can cause duplicates under concurrent access.
- Single-column unique on userId — would incorrectly restrict to one record per user across all entities.

### 5. `is_free` Field Naming

**Decision**: Use `is_free` as the Prisma field name with `@map("is_free")` to match database column convention, or use camelCase `isFree` in Prisma with `@map("is_free")` for the DB column.
**Rationale**: The CLAUDE.md data model uses `is_free` (snake_case). Prisma convention favors camelCase for field names. Using `isFree` in Prisma code with `@map("is_free")` for the database column gives idiomatic TypeScript while matching the documented data model's DB expectations. However, since the data model in CLAUDE.md explicitly uses `is_free` and the spec references it in snake_case, we'll keep `is_free` as the Prisma field name for direct alignment.
**Alternatives considered**:
- `isFree` with `@map("is_free")` — more TypeScript-idiomatic but diverges from the data model documentation.

### 6. Refresh Token Storage

**Decision**: Add a `refreshToken` nullable String field on the User model.
**Rationale**: The CLAUDE.md auth flow states "store refresh in DB" and "delete refresh token from DB" on logout. The simplest approach is a nullable field on User. The schema comment also mentions `RefreshToken` as a potential entity, but the auth flow description implies a single active refresh token per user stored directly on User.
**Alternatives considered**:
- Separate RefreshToken table — enables multiple sessions but adds complexity not specified in the data model.

### 7. Table Name Mapping

**Decision**: Use Prisma's `@@map()` to map PascalCase model names to snake_case table names in PostgreSQL (e.g., `model UserProfile` → `@@map("user_profiles")`).
**Rationale**: PostgreSQL convention is lowercase snake_case for table names. Prisma models use PascalCase by convention. Mapping ensures clean database naming without affecting TypeScript code.
**Alternatives considered**:
- No mapping — results in PascalCase table names in PostgreSQL, which is unconventional and requires quoting in raw SQL.