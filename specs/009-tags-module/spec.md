# Feature Specification: Tags Module

**Feature Branch**: `009-tags-module`
**Created**: 2026-04-14
**Status**: Draft
**Input**: User description: "Implement KAN-71 as specified in docs/tickets/KAN-71.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Public visitors browse the active tag vocabulary (Priority: P1)

A visitor on the public Awamer site opens the discovery area and sees the list of tags currently in use. Each tag shows how many published paths and published courses are associated with it, so the visitor can gauge the breadth of a topic before clicking through. Hidden tags never appear.

**Why this priority**: The public tag list is the foundational read surface for the whole ticket. Every downstream discovery and filtering feature (KAN-26 and beyond) depends on it. Without this endpoint, no visitor can see the taxonomy at all, and the ticket delivers zero user-visible value. It is also the simplest slice to demo end-to-end.

**Independent Test**: Seed a handful of active tags and one hidden tag against the test database, request the public tag list, and verify that the returned list contains only the active tags, each with counts matching the seeded associations, sorted alphabetically, and the hidden tag is absent.

**Acceptance Scenarios**:

1. **Given** three active tags and one hidden tag exist in the system, **When** a visitor requests the public tag list, **Then** the response contains exactly the three active tags sorted alphabetically by name and omits the hidden tag.
2. **Given** an active tag is attached to two published paths and one published course, **When** a visitor requests the public tag list, **Then** the tag's entry shows a path count of two and a course count of one.
3. **Given** no active tags exist in the system, **When** a visitor requests the public tag list, **Then** the response contains an empty list (not an absence of data or an error).
4. **Given** a tag named in Arabic (for example "ذكاء صناعي"), **When** a visitor requests the public tag list, **Then** the Arabic characters appear unchanged in the response.
5. **Given** any visitor (signed in or not), **When** they request the public tag list, **Then** the request succeeds without requiring authentication.
6. **Given** the public tag list is returned, **When** the response is inspected, **Then** it advertises a one-minute public cache lifetime to downstream HTTP caches.

---

### User Story 2 - Administrators manage the tag vocabulary (Priority: P2)

A content administrator needs to curate the tag vocabulary over time: create new tags when new topics emerge, rename or re-slug existing tags, hide tags that should no longer appear publicly (without losing their history), and permanently delete tags that were created by mistake. Hiding a tag preserves its associations in the database; deleting a tag permanently removes it along with every association to every path and course.

**Why this priority**: Without administrative tag management, the public list is static and grows stale. Curation is the day-to-day operational activity that keeps the taxonomy healthy, so it is the natural second slice of functionality. It is independent of Story 1 in that an admin can manage tags before any visitor ever sees them.

**Independent Test**: As an administrator, create a new tag, verify it appears in the full admin list with active status and zero counts, rename and re-slug it, hide it, confirm it disappears from the public list but remains in the admin list, then delete it and confirm it is fully gone from both.

**Acceptance Scenarios**:

1. **Given** an administrator is authenticated, **When** they request the full tag list, **Then** the response returns every tag including hidden ones, each with the administrative fields (status, creation time) in addition to the public fields.
2. **Given** no tag currently uses the slug "ml", **When** an administrator creates a tag with that slug, **Then** the new tag is persisted, appears in the admin list, and is returned with zero path and course counts.
3. **Given** a tag with slug "ml" already exists, **When** an administrator tries to create another tag with the same slug, **Then** the attempt is rejected with a conflict and the existing tag is unchanged.
4. **Given** a tag exists, **When** an administrator updates its name, slug, or status, **Then** the change is persisted and the updated fields appear in subsequent reads.
5. **Given** two distinct tags exist, **When** an administrator tries to rename one to reuse the other's slug, **Then** the attempt is rejected with a conflict.
6. **Given** an active tag attached to several paths and courses, **When** an administrator changes its status to hidden, **Then** the tag disappears from the public list but remains in the admin list with all its existing associations intact.
7. **Given** an administrator attempts to operate on a tag identifier that does not exist, **When** they read, update, or delete it, **Then** the system reports that the tag was not found.
8. **Given** a tag attached to several paths and courses, **When** an administrator deletes it, **Then** the tag and every one of its associations are removed, and subsequent public and admin reads no longer list it.
9. **Given** an unauthenticated caller, **When** they attempt any administrative tag action, **Then** the request is rejected and does not modify any data.
10. **Given** invalid input (empty name, whitespace-only name, uppercase or special-character slug, name or slug outside length limits), **When** an administrator submits it, **Then** the request is rejected with a validation error before any persistence.

