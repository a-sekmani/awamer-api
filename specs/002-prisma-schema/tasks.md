# Tasks: Complete Prisma Schema from Data Model

**Input**: Design documents from `/specs/002-prisma-schema/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story. All schema work targets `prisma/schema.prisma`. Since this is a single-file feature, tasks represent logical model groups added sequentially to the same file.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define all enums needed by the 26 models

- [x] T001 Define all 16 enum types (UserStatus, Role, CategoryStatus, PathStatus, CourseStatus, LessonType, ContentFormat, EnrollmentStatus, ProgressStatus, QuizType, QuestionType, AttemptStatus, SubmissionStatus, BillingCycle, SubscriptionStatus, PaymentStatus) in `prisma/schema.prisma`. Use PascalCase enum names with snake_case `@map` values as documented in `specs/002-prisma-schema/research.md` (Decision #3). Values for each enum are defined in `specs/002-prisma-schema/data-model.md` under the Enums table.

**Checkpoint**: All 16 enums defined. No models yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define User domain models — all other entities depend on User via foreign keys

**CRITICAL**: No user story work can begin until User and related models exist

- [x] T002 Define User model with all fields (id, name, email, passwordHash, country, locale, status, refreshToken, lastLoginAt, createdAt, updatedAt) and `@@map("users")` in `prisma/schema.prisma`. Include `@id @default(uuid())`, `@unique` on email, `@default("ar")` on locale, `@default(ACTIVE)` on status. Add all relation fields as empty arrays (to be connected as downstream models are added). Reference field details in `specs/002-prisma-schema/data-model.md` under User.
- [x] T003 Define UserProfile model (id, userId, displayName, avatarUrl, background, goals, interests, preferredLanguage, onboardingCompleted, createdAt, updatedAt) with 1:1 relation to User (`@unique` on userId, `onDelete: Cascade`) and `@@map("user_profiles")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under UserProfile.
- [x] T004 Define UserRole model (id, userId, role, createdAt) with FK to User (`onDelete: Cascade`), `@@unique([userId, role])`, and `@@map("user_roles")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under UserRole.
- [x] T005 Define OnboardingResponse model (id, userId, questionKey, answer, stepNumber, createdAt) with FK to User (`onDelete: Cascade`) and `@@map("onboarding_responses")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under OnboardingResponse.

**Checkpoint**: User domain complete (4 models). All downstream models can reference User.

---

## Phase 3: User Story 2 — Content Structure Integrity (Priority: P1)

**Goal**: Define the 6-level content hierarchy (Category > Path > Course > Section > Lesson > LessonContentBlock) with cascading relationships and ordering.

**Independent Test**: Create a full content chain from Category through LessonContentBlock; verify parent-child relationships and cascade deletes.

### Implementation for User Story 2

- [x] T006 [US2] Define Category model (id, name, slug, description, icon, order, status, createdAt, updatedAt) with `@unique` on slug, `@default(0)` on order, `@default(ACTIVE)` on status, and `@@map("categories")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Category.
- [x] T007 [US2] Define Path model (id, categoryId, title, slug, description, level, thumbnail, estimatedHours, is_free, status, order, createdAt, updatedAt) with FK to Category (`onDelete: Cascade`), `@unique` on slug, `@default(false)` on is_free, `@default(DRAFT)` on status, and `@@map("paths")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Path.
- [x] T008 [US2] Define Course model (id, pathId, title, description, order, is_free, status, createdAt, updatedAt) with FK to Path (`onDelete: Cascade`), `@default(DRAFT)` on status, and `@@map("courses")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Course.
- [x] T009 [US2] Define Section model (id, courseId, title, order, createdAt, updatedAt) with FK to Course (`onDelete: Cascade`) and `@@map("sections")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Section.
- [x] T010 [US2] Define Lesson model (id, sectionId, title, type, order, is_free, estimatedMinutes, createdAt, updatedAt) with FK to Section (`onDelete: Cascade`), LessonType enum for type, and `@@map("lessons")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Lesson.
- [x] T011 [US2] Define LessonContentBlock model (id, lessonId, format, body, videoUrl, metadata, order, version, createdAt, updatedAt) with FK to Lesson (`onDelete: Cascade`), ContentFormat enum for format, `Json?` for metadata, and `@@map("lesson_content_blocks")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under LessonContentBlock.

**Checkpoint**: Content hierarchy complete (6 models). Can create Category → Path → Course → Section → Lesson → LessonContentBlock chains with cascading deletes.

---

## Phase 4: User Story 3 — User and Progress Data Integrity (Priority: P1)

**Goal**: Define enrollment and progress tracking entities so a learner's journey from enrollment through certification is tracked at every level.

**Independent Test**: Create a user, enroll in a path, create progress records at all levels, and issue a certificate; verify all relationships and composite unique constraints.

### Implementation for User Story 3

