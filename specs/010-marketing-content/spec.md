# Feature Specification: Marketing Content Module (Features, FAQs, Testimonials)

**Feature Branch**: `010-marketing-content`
**Created**: 2026-04-14
**Status**: Draft
**Input**: User description: "Use the file docs/tickets/KAN-72.md as the source of fact for all the data you need for implementation"
**Source of truth**: `docs/tickets/KAN-72.md` (KAN-72)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage Features on a Path or Course (Priority: P1)

A content admin curates the "Features" list (icon + title + description) that appears on a public Path or Course detail page. They can add, edit, delete, and reorder feature items; each item belongs to exactly one owner (a Path or a Course).

**Why this priority**: Features are the most visible marketing element on a public detail page and the highest-value item for unlocking public discovery (KAN-26). Without them, detail pages look empty.

**Independent Test**: Admin signs in, picks a path, creates three features, edits one, reorders them, deletes one, and lists them back — the result reflects the admin's intended order and content. Delivers full Features CRUD independent of FAQs and Testimonials.

**Acceptance Scenarios**:

1. **Given** an existing path and an authenticated admin, **When** the admin creates a feature with icon, title, and description (no order), **Then** the feature is appended to the end of the path's feature list.
2. **Given** a path with three features, **When** the admin submits a reorder request listing the three ids in a new order, **Then** listing the features returns them in that new order.
3. **Given** an owner id that does not match any path or course, **When** the admin tries to create a feature under it, **Then** the request is rejected as not found and no feature is created.
4. **Given** a reorder request missing one id or containing an id from another owner, **When** the request is submitted, **Then** it is rejected and the existing order is unchanged.

---

### User Story 2 - Manage FAQs on a Path or Course (Priority: P1)

A content admin curates the FAQ list (question + answer) that appears on a public Path or Course detail page, with the same CRUD and reorder behavior as Features.

**Why this priority**: FAQs directly reduce support load and are a standard element of the public detail pages. Parity with Features is expected at launch.

**Independent Test**: Admin creates several FAQs under a course, edits one, reorders them, deletes one — listing returns the expected content and order. Delivers full FAQ CRUD without depending on Features or Testimonials.

**Acceptance Scenarios**:

1. **Given** an existing course, **When** the admin creates an FAQ with question and answer, **Then** the FAQ is stored under that course and appears in the list.
2. **Given** an FAQ that does not exist, **When** the admin attempts to update or delete it, **Then** the request is rejected as not found.
3. **Given** a course with existing FAQs, **When** the admin reorders them, **Then** subsequent listings return them in the new order.

---

### User Story 3 - Moderate Testimonials on a Path or Course (Priority: P1)

A content admin curates testimonials and controls which ones appear publicly via a moderation workflow with three states: Pending, Approved, and Hidden. Only Approved testimonials are ever shown on public pages; admins can see all states to moderate them.

**Why this priority**: Testimonials carry trust signals and require moderation before going public. Without the workflow, nothing can be shown safely on public pages.

**Independent Test**: Admin creates a testimonial (starts Pending), approves it, verifies it becomes visible via the public retrieval operation, hides it, and verifies it disappears from public results but is still visible to the admin. Delivers the full moderation flow independently.

**Acceptance Scenarios**:

1. **Given** an existing path, **When** the admin creates a testimonial, **Then** the testimonial is stored with status Pending regardless of any status supplied in the request.
2. **Given** a Pending testimonial, **When** the admin transitions it to Approved, **Then** the public retrieval returns it for that owner.
3. **Given** an Approved testimonial, **When** the admin transitions it to Hidden, **Then** the public retrieval no longer returns it, but the admin list still does.
4. **Given** a rating outside the 1–5 range or an invalid avatar URL, **When** the admin submits it, **Then** the request is rejected.

---

### User Story 4 - Public consumption of approved marketing content (Priority: P2)

A future public discovery feature (KAN-26) needs to fetch the marketing content for a given path or course so it can assemble the detail response. It expects three retrieval operations: all features for an owner, all FAQs for an owner, and only Approved testimonials for an owner.

**Why this priority**: Public endpoints are not delivered in this feature, but the retrieval contract must exist and be correct so KAN-26 can consume it without rework.

**Independent Test**: Seed one path with a mix of features, FAQs, and testimonials in all three statuses; call each retrieval operation and assert ordering and (for testimonials) status filtering.

**Acceptance Scenarios**:

1. **Given** a path with features in mixed order values, **When** features are retrieved for that path, **Then** results come back sorted by order ascending, with creation time as the tie-breaker.
2. **Given** a path with testimonials in all three statuses, **When** approved testimonials are retrieved for that path, **Then** only Approved items are returned.
3. **Given** an owner with no marketing content, **When** any retrieval operation runs, **Then** the result is an empty list (not an error).

---

### User Story 5 - Cascade cleanup when a Path or Course is deleted (Priority: P2)

