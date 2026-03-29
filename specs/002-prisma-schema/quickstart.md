# Quickstart: Complete Prisma Schema

**Feature**: 002-prisma-schema
**Date**: 2026-03-29

## Prerequisites

- Node.js 20 LTS installed
- PostgreSQL 15+ running and accessible
- `.env` file with valid `DATABASE_URL` (e.g., `postgresql://user:pass@localhost:5432/awamer`)
- Dependencies installed (`npm install`)

## What This Feature Does

Defines the complete database schema for the Awamer platform in `prisma/schema.prisma`:
- 26 Prisma models covering users, content, progress, assessments, subscriptions, and certificates
- 16 enums for type-safe status and category fields
- All relationships, indexes, unique constraints, and cascade rules

## Quick Setup

```bash
# 1. Run the initial migration (creates all 26 tables)
npx prisma migrate dev --name init

# 2. Generate the Prisma client (types + query builder)
npx prisma generate
```

## Verify

```bash
# Open Prisma Studio to browse all tables
npx prisma studio

# Or check migration status
npx prisma migrate status
```

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | All 26 models, 16 enums, relationships |
| `prisma/migrations/` | Auto-generated SQL migrations |
| `src/prisma/prisma.service.ts` | Existing NestJS PrismaService (no changes needed) |

## Entity Count Verification

After migration, verify 26 tables exist:

| Domain | Entities | Count |
|--------|----------|-------|
| User | User, UserProfile, UserRole, OnboardingResponse | 4 |
| Content | Category, Path, Course, Section, Lesson, LessonContentBlock | 6 |
| Progress | PathEnrollment, LessonProgress, SectionProgress, CourseProgress, PathProgress, LastPosition | 6 |
| Assessment | Quiz, Question, Option, QuizAttempt | 4 |
| Project | Project, ProjectSubmission | 2 |
| Subscription | SubscriptionPlan, Subscription, Payment | 3 |
| Certificate | Certificate | 1 |
| **Total** | | **26** |