- [x] T012 [US3] Define PathEnrollment model (id, userId, pathId, status, enrolledAt, createdAt, updatedAt) with FKs to User and Path (`onDelete: Cascade`), `@default(ACTIVE)` on status, and `@@map("path_enrollments")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under PathEnrollment.
- [x] T013 [US3] Define LessonProgress model (id, userId, lessonId, status, completedAt, createdAt, updatedAt) with FKs to User and Lesson (`onDelete: Cascade`), `@@unique([userId, lessonId])`, `@default(NOT_STARTED)` on status, and `@@map("lesson_progress")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under LessonProgress.
- [x] T014 [US3] Define SectionProgress model (id, userId, sectionId, completedLessons, totalLessons, percentage, status, createdAt, updatedAt) with FKs to User and Section (`onDelete: Cascade`), `@@unique([userId, sectionId])`, `@default(NOT_STARTED)` on status, and `@@map("section_progress")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under SectionProgress.
- [x] T015 [US3] Define CourseProgress model (id, userId, courseId, completedSections, totalSections, percentage, status, createdAt, updatedAt) with FKs to User and Course (`onDelete: Cascade`), `@@unique([userId, courseId])`, `@default(NOT_STARTED)` on status, and `@@map("course_progress")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under CourseProgress.
- [x] T016 [US3] Define PathProgress model (id, userId, pathId, completedCourses, totalCourses, percentage, status, createdAt, updatedAt) with FKs to User and Path (`onDelete: Cascade`), `@@unique([userId, pathId])`, `@default(NOT_STARTED)` on status, and `@@map("path_progress")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under PathProgress.
- [x] T017 [US3] Define LastPosition model (id, userId, pathId, courseId, sectionId, lessonId, accessedAt, createdAt, updatedAt) with FKs to User, Path, Course, Section, and Lesson (`onDelete: Cascade`), `@@unique([userId, pathId])`, and `@@map("last_positions")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under LastPosition.
- [x] T018 [US3] Define Certificate model (id, userId, pathId, certificateCode, certificateUrl, issuedAt, createdAt, updatedAt) with FKs to User and Path (`onDelete: Cascade`), `@unique` on certificateCode, and `@@map("certificates")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Certificate.

**Checkpoint**: Progress and enrollment complete (7 models). Can track a learner's full journey from enrollment to certification.

---

## Phase 5: User Story 4 — Assessment and Subscription Data Integrity (Priority: P2)

**Goal**: Define quiz/assessment entities and subscription/payment entities so that learning outcomes can be validated and revenue can be managed.

**Independent Test**: Create a quiz with questions and options, submit an attempt; create a subscription plan, subscription, and payment record.

### Implementation for User Story 4

- [x] T019 [US4] Define Quiz model (id, courseId, sectionId, title, type, passingScore, timeLimitMinutes, questionCount, order, createdAt, updatedAt) with FK to Course (`onDelete: Cascade`), optional FK to Section (`onDelete: Cascade`), QuizType enum, and `@@map("quizzes")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Quiz.
- [x] T020 [US4] Define Question model (id, quizId, body, type, explanation, order, createdAt, updatedAt) with FK to Quiz (`onDelete: Cascade`), QuestionType enum, and `@@map("questions")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Question.
- [x] T021 [US4] Define Option model (id, questionId, body, isCorrect, order, createdAt, updatedAt) with FK to Question (`onDelete: Cascade`), `@default(false)` on isCorrect, and `@@map("options")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Option.
- [x] T022 [US4] Define QuizAttempt model (id, userId, quizId, score, status, answers, startedAt, completedAt, createdAt, updatedAt) with FKs to User and Quiz (`onDelete: Cascade`), AttemptStatus enum, `Json?` for answers, and `@@map("quiz_attempts")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under QuizAttempt.
- [x] T023 [US4] Define Project model (id, courseId, title, description, order, createdAt, updatedAt) with FK to Course (`onDelete: Cascade`) and `@@map("projects")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Project.
- [x] T024 [US4] Define ProjectSubmission model (id, userId, projectId, submissionData, status, submittedAt, createdAt, updatedAt) with FKs to User and Project (`onDelete: Cascade`), `Json` for submissionData, SubmissionStatus enum, and `@@map("project_submissions")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under ProjectSubmission.
- [x] T025 [US4] Define SubscriptionPlan model (id, name, billingCycle, price, currency, durationDays, isDefault, stripePriceId, status, createdAt, updatedAt) with BillingCycle enum, `@default("USD")` on currency, `@default(false)` on isDefault, and `@@map("subscription_plans")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under SubscriptionPlan.
- [x] T026 [US4] Define Subscription model (id, userId, planId, status, stripeSubscriptionId, stripeCustomerId, currentPeriodStart, currentPeriodEnd, createdAt, updatedAt) with FKs to User (`onDelete: Cascade`) and SubscriptionPlan, SubscriptionStatus enum, and `@@map("subscriptions")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Subscription.
- [x] T027 [US4] Define Payment model (id, userId, subscriptionId, planId, amount, currency, status, stripePaymentIntentId, paidAt, createdAt, updatedAt) with FKs to User (`onDelete: Cascade`), Subscription, and SubscriptionPlan, PaymentStatus enum, and `@@map("payments")` in `prisma/schema.prisma`. Reference `specs/002-prisma-schema/data-model.md` under Payment.

**Checkpoint**: Assessment and subscription complete (9 models). Total: 26 models defined.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete schema, run migration, and generate client

- [x] T028 Review all 26 models in `prisma/schema.prisma` for completeness: verify all relation fields have matching back-references, all `onDelete: Cascade` rules are set on content hierarchy and user-owned records, all composite `@@unique` constraints are present (UserRole, LessonProgress, SectionProgress, CourseProgress, PathProgress, LastPosition), and all `@@map` table name mappings use snake_case plurals. Cross-reference against `specs/002-prisma-schema/data-model.md` relationship summary.
- [x] T029 Add `@@index` annotations on high-traffic foreign key columns: userId on all user-owned models, categoryId on Path, pathId on Course, courseId on Section/Quiz/Project, sectionId on Lesson, lessonId on LessonContentBlock, quizId on Question/QuizAttempt, questionId on Option, projectId on ProjectSubmission, planId on Subscription/Payment, subscriptionId on Payment in `prisma/schema.prisma`.
- [x] T030 Run `npx prisma validate` to confirm schema is syntactically correct and all relationships resolve. Fix any errors in `prisma/schema.prisma`.
- [x] T031 Run `npx prisma migrate dev --name init` to generate and apply the initial migration to the database. Verify all 26 tables are created in `prisma/migrations/`.
- [x] T032 Run `npx prisma generate` to generate the Prisma client. Verify the client types are available for import in TypeScript files.
- [x] T033 Run quickstart.md validation: open Prisma Studio (`npx prisma studio`) or run `npx prisma migrate status` to confirm all 26 tables exist and migration is applied. Cross-reference table count against `specs/002-prisma-schema/quickstart.md` entity count table.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — define enums first
- **Foundational (Phase 2)**: Depends on Phase 1 (enums must exist for User.status, UserRole.role)
- **User Story 2 (Phase 3)**: Depends on Phase 2 (Path references no user models, but enums needed)
- **User Story 3 (Phase 4)**: Depends on Phase 2 (User) AND Phase 3 (content models for FK references)
- **User Story 4 (Phase 5)**: Depends on Phase 2 (User) AND Phase 3 (Course, Section for Quiz/Project FKs)
- **Polish (Phase 6)**: Depends on all previous phases — all 26 models must be defined

### User Story Dependencies

- **User Story 2 (P1)**: Can start after Foundational (Phase 2). No dependency on other stories.
- **User Story 3 (P1)**: Depends on User Story 2 (progress models reference content hierarchy entities).
- **User Story 4 (P2)**: Depends on User Story 2 (Quiz/Project reference Course/Section). Independent of User Story 3.

### Within Each Phase

Since all tasks write to the same file (`prisma/schema.prisma`), tasks within a phase are **sequential** — no parallel execution within phases.

### Execution Order

```
Phase 1 (T001) → Phase 2 (T002-T005) → Phase 3 (T006-T011) → Phase 4 (T012-T018) ─┐
                                         └→ Phase 5 (T019-T027) ←────────────────────┘
                                                          └→ Phase 6 (T028-T033)
