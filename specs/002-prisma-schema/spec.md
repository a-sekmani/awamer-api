# Feature Specification: Complete Prisma Schema from Data Model

**Feature Branch**: `002-prisma-schema`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "Create a complete Prisma schema defining all 26 entities for the Awamer educational platform, with full field definitions, relationships, enums, and constraints as specified in the data model."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Sets Up the Database Schema (Priority: P1)

A developer cloning the project for the first time needs a complete, valid data model so they can run a single migration command and have a fully structured database ready for development. The schema must define all 26 entities with correct fields, types, relationships, and constraints.

**Why this priority**: Without the schema, no other feature (auth, content management, progress tracking, payments) can be built. This is the foundational data layer.

**Independent Test**: Can be tested by running the schema migration against an empty database and verifying all 26 tables are created with correct columns, constraints, and foreign keys.

**Acceptance Scenarios**:

1. **Given** an empty database and the Prisma schema, **When** a developer runs the migration, **Then** all 26 tables are created successfully with no errors.
2. **Given** the migrated database, **When** a developer inspects the schema, **Then** every table has the correct columns, data types, and constraints as defined in the data model.
3. **Given** the migrated database, **When** a developer inspects foreign keys, **Then** all relationships (one-to-one, one-to-many) are correctly enforced.

---

### User Story 2 - Content Structure Integrity (Priority: P1)

The content hierarchy (Category > Path > Course > Section > Lesson > LessonContentBlock) must be correctly modeled so that content can be organized, queried, and navigated in the proper order. Cascading deletes must propagate correctly through the hierarchy.

**Why this priority**: The content hierarchy is the core domain model. If relationships are wrong, the entire platform's content browsing and learning experience breaks.

**Independent Test**: Can be tested by creating a full content chain (Category through LessonContentBlock) and verifying parent-child relationships, ordering, and cascade behavior.

**Acceptance Scenarios**:

1. **Given** a Category exists, **When** a Path is created referencing that Category, **Then** the relationship is correctly stored and queryable in both directions.
2. **Given** a full content chain exists, **When** the parent Category is deleted, **Then** all descendant records (Paths, Courses, Sections, Lessons, ContentBlocks) are also removed.
3. **Given** multiple items at the same level, **When** queried, **Then** items can be sorted by their `order` field.

---

### User Story 3 - User and Progress Data Integrity (Priority: P1)

User accounts, profiles, roles, and all progress tracking entities must be correctly related so that a learner's journey through the platform is accurately tracked from enrollment through certification.

**Why this priority**: User identity and progress tracking are essential for a personalized learning experience and for gating access to content.

**Independent Test**: Can be tested by creating a user with profile and roles, enrolling in a path, and verifying progress entities are correctly linked.

**Acceptance Scenarios**:

1. **Given** a User is created, **When** a UserProfile and UserRole are associated, **Then** the one-to-one (profile) and one-to-many (roles) relationships are enforced.
2. **Given** a user is enrolled in a path, **When** progress records are created for lessons, sections, courses, and the path, **Then** all progress records correctly reference both the user and the corresponding content entity.
3. **Given** a user has completed a path, **When** a Certificate is issued, **Then** the certificate references both the user and the path with a unique certificate code.

---

### User Story 4 - Assessment and Subscription Data Integrity (Priority: P2)

Quizzes (with questions, options, and attempts) and subscription/payment entities must be correctly modeled so that assessments can be graded and subscriptions can be managed.

**Why this priority**: Assessments validate learning outcomes and subscriptions drive revenue. Both depend on correct data relationships but are secondary to the core content and user models.

**Independent Test**: Can be tested by creating a quiz with questions and options, then creating an attempt; and by creating a subscription plan, subscription, and payment record.

**Acceptance Scenarios**:

1. **Given** a Quiz with Questions and Options exists, **When** a QuizAttempt is created, **Then** it correctly references the user and quiz with proper status tracking.
2. **Given** a SubscriptionPlan exists, **When** a Subscription and Payment are created, **Then** all monetary and status fields are correctly typed and constrained.
3. **Given** quiz options exist, **When** the `isCorrect` field is set, **Then** the boolean is stored correctly for grading logic.

---

### Edge Cases