---

### User Story 3 - Other modules atomically replace the tag set attached to a path or a course (Priority: P3)

When a future ticket edits a path or a course, it supplies the full desired list of tag identifiers for that owner. The system must replace the existing tag set for that owner with the new set atomically: either all changes land together or none do. Duplicate identifiers in the input are silently collapsed. If any identifier is unknown or refers to a hidden tag, the entire operation fails and leaves the previous associations intact. The operation is exposed as a reusable capability for other modules to call — it does not have an endpoint of its own in this ticket.

**Why this priority**: No visitor or administrator calls this directly in this ticket. It exists so that downstream path- and course-edit tickets can attach or detach tags consistently without reinventing the logic. It is the lowest priority slice here because no user benefits from it until a caller is wired up in a later ticket.

**Independent Test**: Seed a path with a known set of tag associations, invoke the replace operation with a new list, confirm the associations match the new list exactly and the previous ones are gone; then invoke it again with the same list and confirm nothing changes; then invoke it with an unknown identifier and confirm the call fails and the previous state is preserved.

**Acceptance Scenarios**:

1. **Given** a path currently associated with tags A and B, **When** the replace operation is called with the list [B, C, D], **Then** afterward the path is associated with exactly B, C, and D, with no duplicate rows.
2. **Given** a path currently associated with tags A and B, **When** the replace operation is called with an empty list, **Then** afterward the path has no tag associations.
3. **Given** any owner, **When** the replace operation is called with duplicates in the input (for example [A, B, A]), **Then** the final state contains each tag at most once.
4. **Given** a path currently associated with tags A and B, **When** the replace operation is called with a list containing an unknown tag identifier, **Then** the call fails, the error identifies the unknown tag, and the path's associations are still A and B.
5. **Given** a path currently associated with tags A and B, **When** the replace operation is called with a list containing a hidden tag identifier, **Then** the call fails, the error identifies the hidden tag, and the path's associations are still A and B.
6. **Given** any owner, **When** the replace operation is called twice in succession with the same input list, **Then** the database state is identical after the first and the second call.
7. **Given** the same replace behavior, **When** the operation is invoked for a course instead of a path, **Then** the same guarantees apply to course tag associations.

---

### Edge Cases

- A tag exists with a name consisting of a single Arabic word — counts compute correctly and the tag round-trips without encoding changes.
- A tag has zero published paths and zero published courses attached — it still appears in the public list (if active) with both counts at zero.
- An administrator renames a tag by changing only its name while keeping the slug — the change applies and public counts stay consistent.
- An administrator hides an already-hidden tag or re-activates an already-active tag — the request succeeds idempotently with no state change.
- A path has both active and hidden tags attached from before a hide action — after the hide, the public count for the newly-hidden tag drops immediately because the tag itself is no longer public.
- An unpublished (draft or archived) path or course is attached to a tag — it does not contribute to the public path/course counts, which reflect only published content.
- A tag is deleted while several paths and courses reference it — all those references vanish at the same instant the tag is removed; the paths and courses themselves remain untouched.
- The replace operation is called with an empty input list on an owner that already has no tags — it succeeds as a no-op.

## Requirements *(mandatory)*

### Functional Requirements

#### Public tag browsing

