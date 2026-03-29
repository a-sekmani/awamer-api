# Data Model: Complete Prisma Schema

**Feature**: 002-prisma-schema
**Date**: 2026-03-29

## Enums (16)

| Enum Name | Values | Used By |
|-----------|--------|---------|
| UserStatus | active, inactive, suspended | User.status |
| Role | learner, admin | UserRole.role |
| CategoryStatus | active, hidden | Category.status |
| PathStatus | draft, published, archived | Path.status |
| CourseStatus | draft, published, archived | Course.status |
| LessonType | text, video, interactive, mixed | Lesson.type |
| ContentFormat | markdown, html, video, code, image, interactive | LessonContentBlock.format |
| EnrollmentStatus | active, completed, paused | PathEnrollment.status |
| ProgressStatus | not_started, in_progress, completed | LessonProgress.status, SectionProgress.status, CourseProgress.status, PathProgress.status |
| QuizType | section_quiz, course_exam | Quiz.type |
| QuestionType | single_choice, multiple_choice | Question.type |
| AttemptStatus | in_progress, passed, failed | QuizAttempt.status |
| SubmissionStatus | submitted, reviewed | ProjectSubmission.status |
| BillingCycle | free, monthly, quarterly, yearly | SubscriptionPlan.billingCycle |
| SubscriptionStatus | active, cancelled, expired, past_due | Subscription.status |
| PaymentStatus | completed, failed, refunded | Payment.status |

## Entities (26)

### User Domain (4 entities)

#### User
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| name | String | required | |
| email | String | required, unique | |
| passwordHash | String | required | Never exposed in API responses |
| country | String | nullable | |
| locale | String | default "ar" | Arabic-first platform |
| status | UserStatus | default active | |
| refreshToken | String | nullable | Stored for JWT refresh flow |
| lastLoginAt | DateTime | nullable | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Relationships**: 1:1 → UserProfile | 1:N → UserRole, OnboardingResponse, PathEnrollment, LessonProgress, SectionProgress, CourseProgress, PathProgress, LastPosition, QuizAttempt, ProjectSubmission, Subscription, Payment, Certificate

#### UserProfile
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User, unique | 1:1 relationship |
| displayName | String | nullable | |
| avatarUrl | String | nullable | |
| background | String | nullable | |
| goals | String | nullable | |
| interests | String | nullable | |
| preferredLanguage | String | nullable | |
| onboardingCompleted | Boolean | default false | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

#### UserRole
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| role | Role | required | |
| createdAt | DateTime | default now() | |

**Composite unique**: (userId, role) — one entry per role per user

#### OnboardingResponse
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| questionKey | String | required | |
| answer | String | required | |
| stepNumber | Int | required | |
| createdAt | DateTime | default now() | |

### Content Hierarchy (6 entities)

#### Category
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| name | String | required | |
| slug | String | required, unique | |
| description | String | nullable | |
| icon | String | nullable | |
| order | Int | default 0 | |
| status | CategoryStatus | default active | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Relationships**: 1:N → Path

#### Path
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| categoryId | UUID | FK → Category | |
| title | String | required | |
| slug | String | required, unique | |
| description | String | nullable | |
| level | String | nullable | |
| thumbnail | String | nullable | |
| estimatedHours | Int | nullable | |
| is_free | Boolean | default false | |
| status | PathStatus | default draft | |
| order | Int | default 0 | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Relationships**: N:1 → Category | 1:N → Course, PathEnrollment, PathProgress, LastPosition, Certificate

#### Course
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| pathId | UUID | FK → Path | |
| title | String | required | |
| description | String | nullable | |
| order | Int | default 0 | |
| is_free | Boolean | default false | |
| status | CourseStatus | default draft | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Relationships**: N:1 → Path | 1:N → Section, Quiz, CourseProgress, LastPosition, Project

#### Section
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| courseId | UUID | FK → Course | |
| title | String | required | |
| order | Int | default 0 | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Relationships**: N:1 → Course | 1:N → Lesson, Quiz, SectionProgress, LastPosition

#### Lesson
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| sectionId | UUID | FK → Section | |
| title | String | required | |
| type | LessonType | required | |
| order | Int | default 0 | |
| is_free | Boolean | default false | |
| estimatedMinutes | Int | nullable | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Relationships**: N:1 → Section | 1:N → LessonContentBlock, LessonProgress, LastPosition

#### LessonContentBlock
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| lessonId | UUID | FK → Lesson | |
| format | ContentFormat | required | |
| body | String | nullable | |
| videoUrl | String | nullable | |
| metadata | Json | nullable | Flexible JSON structure |
| order | Int | default 0 | |
| version | Int | default 1 | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

### Progress & Enrollment (6 entities)

#### PathEnrollment
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| pathId | UUID | FK → Path | |
| status | EnrollmentStatus | default active | |
| enrolledAt | DateTime | default now() | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