```

Note: Phase 4 and Phase 5 can run after Phase 3, but since they target the same file, they must run sequentially in practice.

---

## Implementation Strategy

### MVP First (User Story 2 — Content Hierarchy)

1. Complete Phase 1: Enums (T001)
2. Complete Phase 2: User domain (T002-T005)
3. Complete Phase 3: Content hierarchy (T006-T011)
4. **STOP and VALIDATE**: Run `npx prisma validate` — schema should be valid with 10 models
5. Can migrate and start building content CRUD

### Full Delivery (All 26 Models)

1. Complete all phases sequentially: T001 → T033
2. Single migration captures all 26 models
3. Validate via quickstart.md checklist

### Recommended Approach

Execute all tasks in a single pass (T001 → T033) since this is a foundational schema feature. All 26 models are needed before any NestJS module can be fully implemented. The migration should capture the complete schema in one `init` migration.

---

## Notes

- All tasks target `prisma/schema.prisma` — a single file feature
- No [P] markers used because all tasks write to the same file (no parallel execution possible)
- [Story] labels map tasks to spec.md user stories for traceability
- Commit after each phase completion for incremental progress tracking
- The `npx prisma migrate dev --name init` in T031 creates the single initial migration
- The `npx prisma generate` in T032 makes all 26 models available as typed Prisma client classes