- **FR-001**: The system MUST expose a public tag list that can be retrieved without authentication.
- **FR-002**: The public tag list MUST include only tags whose status is active.
- **FR-003**: The public tag list MUST be sorted alphabetically by tag name.
- **FR-004**: Each entry in the public tag list MUST include the tag's identifier, name, slug, the number of published paths using the tag, and the number of published courses using the tag.
- **FR-005**: The counts MUST be computed from the live database at request time and MUST NOT rely on precomputed or stored totals.
- **FR-006**: Draft and archived paths and courses MUST NOT contribute to public path and course counts.
- **FR-007**: The public tag list MUST return an empty list (never a missing or null payload) when no active tags exist.
- **FR-008**: The public tag list response MUST advertise a one-minute public HTTP cache lifetime so downstream caches can reuse it briefly.
- **FR-009**: Arabic characters in tag names MUST round-trip through every operation (create, read, update, delete) without any encoding change.

#### Administrative tag management

- **FR-010**: Administrators MUST be able to retrieve a full list of all tags including hidden ones, sorted alphabetically by name.
- **FR-011**: Each entry in the administrative tag list MUST include, in addition to the public fields, the tag's status and creation time.
- **FR-012**: Administrators MUST be able to create a new tag by providing a name and a slug; status defaults to active if not specified.
- **FR-013**: Administrators MUST be able to update an existing tag's name, slug, and/or status; at least one field must be provided.
- **FR-014**: Administrators MUST be able to permanently delete a tag by its identifier.
- **FR-015**: Deleting a tag MUST also remove every path-tag and course-tag association that referenced it, in the same action.
- **FR-016**: Deleting a tag MUST NOT modify the paths or courses that were referenced.
- **FR-017**: All administrative tag endpoints MUST reject unauthenticated requests.
- **FR-018**: Administrative endpoints MUST reject callers who are not administrators.

#### Validation

- **FR-019**: A tag name MUST be between 1 and 100 characters inclusive and MUST NOT consist only of whitespace.
- **FR-020**: A tag slug MUST be between 1 and 60 characters inclusive and MUST contain only lowercase ASCII letters, digits, and single hyphens separating non-empty segments.
- **FR-021**: A tag slug MUST be globally unique; attempting to create or rename to a slug already in use MUST be rejected as a conflict.
- **FR-022**: Attempting to read, update, or delete a nonexistent tag MUST be rejected with a "not found" outcome.
- **FR-023**: Validation failures MUST be rejected before any persistence takes place.

#### Atomic tag-set replacement capability

- **FR-024**: The system MUST provide a reusable capability to replace the complete set of tag associations attached to a path or to a course.
- **FR-025**: The replace capability MUST deduplicate the caller's input list before acting on it.
- **FR-026**: The replace capability MUST validate that every identifier in the deduplicated input refers to an existing tag whose status is active.
- **FR-027**: If any identifier in the input is unknown, the replace capability MUST fail the entire operation, leave prior associations unchanged, and identify the offending identifier in the error.
- **FR-028**: If any identifier in the input refers to a hidden tag, the replace capability MUST fail the entire operation, leave prior associations unchanged, and identify the offending identifier in the error.
- **FR-029**: When the replace capability succeeds, the owner's final set of associations MUST match the deduplicated input exactly — no stale associations, no missing new associations, no duplicates.
- **FR-030**: The replace capability MUST be idempotent: calling it twice in a row with the same input MUST produce the same final state both times.
- **FR-031**: The replace capability MUST behave identically for paths and for courses.
- **FR-032**: The replace capability MUST run in a single all-or-nothing transaction so partial updates are impossible.
- **FR-033**: The replace capability MUST be exposed to other modules as a reusable component; this ticket does not expose an endpoint that directly calls it.

#### Taxonomy integrity

- **FR-034**: A tag's slug, once unique in the system, MUST remain globally unique under every create and update operation.
- **FR-035**: The same tag MUST NOT be attached twice to the same path or twice to the same course.
- **FR-036**: A path or a course MAY carry zero or more tags; a tag MAY be attached to any number of paths and courses.
- **FR-037**: A tag's status MUST be one of exactly two values: active or hidden. No draft, archived, or soft-deleted state exists.

