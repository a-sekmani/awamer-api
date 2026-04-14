# KAN-72 — Marketing Content module (Features, FAQs, Testimonials)

> **Jira:** [KAN-72](https://awamer.atlassian.net/browse/KAN-72)
> **Parent epic:** KAN-4 (E3: Public Discovery)
> **Depends on:** KAN-70 (Prisma schema v6 — done)
> **Blocks:** KAN-26 (Public discovery endpoints)
>
> **References:**
> - [Data Model v6 — Marketing Content section](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/28835841/Data+Model)
> - [API Design v2 §23 Admin Marketing Content](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/27754532/API+Design)
> - [PRD v8 §7.1 and §11.9](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/26607617/PRD)
> - [Tech Stack v4 §6.2 ContentModule](https://awamer.atlassian.net/wiki/spaces/~712020969c0dbe164e4ea389be15273fbf8cc4/pages/29458433/Tech+Stack)

---

## 1. Goal

Deliver the marketing content layer for Path and Course public pages: **Features**, **FAQs**, and **Testimonials**. All three entities are polymorphic — they can belong to either a Path or a Course. Testimonials additionally have a moderation workflow with three states (`PENDING`, `APPROVED`, `HIDDEN`); only approved testimonials appear on public pages.

This ticket delivers:

- Admin CRUD for all three entities, scoped by owner (path or course)
- Atomic reorder operations
- Polymorphic owner validation
- Service-layer cascade cleanup when a Path or Course is deleted
- Public query helpers that KAN-26 will consume to build the public detail responses
- Full test coverage

The `Feature`, `Faq`, and `Testimonial` Prisma models already exist (delivered by KAN-70). This ticket builds the NestJS layer on top of them, reusing the `ContentModule` already created by KAN-71.

---

## 2. Scope

### In scope

- New marketing submodule under `src/content/marketing/`
- Three services: `FeaturesService`, `FaqsService`, `TestimonialsService`
- Three admin controllers: `AdminFeaturesController`, `AdminFaqsController`, `AdminTestimonialsController`
- DTOs for create / update / reorder / moderation
- Shared `OwnerValidator` helper that validates polymorphic `(ownerType, ownerId)` pairs
- Reusable atomic reorder helper
- Service-layer cascade cleanup when a Path or Course is deleted
- Public query helpers: `getFeaturesByOwner`, `getFaqsByOwner`, `getApprovedTestimonialsByOwner`
- Unit and end-to-end tests
- Registration of the new components inside the existing `ContentModule`
- Short README update under the existing Content section

### Out of scope

- Public discovery endpoints themselves (KAN-26 will consume the query helpers)
- Path or Course admin endpoints (only the cleanup helper they will eventually call)
- Frontend admin UI for marketing content
- Caching layer wiring (KAN-74 — see §7 for how caching is handled)
- Any modification to `prisma/schema.prisma` or existing migrations
- Any modification to `auth`, `users`, `onboarding`, `common`, or `src/content/tags/` modules

---

## 3. Domain rules

### Polymorphic ownership

- Each entity (`Feature`, `Faq`, `Testimonial`) has two columns: `ownerType` (enum: `PATH` | `COURSE`) and `ownerId` (string)
- There is no Prisma `@relation` between these entities and Path/Course — referential integrity is enforced at the service layer
- Before any create or update, the service must verify that the referenced owner exists. If `ownerType = PATH`, verify a Path with that id exists. Same for COURSE.
- If the owner does not exist, the operation fails with `BadRequestException`

### Order

- Each entity has an `order` field (integer, defaults to `0`)
- Within a single owner, items are sorted by `order` ascending, then by `createdAt` ascending as a tie-breaker
- The `order` value can have gaps; reordering normalizes it (see §5)
- New items created without an explicit `order` are appended (their order = max existing order + 1 for that owner, or 0 if none exist)

### Feature

- Fields: `id`, `ownerType`, `ownerId`, `icon`, `title`, `description`, `order`
- `icon` is a string (icon name or URL — service does not validate the format beyond non-empty)
- `title`: 1–150 characters, trimmed, rejects whitespace-only
- `description`: 1–500 characters, trimmed, rejects whitespace-only

### Faq

- Fields: `id`, `ownerType`, `ownerId`, `question`, `answer`, `order`
- `question`: 1–300 characters, trimmed, rejects whitespace-only
- `answer`: 1–2000 characters, trimmed, rejects whitespace-only

### Testimonial

- Fields: `id`, `ownerType`, `ownerId`, `authorName`, `authorTitle?`, `avatarUrl?`, `content`, `rating?`, `status`, `order`, `createdAt`
- `authorName`: 1–100 characters, trimmed, required
- `authorTitle`: optional, 1–100 characters when provided
- `avatarUrl`: optional, must be a valid URL when provided
- `content`: 1–1000 characters, trimmed, required
- `rating`: optional integer, 1–5 inclusive when provided
- `status`: enum `TestimonialStatus` (`PENDING` | `APPROVED` | `HIDDEN`), defaults to `PENDING` on creation

### Testimonial moderation

- New testimonials are created in `PENDING` status by default
- Only an admin can change the status (no public submission flow in scope)
- `APPROVED` testimonials are visible in the public query helper
- `PENDING` and `HIDDEN` testimonials are NEVER returned by the public helper, but ARE visible to admins

### Cascade cleanup

- When a Path is deleted, all Features, Faqs, and Testimonials with `ownerType = PATH` and `ownerId = <deleted path id>` must be deleted
- Same when a Course is deleted
- Because there is no Prisma `@relation`, this cleanup CANNOT happen automatically via `onDelete: Cascade`
- The cleanup is performed by a service-layer helper exposed from the marketing submodule (`MarketingCleanupHelper` — see §6) that future Path/Course delete endpoints will call
- Until those delete endpoints exist, the helper is exported and tested but not called by any production endpoint

---

## 4. Endpoints

All endpoints are admin-only and live under `/api/v1/admin`.

### 4.1 Features

```
GET    /api/v1/admin/{paths|courses}/:ownerId/features
POST   /api/v1/admin/{paths|courses}/:ownerId/features
PATCH  /api/v1/admin/features/:id
PATCH  /api/v1/admin/{paths|courses}/:ownerId/features/reorder
DELETE /api/v1/admin/features/:id
```

- `GET` — returns all features for the given owner, sorted by `order` then `createdAt`. Returns `[]` if none.
- `POST` — body: `{ icon, title, description, order? }`. If `order` is omitted, the service appends to the end. Returns 201 with the created feature. Returns 400 on validation errors or invalid owner. Returns 404 if the owner does not exist.
- `PATCH /:id` — body is partial of the create body, at least one field required. Returns 200 with the updated feature. Returns 404 if the feature does not exist.
- `PATCH .../reorder` — body: `{ itemIds: string[] }`. The list must contain exactly the IDs of all features currently belonging to the owner. The service atomically reassigns `order` to match the new sequence. Returns 200 with the reordered list. Returns 400 if the list is missing IDs, contains foreign IDs, or contains duplicates. Returns 404 if the owner does not exist.
- `DELETE /:id` — returns 204. Returns 404 if the feature does not exist.

### 4.2 FAQs

Same endpoint shape as Features, but with `question` and `answer` fields instead of `icon`/`title`/`description`:

```
GET    /api/v1/admin/{paths|courses}/:ownerId/faqs
POST   /api/v1/admin/{paths|courses}/:ownerId/faqs
PATCH  /api/v1/admin/faqs/:id
PATCH  /api/v1/admin/{paths|courses}/:ownerId/faqs/reorder
DELETE /api/v1/admin/faqs/:id
```

### 4.3 Testimonials

Same endpoint shape as Features with the testimonial fields, plus a dedicated moderation endpoint:

```
GET    /api/v1/admin/{paths|courses}/:ownerId/testimonials
POST   /api/v1/admin/{paths|courses}/:ownerId/testimonials
PATCH  /api/v1/admin/testimonials/:id
PATCH  /api/v1/admin/testimonials/:id/status
PATCH  /api/v1/admin/{paths|courses}/:ownerId/testimonials/reorder
DELETE /api/v1/admin/testimonials/:id
```

- `GET` — returns ALL testimonials regardless of status (admins need to see pending and hidden ones to moderate them). Sort by `order` then `createdAt`.
- `POST` — body: `{ authorName, authorTitle?, avatarUrl?, content, rating?, order? }`. Status is always `PENDING` on creation; the body's `status` field is ignored if present.
- `PATCH /:id` — partial update of editable fields (excluding `status`). To change status, use the dedicated endpoint below.
- `PATCH /:id/status` — body: `{ status: 'PENDING' | 'APPROVED' | 'HIDDEN' }`. Returns the updated testimonial.

### 4.4 Error shape

All errors use NestJS's standard `HttpException` family. Specific mappings:

- Owner does not exist → `NotFoundException` with message `"Path 'xyz' does not exist"` or `"Course 'xyz' does not exist"`
- Feature/Faq/Testimonial does not exist → `NotFoundException` with message `"Feature 'xyz' not found"`
- Reorder list mismatch (missing or extra IDs, duplicates) → `BadRequestException` with a clear description
- Validation errors → automatic 400 via `ValidationPipe`

---

## 5. Reorder helper

A shared atomic reorder operation used by all three reorder endpoints.

### Algorithm

1. Fetch all current items for the owner (in a single query)
2. Verify the input `itemIds` list contains exactly the same IDs as the fetched items, with no duplicates and no extras (set equality, not order)
3. If the verification fails, throw `BadRequestException` and commit no changes
4. Inside a Prisma transaction, update each item to set its new `order` value as its index in the input list (0-based)
5. Return the updated list, sorted by the new order

### Behavior

- Atomic: either all updates succeed, or none do
- Idempotent: running with the same input list twice produces the same final state
- Correct under contention: if two admins reorder simultaneously, the second one will either succeed (if they happen to use the latest IDs) or fail cleanly
- Implementation detail: this is a generic helper that takes the model name (`feature` | `faq` | `testimonial`) and operates on it. Avoid duplicating the algorithm three times.

---

## 6. Public query helpers

Three functions exported from the marketing submodule for KAN-26 to consume. Each takes an owner pair `(ownerType, ownerId)` and returns the appropriate list.

```
getFeaturesByOwner(ownerType, ownerId): Promise<Feature[]>
  - Returns all features for the owner
  - Sorted by order ASC, then createdAt ASC
  - Returns [] if none

getFaqsByOwner(ownerType, ownerId): Promise<Faq[]>
  - Same shape, returns all faqs

getApprovedTestimonialsByOwner(ownerType, ownerId): Promise<Testimonial[]>
  - Returns ONLY testimonials with status = APPROVED
  - Sorted by order ASC, then createdAt ASC
  - Returns [] if none
```

These helpers do NOT validate that the owner exists — KAN-26 will already have fetched the path/course before calling them. They simply query the marketing tables.

These helpers are NOT called by any endpoint in this ticket. They are exported for KAN-26 to import.

---

## 7. Cleanup helper

`MarketingCleanupHelper` exposes:

```
deleteAllForPath(pathId: string): Promise<void>
deleteAllForCourse(courseId: string): Promise<void>
```

Both methods:

1. Run inside a Prisma transaction
2. Delete all Features, all Faqs, and all Testimonials with the matching `ownerType` and `ownerId`
3. Are idempotent — calling on a path/course with no marketing content is a no-op

This helper is exported from the module. Future Path and Course admin delete endpoints (KAN-26 or later) will call it.

---

## 8. Owner validation helper

`OwnerValidator` exposes:

```
ensurePathExists(pathId: string): Promise<void>
ensureCourseExists(courseId: string): Promise<void>
ensureOwnerExists(ownerType, ownerId): Promise<void>
```

Each method throws `NotFoundException` if the owner does not exist. This helper is used by every create and update operation across the three services.

---

## 9. Caching

KAN-74 delivers the Redis CacheModule in parallel and may or may not be merged when this ticket starts.

- **If `CacheModule` exists at implementation time:**
  - On any mutation (create, update, delete, reorder, status change), invalidate the cached path/course detail response for the affected owner using a stable key like `path:detail:{ownerId}` or `course:detail:{ownerId}`
- **If `CacheModule` does not yet exist:**
  - Implement without caching
  - Add `// TODO(KAN-74): invalidate <key>` comments at every mutation site
  - All endpoints function correctly without the cache

---

## 10. Authorization

All endpoints in this ticket are admin-only. Reuse whatever admin guard pattern was established in KAN-71 (`JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`). Do not introduce a new guard mechanism.

---

## 11. Validation

All DTOs use `class-validator` decorators following the conventions established in KAN-71.

- String fields: `@IsString()`, `@Length(min, max)`, trimmed, reject whitespace-only
- Optional fields: `@IsOptional()`
- Enums: `@IsEnum(TestimonialStatus)`
- URLs: `@IsUrl()` (for `avatarUrl`)
- Integers in range: `@IsInt()` + `@Min(1)` + `@Max(5)` (for `rating`)
- Arrays of IDs (for reorder): `@IsArray()` + `@IsString({ each: true })` + `@ArrayMinSize(1)`

Arabic characters in all text fields must round-trip correctly without encoding issues.

---

## 12. Module structure

New files created under `src/content/marketing/`:

```
src/content/marketing/
├── features/
│   ├── features.service.ts
│   ├── admin-features.controller.ts
│   ├── dto/
│   │   ├── create-feature.dto.ts
│   │   ├── update-feature.dto.ts
│   │   └── feature-response.dto.ts
├── faqs/
│   ├── faqs.service.ts
│   ├── admin-faqs.controller.ts
│   ├── dto/
│   │   ├── create-faq.dto.ts
│   │   ├── update-faq.dto.ts
│   │   └── faq-response.dto.ts
├── testimonials/
│   ├── testimonials.service.ts
│   ├── admin-testimonials.controller.ts
│   ├── dto/
│   │   ├── create-testimonial.dto.ts
│   │   ├── update-testimonial.dto.ts
│   │   ├── update-testimonial-status.dto.ts
│   │   └── testimonial-response.dto.ts
├── helpers/
│   ├── owner-validator.helper.ts
│   ├── reorder.helper.ts
│   ├── marketing-cleanup.helper.ts
│   └── public-queries.helper.ts   # exports getFeaturesByOwner, getFaqsByOwner, getApprovedTestimonialsByOwner
└── marketing.module.ts             # internal sub-module imported by ContentModule
```

`ContentModule` imports `MarketingModule` so its providers are available globally inside the content submodule. The exports from `MarketingModule` (the four helpers in `helpers/`) are re-exported by `ContentModule` for other modules to consume.

Naming, file layout, and code style match the conventions established by KAN-71 in `src/content/tags/`.

---

## 13. Tests

### 13.1 Unit tests

Against mocked `PrismaService`:

#### `features.service.spec.ts`
- Lists features for an owner, sorted by order then createdAt
- Creates a feature with explicit order
- Creates a feature without order — appends to the end (max + 1 or 0 if empty)
- Updates a feature
- Deletes a feature
- Throws `NotFoundException` on missing feature
- Throws `NotFoundException` when creating with a nonexistent owner
- Reorder happy path
- Reorder rejects mismatched ID list

#### `faqs.service.spec.ts`
- Same structure as features.service.spec.ts but with question/answer fields

#### `testimonials.service.spec.ts`
- Same CRUD coverage
- New testimonial is created with `status = PENDING` regardless of input
- Status update via the dedicated endpoint
- `getApprovedTestimonialsByOwner` returns only APPROVED items
- Admin GET returns all statuses

#### `owner-validator.helper.spec.ts`
- Resolves `PATH` to a Prisma path lookup
- Resolves `COURSE` to a Prisma course lookup
- Throws `NotFoundException` when the owner does not exist
- Throws `NotFoundException` on unknown ownerType (defensive)

#### `reorder.helper.spec.ts`
- Reassigns order based on input list index
- Rejects input with duplicates
- Rejects input that is missing existing IDs
- Rejects input with foreign IDs
- Runs inside a Prisma transaction (verifiable via mock)

#### `marketing-cleanup.helper.spec.ts`
- Deletes all features, faqs, and testimonials for the given path or course
- No-op when nothing exists
- Runs inside a Prisma transaction

### 13.2 End-to-end tests

Against the real `awamer_test` database, reusing the test harness from KAN-70 and the `test-app.ts` pattern from KAN-71:

#### `admin-features.controller.e2e-spec.ts`
- Full CRUD cycle against a seeded path
- Full CRUD cycle against a seeded course
- Reorder works end-to-end
- Reorder rejects bad input with 400
- Returns 404 when the owner does not exist
- Returns 404 when the feature does not exist
- Returns 401 when unauthenticated
- Arabic text round-trips correctly

#### `admin-faqs.controller.e2e-spec.ts`
- Same coverage as features but for FAQs

#### `admin-testimonials.controller.e2e-spec.ts`
- Full CRUD cycle
- New testimonials are created with `PENDING` status
- Status update endpoint cycles through PENDING → APPROVED → HIDDEN → APPROVED
- Admin GET returns all statuses including PENDING and HIDDEN
- Validation: rating outside 1–5 is rejected
- Validation: invalid avatar URL is rejected
- Reorder works
- Returns 401 when unauthenticated

#### `marketing-cleanup.helper.e2e-spec.ts`
- After seeding a path with features, faqs, and testimonials, calling `deleteAllForPath` removes all of them
- Same for course
- No-op on a path/course with no marketing content
- Does not affect marketing content owned by other paths/courses

#### `public-queries.helper.e2e-spec.ts`
- `getFeaturesByOwner` returns features in correct order
- `getFaqsByOwner` returns faqs in correct order
- `getApprovedTestimonialsByOwner` returns only APPROVED testimonials, in correct order
- All helpers return `[]` for owners with no marketing content

### 13.3 Test infrastructure

- Reuses `awamer_test` database from KAN-70
- Reuses the `test-app.ts` bootstrap helper from KAN-71 for e2e tests (real signed JWTs as Bearer tokens)
- Reuses the truncation helpers from `test/schema/setup.ts`
- New e2e test files live under `test/content/marketing/`
- Each test file truncates the relevant tables in `beforeEach` to stay isolated
- Add a `test:content:e2e` script extension or a new `test:marketing:e2e` script — whichever is cleaner. Reuse the existing `test/content-e2e-jest.config.js` from KAN-71 if possible.

---

## 14. Definition of Done

The ticket is not closed until all of the following are true:

1. `npm run build` succeeds with zero TypeScript errors
2. `npx prisma validate` still passes (schema is unchanged)
3. `npm run test:schema` is still green (KAN-70's tests are untouched)
4. `npm test` runs every test in the project — all green
5. All unit tests in §13.1 pass
6. All e2e tests in §13.2 pass
7. `git diff prisma/schema.prisma` is empty
8. `git diff prisma/migrations/` is empty
9. `git diff src/auth src/users src/onboarding src/common src/content/tags` is empty
10. `MarketingModule` is registered inside `ContentModule`, and `ContentModule` is still registered in `AppModule`
11. The four marketing helpers (`OwnerValidator`, `ReorderHelper`, `MarketingCleanupHelper`, public query helpers) are exported from `ContentModule` so other modules can consume them
12. README has a short note added under the existing Content section describing what marketing endpoints and helpers `ContentModule` now exposes
13. Manual smoke test acceptable substitute: the e2e tests exercise every endpoint against a real Postgres through the full NestJS pipeline

---

## 15. Out of scope — not to be touched

- `prisma/schema.prisma` — frozen since KAN-70
- Any file under `prisma/migrations/`
- `src/auth`, `src/users`, `src/onboarding`, `src/common`
- `src/content/tags/` — frozen since KAN-71
- The existing `prisma/seed.ts` (tests that need extra fixtures create them inline)
- `package.json` dependencies — no new deps unless absolutely necessary; justify in the PR if so
- CI/CD configuration files

---

## 16. Rules for resolving ambiguity

- When the file leaves something underspecified, prefer whatever pattern is already used in `src/content/tags/` (KAN-71) — it's the most recent and most relevant reference module
- For NestJS conventions not covered by `src/content/tags/`, fall back to `src/auth` and `src/onboarding`
- For data shape questions, consult the Confluence references at the top of this file
- If ambiguity remains, stop and ask the human operator; do not guess