- What happens when a referenced parent entity is deleted? Cascading deletes must propagate correctly through the content hierarchy and related progress/enrollment records.
- What happens when a user has multiple roles? The UserRole model must support multiple role entries per user without duplication (composite unique constraint on userId + role).
- What happens when two entities share a slug? Unique constraints on slug fields (Category, Path) must prevent duplicates.
- What happens when optional fields are null? Nullable fields (e.g., sectionId on Quiz, videoUrl on LessonContentBlock) must accept null values without errors.
- What happens when a UUID is used as a primary key? All IDs must be generated as UUIDs by default.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST define all 26 entities as individual models with UUID primary keys and appropriate field types (String, Int, Float, Boolean, DateTime, Json, Enum).
- **FR-002**: System MUST define all enum types: UserStatus, Role, CategoryStatus, PathStatus, CourseStatus, LessonType, ContentFormat, EnrollmentStatus, ProgressStatus, QuizType, QuestionType, AttemptStatus, SubmissionStatus, BillingCycle, SubscriptionStatus, PaymentStatus.
- **FR-003**: System MUST enforce unique constraints on: User.email, Category.slug, Path.slug, Certificate.certificateCode.
- **FR-004**: System MUST define one-to-one relationships: User to UserProfile.
- **FR-005**: System MUST define one-to-many relationships throughout the content hierarchy: Category to Paths, Path to Courses, Course to Sections, Section to Lessons, Lesson to LessonContentBlocks.
- **FR-006**: System MUST define one-to-many relationships for user data: User to UserRoles, User to OnboardingResponses, User to PathEnrollments, User to all progress records, User to QuizAttempts, User to ProjectSubmissions, User to Subscriptions, User to Payments, User to Certificates.
- **FR-007**: System MUST define composite unique constraints where appropriate: UserRole (userId + role), LessonProgress (userId + lessonId), SectionProgress (userId + sectionId), CourseProgress (userId + courseId), PathProgress (userId + pathId), LastPosition (userId + pathId).
- **FR-008**: System MUST set default values: UUID generation for all id fields, `now()` for createdAt/updatedAt timestamps, default enum values where specified (e.g., locale defaults to "ar").
- **FR-009**: System MUST support cascading deletes through the content hierarchy so that removing a parent entity removes all dependent child records.
- **FR-010**: System MUST define Json fields for: LessonContentBlock.metadata, QuizAttempt.answers, ProjectSubmission.submissionData.
- **FR-011**: System MUST define nullable fields where the data model indicates optional data (e.g., Quiz.sectionId, User.lastLoginAt, various URL fields).
- **FR-012**: System MUST include `createdAt` and `updatedAt` timestamp fields on all entities that track record lifecycle.
- **FR-013**: System MUST define appropriate indexes for commonly queried foreign key fields and unique constraints to support efficient data access.

### Key Entities

- **User**: Central identity entity with email-based authentication credentials, locale preference, and status tracking. Related one-to-one with UserProfile, one-to-many with UserRole, and connected to all learner activity entities.
- **Content Hierarchy (Category > Path > Course > Section > Lesson > LessonContentBlock)**: Six-level nested structure representing the educational content organization. Each level has an `order` field for sequencing and a `status` field for visibility control.
- **Progress Entities (PathEnrollment, LessonProgress, SectionProgress, CourseProgress, PathProgress, LastPosition)**: Track a learner's advancement through the content hierarchy at every level, from individual lesson completion to overall path progress and last accessed position.
- **Assessment Entities (Quiz, Question, Option, QuizAttempt)**: Support quizzes and exams at section and course level with multiple question types, auto-grading via correct option flags, and attempt tracking.
- **Project Entities (Project, ProjectSubmission)**: Course-level project assignments with learner submission tracking and review status.
- **Subscription Entities (SubscriptionPlan, Subscription, Payment)**: Manage freemium access with plan definitions, active subscription state, and payment history linked to external payment processing.
- **Certificate**: Issued upon path completion with a unique verification code and URL.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 26 entities are successfully created in the database from a single migration run with zero errors.
- **SC-002**: All defined relationships (one-to-one, one-to-many) are enforceable -- inserting a record with an invalid foreign key reference is rejected by the database.
- **SC-003**: All unique constraints are enforced -- attempting to insert duplicate values for email, slug, or certificate code fields results in a constraint violation error.
- **SC-004**: All 26 entities are accessible through the generated client with full type safety -- developers can perform create, read, update, and delete operations on every entity.
- **SC-005**: The content hierarchy supports 6 levels of nesting (Category through LessonContentBlock) with correct parent-child traversal in both directions.
- **SC-006**: Progress tracking entities support concurrent tracking for at least 1,000 enrolled users per path without data integrity issues.

## Assumptions

- The database is PostgreSQL as indicated by the project configuration.
- UUIDs are the standard primary key format across all entities, generated automatically.
- The default locale "ar" (Arabic) reflects the platform's Arabic-first market targeting Saudi Arabia.
- Cascading deletes are appropriate for the content hierarchy (deleting a Category removes all downstream content). For user-related data, cascading behavior follows standard patterns (deleting a user removes their progress, attempts, and submissions).
- The `is_free` boolean fields on Path, Course, and Lesson use snake_case as defined in the data model, mapped accordingly in the schema.
- Timestamps (createdAt, updatedAt) are automatically managed, with updatedAt auto-updating on record modification.
- The Json type is used for flexible/unstructured data fields (metadata, answers, submissionData) where the schema is intentionally open.
- Enum values are derived from the status and type fields described in the data model (e.g., ProgressStatus includes not_started, in_progress, completed).
- Refresh tokens are stored in the database as part of the User entity, consistent with the JWT refresh token flow described in the authentication design.
- All field names, types, relationships, and constraints are taken directly from the Data Model section of CLAUDE.md and are considered authoritative.
