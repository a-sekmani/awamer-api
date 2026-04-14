# KAN-71 — Tags module

> **Jira:** [KAN-71](https://awamer.atlassian.net/browse/KAN-71)
> **Parent epic:** KAN-4 (E3: Public Discovery)
> **Depends on:** KAN-70 (Prisma schema v6 — done)
> **Blocks:** KAN-26 (Public discovery endpoints)
>
> **References:**
> - [Data Model v6 — Taxonomy section](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/28835841/Data+Model)
> - [API Design v2 §5.2 and §17](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/27754532/API+Design)
> - [Tech Stack v4 §6.2 ContentModule](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/29458433/Tech+Stack)

---

## 1. Goal

Deliver the Tags taxonomy capability for Awamer. Tags are a second, descriptive taxonomy that runs in parallel with the mandatory Category hierarchy. A Path or Course belongs to exactly one Category but can carry many Tags. This ticket delivers:

- A public endpoint to list active tags with usage counts
- Admin CRUD for tags
- A reusable helper for atomically replacing the tag associations of a Path or Course
- Full test coverage

The Tag, PathTag, and CourseTag Prisma models already exist (delivered by KAN-70). This ticket builds the NestJS layer on top of them.

---

## 2. Scope

### In scope

- New NestJS module `ContentModule` at `src/content/`
- Tag-related service, controllers, DTOs, and helpers inside `src/content/tags/`
- Public endpoint `GET /api/v1/tags`
- Admin endpoints for Tag CRUD
- Reusable helper `ReplaceTagAssociationsHelper` for Path/Course edit flows (future tickets will call it)
- Unit and end-to-end tests
- Registration of `ContentModule` in `AppModule`
- Short README update under the modules section

### Out of scope

- Public discovery filter UI or filtering logic by tag (KAN-26 and frontend)
- Path or Course admin endpoints themselves (only the helper they will eventually call)
- Caching infrastructure (KAN-74 — see §6 for how caching is handled)
- Any modification to `prisma/schema.prisma` or existing migrations
- Any modification to `auth`, `users`, `onboarding`, or `common` modules

---

## 3. Domain rules

### Tag entity

- A tag has a `name` (free-form Arabic text, 1–100 characters)
- A tag has a `slug` (1–60 characters, lowercase ASCII letters, digits, and hyphens only)
- A tag's slug is globally unique — no two tags can share a slug
- A tag has a `status` field with two possible values: `ACTIVE` or `HIDDEN`
- There is no draft, archived, or soft-deleted state
- A tag has a `createdAt` timestamp; there is no `updatedAt` (intentionally, per Data Model v6)

### Relationship to Path and Course

- A Path can carry zero or more tags via the `PathTag` pivot table
- A Course can carry zero or more tags via the `CourseTag` pivot table
- The same tag can be attached to many paths and many courses
- A (path, tag) pair is unique — you cannot attach the same tag twice to the same path (enforced by the schema)
- Same for (course, tag)
- Deleting a tag cascades to remove all its PathTag and CourseTag associations (enforced by the schema's `onDelete: Cascade`)
- Deleting a tag does not affect the paths or courses themselves

### Public visibility

- Only tags with `status = ACTIVE` appear in public responses
- Hidden tags remain in the database and keep their existing associations with paths and courses, but:
  - They do not appear in the public list
  - They cannot be attached to a path or course via the helper
- Admins can see all tags (active and hidden) through the admin endpoints

### Attach/detach semantics

- Attaching or detaching tags happens as a "replace the full set" operation
- The caller provides a list of tag IDs; the system replaces the existing associations with the new set atomically
- Duplicates in the input list are deduplicated silently
- If any tag ID in the input does not exist, the whole operation fails with no partial changes
- If any tag ID in the input points to a HIDDEN tag, the whole operation fails with no partial changes
- The operation runs inside a Prisma transaction

---

## 4. Endpoints

All endpoints are under the `/api/v1` prefix.

### 4.1 Public: list active tags

`GET /api/v1/tags`

- No authentication required
- Returns a list of all tags with `status = ACTIVE`, sorted alphabetically by name
- Each item in the response contains:
  - `id` (string)
  - `name` (string)
  - `slug` (string)
  - `pathCount` (integer) — number of published paths using this tag
  - `courseCount` (integer) — number of published courses using this tag
- Counts are computed from the live database, not stored
- Returns an empty array if no active tags exist (never `null`)
- Sets `Cache-Control: public, max-age=60`

### 4.2 Admin: list all tags

`GET /api/v1/admin/tags`

- Requires admin authentication
- Returns all tags regardless of status, sorted alphabetically by name
- Each item contains the same fields as the public endpoint, plus:
  - `status` (`ACTIVE` | `HIDDEN`)
  - `createdAt` (ISO 8601 timestamp)

### 4.3 Admin: create a tag

`POST /api/v1/admin/tags`

- Requires admin authentication
- Request body:
  - `name` (required, 1–100 chars, not only whitespace)
  - `slug` (required, 1–60 chars, matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`)
  - `status` (optional, defaults to `ACTIVE`)
- Returns 201 with the created tag in the admin response shape (including `pathCount: 0`, `courseCount: 0`)
- Returns 409 Conflict if the slug already exists
- Returns 400 on validation errors

### 4.4 Admin: update a tag

`PATCH /api/v1/admin/tags/:id`

- Requires admin authentication
- Request body is a partial of the create body; at least one field must be present
- Returns 200 with the updated tag
- Returns 404 if the tag does not exist
- Returns 409 if changing the slug to one already used by another tag
- Returns 400 on validation errors

### 4.5 Admin: delete a tag

`DELETE /api/v1/admin/tags/:id`

- Requires admin authentication
- Deletes the tag permanently; schema-level cascade removes all PathTag and CourseTag rows referencing it
- Returns 204 No Content
- Returns 404 if the tag does not exist

### 4.6 Error shape

All errors use NestJS's standard `HttpException` family (`NotFoundException`, `ConflictException`, `BadRequestException`, `ForbiddenException`). The existing global exception filter formats them into the project's standard error response. No custom error formats are introduced.

Specific error messages:

- Duplicate slug: `"Tag with slug 'xyz' already exists"`
- Tag not found: `"Tag 'xyz' not found"`
- Hidden tag in helper input: `"Tag 'xyz' is hidden and cannot be attached"`
- Nonexistent tag in helper input: `"Tag 'xyz' does not exist"`

---

## 5. Reusable helper

### `ReplaceTagAssociationsHelper`

Exported from `ContentModule` so future modules can import it. Exposes two methods:

```
replaceForPath(pathId: string, tagIds: string[]): Promise<void>
replaceForCourse(courseId: string, tagIds: string[]): Promise<void>
```

Both methods:

1. Deduplicate the input list (e.g. `[t1, t2, t1]` becomes `[t1, t2]`)
2. Validate that every tag ID in the deduplicated list exists and has `status = ACTIVE`
3. Throw a clear error if any tag ID is missing or hidden
4. Run a single Prisma transaction that:
   - Deletes all existing PathTag/CourseTag rows for the given owner
   - Inserts the new set of associations
5. Are idempotent — calling with the same input twice produces the same final state

This helper is exported and testable on its own. It is NOT called by any endpoint delivered in this ticket. Future Path and Course admin endpoints (KAN-26 and later) will call it.

---

## 6. Caching

KAN-74 delivers the Redis CacheModule in parallel and may or may not be merged when this ticket starts.

- **If `CacheModule` exists at implementation time:**
  - Inject `CacheService`
  - Cache `GET /api/v1/tags` response under the key `tags:public:list`
  - Invalidate this key inside `TagsService` on every admin create/update/delete
- **If `CacheModule` does not yet exist:**
  - Implement without caching
  - Add a `// TODO(KAN-74): wire CacheService here` comment at every relevant call site
  - The endpoints must still function fully without the cache

Either way, the public endpoint sets `Cache-Control: public, max-age=60` as an HTTP-level hint.

---

## 7. Authorization

Admin endpoints require an admin role. The existing `auth` module provides JWT authentication. Use whatever admin-guard pattern already exists in the project.

- If an admin guard or decorator already exists (e.g. `@AdminOnly()`, `@Roles('admin')`), reuse it
- If no admin mechanism exists yet in the project, create a placeholder guard named `AdminOnlyGuard` that allows all requests in development and logs a warning, and mark every usage with a `// TODO(auth): replace with real admin guard once implemented` comment
- Admin endpoints must never be publicly accessible by default

---

## 8. Validation

All DTOs use `class-validator` decorators, matching the conventions already used by `auth` and `onboarding` DTOs.

- `name`: `@IsString()`, `@Length(1, 100)`, trimmed, rejects whitespace-only input
- `slug`: `@IsString()`, `@Length(1, 60)`, `@Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)`
- `status`: `@IsEnum(TagStatus)`, optional on create (defaults to `ACTIVE`)

Arabic characters in `name` must round-trip correctly through create, read, update, and delete operations without any encoding issues.

---

## 9. Module structure

New files created under `src/content/`:

```
src/content/
├── content.module.ts
├── tags/
│   ├── tags.service.ts
│   ├── tags.controller.ts
│   ├── admin-tags.controller.ts
│   ├── dto/
│   │   ├── create-tag.dto.ts
│   │   ├── update-tag.dto.ts
│   │   └── tag-response.dto.ts
│   └── helpers/
│       └── replace-tag-associations.helper.ts
```

`ContentModule` is registered in `src/app.module.ts` alongside the existing modules.

Naming, file layout, and code style match the conventions already used in `src/auth` and `src/onboarding`.

---

## 10. Tests

### 10.1 Unit tests — `tags.service.spec.ts`

Against a mocked `PrismaService`:

- Service lists only active tags on the public path
- Service lists all tags on the admin path
- `pathCount` and `courseCount` are computed correctly from fixture data containing multiple paths and courses with varied tag associations (manually construct a fixture of at least 3 paths and 3 courses across 4 tags with overlapping associations)
- Service throws `ConflictException` when creating a tag with a duplicate slug (map Prisma's `P2002` error)
- Service throws `NotFoundException` when updating a tag ID that does not exist
- Service throws `NotFoundException` when deleting a tag ID that does not exist
- Service correctly handles status transitions (ACTIVE → HIDDEN and back)
- Response shape matches the contract in §4 for both public and admin endpoints

### 10.2 Unit tests — `replace-tag-associations.helper.spec.ts`

Against a mocked `PrismaService`:

- Deduplicates input (e.g. `[t1, t2, t1]` becomes `[t1, t2]`)
- Rejects input containing a nonexistent tag ID with a clear error
- Rejects input containing a hidden tag ID with a clear error
- Calls Prisma inside a transaction (verifiable via the mock)
- Deletes existing associations before inserting new ones
- Called twice with the same input, produces the same result both times (idempotent)
- Works for both paths and courses

### 10.3 End-to-end tests — `tags.controller.e2e-spec.ts`

Against the real `awamer_test` database, reusing the test harness from KAN-70 (`test/schema/setup.ts` and `test/schema/global-setup.ts`):

- `GET /api/v1/tags` returns 200 with the expected shape
- `GET /api/v1/tags` returns only active tags (verify by seeding an extra HIDDEN tag and asserting it is absent)
- `GET /api/v1/tags` returns correct `pathCount` and `courseCount` based on the existing seed fixtures
- `GET /api/v1/tags` does not require authentication
- `GET /api/v1/tags` response includes `Cache-Control: public, max-age=60` header
- `GET /api/v1/tags` returns an empty array when no active tags exist (not `null`)
- Arabic tag names round-trip correctly (use a tag with name `"ذكاء صناعي"` and assert the returned string is byte-identical)

### 10.4 End-to-end tests — `admin-tags.controller.e2e-spec.ts`

- `GET /api/v1/admin/tags` returns all tags including hidden ones
- `POST /api/v1/admin/tags` creates a tag; the new tag appears in a subsequent `GET`
- `POST /api/v1/admin/tags` returns 409 on duplicate slug
- `POST /api/v1/admin/tags` returns 400 on invalid slug format (e.g. uppercase, special characters)
- `POST /api/v1/admin/tags` returns 400 on whitespace-only name
- `POST /api/v1/admin/tags` accepts Arabic names
- `PATCH /api/v1/admin/tags/:id` updates and returns the new shape
- `PATCH /api/v1/admin/tags/:id` returns 404 on nonexistent id
- `PATCH /api/v1/admin/tags/:id` returns 409 on slug collision with another existing tag
- `PATCH /api/v1/admin/tags/:id` can change a tag from ACTIVE to HIDDEN and back
- `DELETE /api/v1/admin/tags/:id` returns 204 and the tag disappears from subsequent GETs
- `DELETE /api/v1/admin/tags/:id` cascades — after deletion, `PathTag` and `CourseTag` rows referencing the tag no longer exist (verify via a direct Prisma query)
- `DELETE /api/v1/admin/tags/:id` returns 404 on nonexistent id
- All admin endpoints reject unauthenticated requests (or log the placeholder-guard warning if no real guard exists yet)

### 10.5 End-to-end tests — `replace-tag-associations.helper.e2e-spec.ts`

Against the real test database:

- `replaceForPath` replaces a seeded path's tag set atomically
- `replaceForPath` with an empty array removes all tag associations
- `replaceForPath` with duplicates in the input produces no duplicate rows
- `replaceForPath` with a nonexistent tag ID throws and commits no changes (verify the original associations are still intact after the failure)
- `replaceForPath` with a hidden tag ID throws and commits no changes
- `replaceForCourse` behaves identically
- Calling `replaceForPath` twice with the same input produces the same database state

### 10.6 Test infrastructure

- Tests use the existing `awamer_test` database from KAN-70
- Tests reuse the helpers in `test/schema/setup.ts` (Prisma client, truncation helper)
- If a test needs fixtures beyond what the existing seed provides, it creates them inside the test file itself (never modifies `prisma/seed.ts`)
- Each test file truncates the relevant tables in `beforeEach` to stay isolated

---

## 11. Definition of Done

The ticket is not closed until all of the following are true:

1. `npm run build` succeeds with zero TypeScript errors
2. `npx prisma validate` still passes (schema is unchanged from KAN-70)
3. `npm run test:schema` is still green (KAN-70's tests are untouched)
4. `npm test` runs every test in the project — all green
5. All unit tests in §10.1 and §10.2 pass
6. All e2e tests in §10.3, §10.4, and §10.5 pass
7. `git diff prisma/schema.prisma` is empty
8. `git diff prisma/migrations/` is empty
9. `git diff src/auth src/users src/onboarding` is empty
10. `ContentModule` is registered in `src/app.module.ts`
11. Manual smoke test passes:
    - `npm run start:dev` boots cleanly
    - `curl http://localhost:3000/api/v1/tags` returns seeded tags with correct counts
    - `POST`, `PATCH`, and `DELETE` on `/api/v1/admin/tags` all work against a running instance
12. `README.md` has a short note under the modules section describing what `ContentModule` currently exposes
13. A PR is open referencing KAN-71

---

## 12. Out of scope — not to be touched

- `prisma/schema.prisma` — frozen since KAN-70
- Any file under `prisma/migrations/`
- `src/auth`, `src/users`, `src/onboarding`, `src/common` — these modules must not be modified
- `package.json` dependencies — no new deps unless absolutely necessary; justify in the PR if so
- CI/CD configuration files
- The existing `prisma/seed.ts` (tests that need extra fixtures create them inline)

---

## 13. Rules for resolving ambiguity

- When the file leaves something underspecified, prefer whatever pattern is already used in `src/auth` and `src/onboarding` — those are the project's de facto reference modules
- When the project's patterns don't cover the question, consult the Confluence references at the top of this file
- If ambiguity remains, stop and ask the human operator; do not guess