When a Path or Course is deleted, its marketing content (features, FAQs, testimonials) must also be removed so orphaned rows do not accumulate or surface under a new owner later. Because the relationship is polymorphic (no foreign key), this cleanup is explicit.

**Why this priority**: Data hygiene is required for the platform's long-term integrity. The cleanup operation must exist and be verified even if no delete endpoint calls it yet in this feature.

**Independent Test**: Seed a path with features, FAQs, and testimonials, invoke the cleanup operation for that path, and verify all three sets for that owner are gone while content owned by other paths or courses is untouched.

**Acceptance Scenarios**:

1. **Given** a path owning several marketing items and another path that also owns marketing items, **When** cleanup runs for the first path, **Then** only the first path's items are removed and the second path's items are untouched.
2. **Given** a path with no marketing content, **When** cleanup runs for it, **Then** the operation succeeds without error.
3. **Given** a partial failure mid-cleanup, **When** the transaction cannot complete, **Then** no rows are deleted.

---

### Edge Cases

- Creating an item without an explicit order on an owner that already has items appends to the end (order = max + 1); on an empty owner it becomes order 0.
- Items with equal order values are tie-broken by creation time ascending.
- Reordering is rejected if the submitted id list has duplicates, omits any current id for the owner, or contains ids from another owner.
- Attempting to create or update content under an owner id that does not exist is rejected as not found.
- Whitespace-only values in required text fields are rejected; Arabic text is preserved end-to-end.
- Status values other than Pending, Approved, and Hidden are rejected when moderating a testimonial; any status value supplied on create is ignored.
- Two concurrent reorders on the same owner resolve cleanly: either both converge to a valid state or the later one fails explicitly rather than producing a partial order.

## Requirements *(mandatory)*

### Functional Requirements

**Ownership and scope**

- **FR-001**: Every feature, FAQ, and testimonial MUST belong to exactly one owner identified by an owner type (Path or Course) and an owner id.
- **FR-002**: Before any admin create or update operation, the system MUST verify the referenced owner exists and reject the operation as not found if it does not.
- **FR-003**: The system MUST NOT allow an item's owner to change via update; changing owner requires delete + create.

**Admin Features CRUD and reorder**

- **FR-004**: Admins MUST be able to list all features for a given owner, sorted by order ascending with creation time as tie-breaker.
- **FR-005**: Admins MUST be able to create a feature with icon, title (1–150 chars, trimmed, non-empty), and description (1–500 chars, trimmed, non-empty). An optional order may be provided; if omitted, the feature is appended to the end of the owner's list.
- **FR-006**: Admins MUST be able to update any subset of a feature's editable fields, with at least one field present in the request.
- **FR-007**: Admins MUST be able to delete a feature.
- **FR-008**: Admins MUST be able to atomically reorder all features under an owner by supplying the complete set of existing ids in the desired order.

**Admin FAQs CRUD and reorder**

- **FR-009**: Admins MUST be able to list, create, update, delete, and reorder FAQs for an owner with the same semantics as Features.
- **FR-010**: FAQ question MUST be 1–300 characters, trimmed, non-empty; FAQ answer MUST be 1–2000 characters, trimmed, non-empty.

**Admin Testimonials CRUD, reorder, and moderation**

- **FR-011**: Admins MUST be able to list, create, update, delete, and reorder testimonials for an owner with the same semantics as Features.
- **FR-012**: Testimonials MUST capture author name (1–100 chars, required), optional author title (1–100 chars), optional avatar URL (must be a valid URL when provided), content (1–1000 chars, required), and optional rating (integer 1–5 when provided).
- **FR-013**: Newly created testimonials MUST have status Pending regardless of any status supplied by the caller.
- **FR-014**: The standard update operation MUST NOT change a testimonial's status.
- **FR-015**: Admins MUST be able to transition a testimonial's status between Pending, Approved, and Hidden via a dedicated moderation operation.
- **FR-016**: The admin list operation MUST return testimonials in all statuses so moderators can act on Pending and Hidden items.

**Reorder integrity**

- **FR-017**: A reorder request MUST be rejected if its id set does not exactly match the current ids for the owner (no missing, extra, or duplicate ids).
- **FR-018**: A successful reorder MUST either update every affected item or leave the database unchanged.
- **FR-019**: Reorder MUST be idempotent: submitting the same id list again produces no change.

**Public retrieval contract**

- **FR-020**: The system MUST expose a retrieval operation that returns all features for a given owner, sorted by order ascending then creation time ascending, and returns an empty list when none exist.
- **FR-021**: The system MUST expose a retrieval operation that returns all FAQs for a given owner with the same ordering semantics.
- **FR-022**: The system MUST expose a retrieval operation that returns only Approved testimonials for a given owner with the same ordering semantics.
- **FR-023**: The public retrieval operations MUST be available for consumption by future public discovery functionality but MUST NOT be wired to any public endpoint in this feature.

**Cleanup on owner deletion**

