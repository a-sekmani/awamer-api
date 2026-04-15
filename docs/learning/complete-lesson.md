# Complete Lesson — Backend Spec (awamer-api)

> **Module:** `LearningModule`
> **Endpoint:** `POST /api/v1/learning/lessons/:lessonId/complete`
> **Guards:** `JwtAuthGuard` → `EnrollmentGuard` → `ContentAccessGuard` (in that order)
> **Status code:** `200 OK`

---

## 1. Summary

The one learning endpoint. A learner posts this to mark a lesson as
completed. The handler delegates to `ProgressService.completeLesson`,
which runs the full progress cascade and returns every affected
progress row plus any certificates newly issued by the call.

This is the only entry point that kicks the progress cascade and
the certificate-issuance cascade — see
[progress-cascade.md](./progress-cascade.md) and
[../certificates/dual-level-issuance.md](../certificates/dual-level-issuance.md).

---

## 2. Request

```
POST /api/v1/learning/lessons/:lessonId/complete
Cookie: access_token=<JWT>
```

- `:lessonId` must be a UUID — enforced by `ParseUUIDPipe`.
- No body.

---

## 3. Guard chain — order matters

```ts
@UseGuards(JwtAuthGuard, EnrollmentGuard, ContentAccessGuard)
```

The three guards are listed explicitly at the method level (rather
than inherited from the controller) so the evaluation order is
deterministic and reviewable. Decision 9 + FR-025 in
`learning.controller.ts`. See:

- [../enrollment/enrollment-guard.md](../enrollment/enrollment-guard.md)
- [content-access-guard.md](./content-access-guard.md)

The reason for the order: enrollment must be rejected before the
paywall runs so `ContentAccessGuard` never has a chance to leak
free/paid state to a non-enrolled caller.

---

## 4. Behavior — `ProgressService.completeLesson(userId, lessonId)`

Full cascade logic lives in
[progress-cascade.md](./progress-cascade.md). High-level summary:

1. **Idempotent short-circuit.** If `LessonProgress` already exists
   with `status: COMPLETED`, load and return the current aggregate
   state without writing anything and without issuing any
   certificates.
2. **Resolve lesson → section → course** (and `course.pathId`)
   before opening the transaction.
3. **Capture pre-existing certificates** for the target scopes, so
   the cascade can later distinguish "newly issued by this call"
   from "already existed".
4. **Run the cascade transaction:** upsert `LessonProgress`,
   recalculate `SectionProgress`, `CourseProgress`, and (if
   path-owned) `PathProgress`; update `LastPosition`; check course-
   and path-level certificate eligibility.
5. **Return** `CompleteLessonResult` — every updated row plus
   `certificatesIssued: Certificate[]`.

---

## 5. Successful response

```json
{
  "data": {
    "lessonProgress": {
      "id": "...",
      "userId": "...",
      "lessonId": "...",
      "status": "COMPLETED",
      "completedAt": "ISO",
      "createdAt": "ISO",
      "updatedAt": "ISO"
    },
    "sectionProgress": {
      "sectionId": "...",
      "completedLessons": 3,
      "totalLessons": 5,
      "percentage": 60,
      "status": "IN_PROGRESS"
    },
    "courseProgress": {
      "courseId": "...",
      "completedSections": 1,
      "totalSections": 4,
      "percentage": 25,
      "status": "IN_PROGRESS"
    },
    "pathProgress": null,
    "certificatesIssued": []
  },
  "message": "Success"
}
```

- `pathProgress` is `null` for standalone courses (no parent path).
- `certificatesIssued` is empty unless this specific call produced
  a new course-cert or path-cert (i.e., was the final lesson
  needed to complete a course and/or path).
- The raw Prisma entities are returned; dates become ISO strings
  via the global class-serializer. There is no separate response
  DTO — `CompleteLessonResult` is the only typed contract for this
  shape (see the class comment on `ProgressService`).

---

## 6. Error responses

| Status | When |
|--------|------|
| `400 VALIDATION_FAILED` | `:lessonId` not a UUID. |
| `401`  | Missing/invalid access token. |
| `403`  | `EnrollmentGuard`: `Not enrolled`. |
| `403`  | `ContentAccessGuard`: `{ reason: 'subscription_required', upgradeUrl: '/plus' }` (once the subscription check is real). |
| `404`  | `Lesson '${lessonId}' not found` (from the guard, the service, or the cascade's sub-helpers). |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Unexpected Prisma error inside the transaction. |

The two passthrough fields (`reason`, `upgradeUrl`) on the 403 from
`ContentAccessGuard` are surfaced by `HttpExceptionFilter` — see
[../api-conventions.md §3](../api-conventions.md).

---

## 7. Side effects

| Table | Mutation |
|-------|----------|
| `lesson_progress` | UPSERT → COMPLETED |
| `section_progress` | UPSERT (recalculated) |
| `course_progress` | UPSERT (recalculated) |
| `path_progress` | UPSERT (recalculated, path-owned courses only) |
| `last_positions` | INSERT or UPDATE (scope resolved dynamically) |
| `certificates` | INSERT (0, 1, or 2 — course and/or path) |

All in one `prisma.$transaction`. If any step throws, nothing
commits.

Plus analytics: `certificate_issued` fires inside
`CertificatesService.issueCertificate` whenever a row is inserted
— see [../certificates/dual-level-issuance.md](../certificates/dual-level-issuance.md) §4.

---

## 8. Files involved

| File | Role |
|------|------|
| `src/learning/learning.controller.ts` | Route + guard chain declaration |
| `src/progress/progress.service.ts` | `completeLesson()` and the cascade helpers |
| `src/certificates/certificates.service.ts` | Eligibility checks called from inside the cascade |
| `src/common/guards/enrollment.guard.ts` | Guard #2 |
| `src/common/guards/content-access.guard.ts` | Guard #3 |

---

## 9. Tests

| File | Covers |
|------|--------|
| `src/progress/progress.service.spec.ts` | Happy-path cascade for a path-owned course; cascade for a standalone course (`pathProgress: null`); idempotent re-complete returns current state without writes; lesson-not-found; course-cert issuance on final lesson; path-cert issuance when the final lesson also completes the final course of the path; both-issued classification via the pre-existing capture. |
| `test/content/learning/*.e2e-spec.ts` | Full HTTP + guard-chain round-trip, including 403 without enrollment and 200 with a seeded enrollment. |

---

## 10. Things NOT to change without coordination

- The guard order. See §3.
- The "raw Prisma entities in the response" choice. Introducing a
  response DTO here would require the frontend to re-parse every
  field.
- The single-transaction cascade. Splitting it would re-open every
  race that the current design closes.
- The idempotent short-circuit. Without it, re-completing a
  lesson would double-count `completedLessons`.
- The `certificatesIssued` classification (pre-call capture → post-
  transaction diff). This is the only mechanism that tells the
  frontend "you just earned this" vs. "this already existed".
