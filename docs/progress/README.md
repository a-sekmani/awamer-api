# Progress — Index

Progress bookkeeping helper module. No HTTP surface — the class
is consumed by `LearningController`. Reads of progress aggregates
are served via the enrollment endpoints.

| File | Purpose |
|------|---------|
| [progress-service.md](./progress-service.md) | `ProgressService` class reference — `completeLesson`, `CompleteLessonResult`, public recalculate helpers, why there are no `/progress/*` routes |

The full step-by-step cascade lives in
[../learning/progress-cascade.md](../learning/progress-cascade.md).