### Key Entities *(include if feature involves data)*

- **Tag**: A reusable descriptive label. Attributes visible at the feature level: identifier, name (free-form Arabic text up to a short limit), slug (short, lowercase, hyphen-separated), status (active or hidden), creation time. A tag does not track its last update time. A tag may be referenced by any number of paths and any number of courses.
- **Path–Tag association**: A relationship row linking one path to one tag. A given path–tag pair exists at most once. Removing a tag removes every association row that referenced it.
- **Course–Tag association**: A relationship row linking one course to one tag. A given course–tag pair exists at most once. Removing a tag removes every association row that referenced it.
- **Administrator**: An authenticated user whose role grants access to the administrative tag endpoints. Non-administrators cannot reach those endpoints.
- **Public visitor**: Any caller (authenticated or not) who can only read the public tag list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time public visitor can retrieve the list of active tags with their usage counts in a single request without signing in or performing any other setup.
- **SC-002**: When an administrator creates, renames, hides, or deletes a tag, that change is reflected in the next public tag list response within the cache lifetime window (at most one minute of staleness for downstream HTTP caches).
- **SC-003**: 100% of requests to administrative tag endpoints from non-administrators are rejected.
- **SC-004**: 100% of tags presented in the public list have status active; 0% are hidden.
- **SC-005**: For any set of seeded associations, the path and course counts returned for each active tag match the true number of published paths and published courses attached to it.
- **SC-006**: Deleting a tag that was attached to N paths and M courses removes the tag and all N+M associations in a single operation, verifiable by inspection of the data, with 0 residual association rows.
- **SC-007**: After the atomic replace operation succeeds with a list of K tag identifiers, the owner carries exactly K associations and no others.
- **SC-008**: When the atomic replace operation fails because of an unknown or hidden identifier in the input, the owner's association set is byte-identical to what it was before the call.
- **SC-009**: The atomic replace operation produces the same final state when called twice in succession with identical input (idempotency).
- **SC-010**: Arabic tag names are byte-identical between the create request body and every subsequent read of that tag.
- **SC-011**: Duplicate slugs are rejected in 100% of attempts (both on create and on update), with the existing tag left unchanged.
- **SC-012**: The public tag list returns an empty list (not an error, not a missing payload) in the edge case where no active tags exist.

## Assumptions

- The Tag, path-tag, and course-tag entities and their relationships are already present in the database from the prior data-model migration (KAN-70). This ticket builds on top of them without altering the schema.
- "Published" path and course counts refer specifically to paths and courses whose publication status is "published" (not draft, not archived). Draft and archived content are excluded from counts.
- The existing authentication system is reused; administrators are identified by an administrator role on the already-issued session. If the administrator role or guard does not yet exist in the codebase at the time of implementation, a development-only placeholder guard is used and every usage is marked for replacement when the real administrator mechanism lands.
- A short-lived HTTP cache hint (one minute) is sufficient staleness for the public tag list. A longer application-level cache may be layered on later by the caching ticket; if that ticket has already landed by the time this one is implemented, the public list is cached under a single well-known key and that key is invalidated on every administrative create, update, or delete. If it has not landed, this ticket ships without an application-level cache and marks the intended call sites for later wiring.
- The atomic replace capability is not exposed as a public or admin endpoint in this ticket. It is made available for path- and course-edit tickets to call from inside their own services.
- Public visitors do not need any way to filter the public list by status, by minimum count, or by partial-name search in this ticket. Filtering lives in downstream discovery tickets.
- Tests use the existing test database and test harness established in the prior schema ticket. New test-only fixtures are created inside each test file rather than by modifying the shared seed script.
- The project's database schema, migration history, and already-implemented modules (authentication, users, onboarding, common utilities) are not modified by this ticket.