- **FR-024**: The system MUST expose a cleanup operation that, given a Path id, deletes all features, FAQs, and testimonials owned by that Path atomically.
- **FR-025**: The system MUST expose the equivalent cleanup operation for a Course id.
- **FR-026**: Cleanup MUST be idempotent (no error when the owner has no marketing content) and MUST NOT affect content owned by other owners.

**Authorization**

- **FR-027**: All admin operations in this feature MUST require an authenticated admin; unauthenticated requests MUST be rejected.
- **FR-028**: The feature MUST reuse the existing admin authorization pattern already in use elsewhere in the platform; it MUST NOT introduce a new authorization mechanism.

**Error reporting**

- **FR-029**: Missing owner errors MUST be reported as "not found" with a message that names the owner kind and id.
- **FR-030**: Missing item errors (feature, FAQ, testimonial by id) MUST be reported as "not found" with a message that names the item kind and id.
- **FR-031**: Reorder list mismatches MUST be reported as a clearly described bad-request error.
- **FR-032**: Validation failures on request bodies MUST be reported as bad-request errors using the platform's standard validation pipeline.

**Data fidelity**

- **FR-033**: All text fields MUST round-trip Arabic characters without alteration or encoding loss.
- **FR-034**: The feature MUST NOT modify the database schema or existing migrations; it builds on the schema delivered by KAN-70.

**Cache invalidation (conditional)**

- **FR-035**: If a shared cache layer exists at implementation time, every mutating operation (create, update, delete, reorder, status change) MUST invalidate the cached public detail response for the affected owner; if the cache layer does not yet exist, mutations MUST function correctly without it and leave a traceable marker for later wiring.

### Key Entities *(include if feature involves data)*

- **Feature**: A marketing bullet on a Path or Course detail page. Attributes: owner type, owner id, icon, title, description, order. Belongs to exactly one owner.
- **FAQ**: A question-and-answer pair on a Path or Course detail page. Attributes: owner type, owner id, question, answer, order. Belongs to exactly one owner.
- **Testimonial**: A quoted endorsement shown on a Path or Course detail page, subject to moderation. Attributes: owner type, owner id, author name, optional author title, optional avatar URL, content, optional rating (1–5), moderation status (Pending / Approved / Hidden), order, creation time. Belongs to exactly one owner. Only Approved testimonials are visible publicly.
- **Owner (Path or Course)**: The parent of marketing content items. Ownership is polymorphic — the item stores an owner kind and an owner id but has no direct relational link, so referential integrity is enforced at the application layer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can add, edit, reorder, and remove a marketing item on a path or course and see the change reflected immediately on the next list call, with no manual cleanup required.
- **SC-002**: 100% of public retrievals for testimonials return only Approved items; Pending and Hidden items never appear in public results under any tested scenario.
- **SC-003**: Reorder operations on a set of up to 50 items complete in a single atomic step with no observable partial state, and submitting the same ordering twice produces no change.
- **SC-004**: When an owner is cleaned up, every marketing item belonging to that owner is removed and no item belonging to any other owner is affected, verified across features, FAQs, and testimonials.
- **SC-005**: Every admin operation in this feature is reachable only by an authenticated admin; unauthenticated callers receive a consistent rejection.
- **SC-006**: Arabic text in every field is preserved byte-for-byte across create, read, update, and list operations.
- **SC-007**: The feature ships without modifying the database schema, existing migrations, or any module outside the marketing sub-area, verifiable by diff inspection.
- **SC-008**: KAN-26 can build the public path/course detail response by calling only the three public retrieval operations defined here, with no additional queries against marketing content required.

## Assumptions

- The underlying data model for Feature, FAQ, and Testimonial (including polymorphic owner columns and the three-state testimonial status) is already in place from KAN-70 and will not be modified here.
- Admin authentication and role-based authorization already exist and are reused exactly as established by the preceding Tags module (KAN-71). No new auth mechanism is introduced.
- A public submission flow for testimonials is out of scope; all testimonials in this feature originate from an admin action.
- Public discovery endpoints that surface this content to end users are delivered by a separate feature (KAN-26) and are out of scope here; this feature only provides the retrieval contract they will consume.
- A shared cache layer (KAN-74) may or may not be present at implementation time; this feature adapts to either case without blocking on KAN-74.
- End-to-end tests run against the existing `awamer_test` database and reuse the test harness established by the Tags module.
- "Owner does not exist" validation is performed on admin write operations; the public retrieval operations assume the caller has already validated the owner and therefore do not re-check.
- Reorder contention is rare enough that optimistic behavior (fail the later request cleanly) is acceptable; no explicit locking beyond the database transaction is required.

## Dependencies

- **KAN-70** (Prisma schema v6) — delivers the Feature, FAQ, and Testimonial entities and the testimonial status enum. Done.
- **KAN-71** (Tags module) — establishes the admin CRUD conventions, module layout, and test harness that this feature mirrors. Done.
- **KAN-74** (Cache layer) — optional at implementation time; wiring is conditional per FR-035.
- **KAN-26** (Public discovery endpoints) — consumer of the public retrieval operations defined here; not delivered by this feature.