#### LessonProgress
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| lessonId | UUID | FK → Lesson | |
| status | ProgressStatus | default not_started | |
| completedAt | DateTime | nullable | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Composite unique**: (userId, lessonId)

#### SectionProgress
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| sectionId | UUID | FK → Section | |
| completedLessons | Int | default 0 | |
| totalLessons | Int | default 0 | |
| percentage | Float | default 0 | |
| status | ProgressStatus | default not_started | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Composite unique**: (userId, sectionId)

#### CourseProgress
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| courseId | UUID | FK → Course | |
| completedSections | Int | default 0 | |
| totalSections | Int | default 0 | |
| percentage | Float | default 0 | |
| status | ProgressStatus | default not_started | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Composite unique**: (userId, courseId)

#### PathProgress
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| pathId | UUID | FK → Path | |
| completedCourses | Int | default 0 | |
| totalCourses | Int | default 0 | |
| percentage | Float | default 0 | |
| status | ProgressStatus | default not_started | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Composite unique**: (userId, pathId)

#### LastPosition
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| pathId | UUID | FK → Path | |
| courseId | UUID | FK → Course | |
| sectionId | UUID | FK → Section | |
| lessonId | UUID | FK → Lesson | |
| accessedAt | DateTime | default now() | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

**Composite unique**: (userId, pathId)

### Assessment (4 entities)

#### Quiz
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| courseId | UUID | FK → Course | |
| sectionId | UUID | FK → Section, nullable | Null for course-level exams |
| title | String | required | |
| type | QuizType | required | |
| passingScore | Int | required | |
| timeLimitMinutes | Int | nullable | |
| questionCount | Int | default 0 | |
| order | Int | default 0 | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

#### Question
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| quizId | UUID | FK → Quiz | |
| body | String | required | |
| type | QuestionType | required | |
| explanation | String | nullable | |
| order | Int | default 0 | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

#### Option
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| questionId | UUID | FK → Question | |
| body | String | required | |
| isCorrect | Boolean | default false | Never exposed in learner API responses |
| order | Int | default 0 | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

#### QuizAttempt
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| quizId | UUID | FK → Quiz | |
| score | Int | nullable | |
| status | AttemptStatus | default in_progress | |
| answers | Json | nullable | Stores submitted answers |
| startedAt | DateTime | default now() | |
| completedAt | DateTime | nullable | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

### Project (2 entities)

#### Project
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| courseId | UUID | FK → Course | |
| title | String | required | |
| description | String | nullable | |
| order | Int | default 0 | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

#### ProjectSubmission
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| projectId | UUID | FK → Project | |
| submissionData | Json | required | |
| status | SubmissionStatus | default submitted | |
| submittedAt | DateTime | default now() | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

### Subscription & Payment (3 entities)

#### SubscriptionPlan
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| name | String | required | |
| billingCycle | BillingCycle | required | |
| price | Float | required | |
| currency | String | default "USD" | |
| durationDays | Int | required | |
| isDefault | Boolean | default false | |
| stripePriceId | String | nullable | |
| status | CategoryStatus | default active | Reuses active/hidden status |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

#### Subscription
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| planId | UUID | FK → SubscriptionPlan | |
| status | SubscriptionStatus | default active | |
| stripeSubscriptionId | String | nullable | |
| stripeCustomerId | String | nullable | |
| currentPeriodStart | DateTime | nullable | |
| currentPeriodEnd | DateTime | nullable | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

#### Payment
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| subscriptionId | UUID | FK → Subscription | |
| planId | UUID | FK → SubscriptionPlan | |
| amount | Float | required | |
| currency | String | default "USD" | |
| status | PaymentStatus | required | |
| stripePaymentIntentId | String | nullable | |
| paidAt | DateTime | nullable | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

### Certificate (1 entity)

#### Certificate
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| userId | UUID | FK → User | |
| pathId | UUID | FK → Path | |
| certificateCode | String | required, unique | For public verification |
| certificateUrl | String | nullable | |
| issuedAt | DateTime | default now() | |
| createdAt | DateTime | default now() | |
| updatedAt | DateTime | auto-updated | |

## Relationship Summary

```
User 1:1 UserProfile
User 1:N UserRole, OnboardingResponse
User 1:N PathEnrollment, LessonProgress, SectionProgress, CourseProgress, PathProgress, LastPosition
User 1:N QuizAttempt, ProjectSubmission
User 1:N Subscription, Payment, Certificate

Category 1:N Path
Path 1:N Course
Course 1:N Section
Section 1:N Lesson
Lesson 1:N LessonContentBlock

Path 1:N PathEnrollment, PathProgress, LastPosition, Certificate
Course 1:N CourseProgress, LastPosition, Quiz, Project
Section 1:N SectionProgress, LastPosition, Quiz
Lesson 1:N LessonProgress, LastPosition

Quiz 1:N Question
Question 1:N Option
Quiz 1:N QuizAttempt

Project 1:N ProjectSubmission

SubscriptionPlan 1:N Subscription, Payment
Subscription 1:N Payment
```