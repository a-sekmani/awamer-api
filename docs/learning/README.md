# Learning — Index

The single HTTP entry point that kicks the progress cascade, plus
the two guards that protect it and the detailed cascade flow.

## Endpoint

| File | Purpose |
|------|---------|
| [complete-lesson.md](./complete-lesson.md) | `POST /api/v1/learning/lessons/:lessonId/complete` — the only learning route |

## Guards

| File | Purpose |
|------|---------|
| [content-access-guard.md](./content-access-guard.md) | `ContentAccessGuard` — constitutional `isFree` cascade, standalone-course branch, subscription stub |

(See [../enrollment/enrollment-guard.md](../enrollment/enrollment-guard.md)
for `EnrollmentGuard`, which runs before `ContentAccessGuard` in
the chain.)

## Flow

| File | Purpose |
|------|---------|
| [progress-cascade.md](./progress-cascade.md) | Full reference for `ProgressService.completeLesson` — idempotent short-circuit, pre-capture of certificates, the atomic transaction, and the classification of newly-issued vs existing certificates |
