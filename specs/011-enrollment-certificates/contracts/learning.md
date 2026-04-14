# Contract — Learning endpoint

**Base**: `/api/v1`

This feature ships exactly one learning HTTP route. Its sole purpose is to provide a real-world target for the guard-chain DoD test (ticket §12 item 13) and to give the progress cascade an HTTP surface. Additional learning endpoints (e.g. listing lessons, starting a lesson) are out of scope for this ticket and will be delivered by KAN-26 or a follow-up.

---

## POST /learning/lessons/:lessonId/complete — Mark a lesson complete

**Guards (applied in this order)**
1. `JwtAuthGuard` — populates `req.user` (already global, listed explicitly here for determinism)
2. `EnrollmentGuard` — rejects any non-`ACTIVE` enrollment (403). Extracts `lessonId` from params, resolves lesson→section→course, and calls `EnrollmentService.hasAccessToCourse`.
3. `ContentAccessGuard` — runs the `isFree` cascade (lesson → course → parent path) and, failing that, the subscription check (currently stubbed to allow with `TODO(subscriptions)`). Standalone courses skip the parent-path step.

Only requests that pass ALL three guards reach the handler.

**Params**
- `lessonId` — UUID (validated with `ParseUUIDPipe`)

**Body**: empty.

**Handler**
```ts
return this.progressService.completeLesson(req.user.id, lessonId);
```

**Side effects** (single `prisma.$transaction` inside `ProgressService.completeLesson`, or a pre-transaction no-op if the lesson is already completed per Decision 3):
1. Upsert `LessonProgress` → `COMPLETED`, `completedAt = now()`.
2. Recalculate `SectionProgress` for the owning section.
3. Recalculate `CourseProgress` for the owning course.
4. If the course has a parent path: recalculate `PathProgress`.
5. Update `LastPosition` (path-scoped or course-scoped per Decision 4).
6. `CertificatesService.checkCourseEligibility(tx, userId, courseId)` — may issue a course cert.
7. If the course has a parent path: `CertificatesService.checkPathEligibility(tx, userId, pathId)` — may issue a path cert.

**Responses**
- `200` — `{ data: CompleteLessonResult, message }`
- `401` — unauthenticated (JwtAuthGuard)
- `403` — not enrolled in the owning course/path, or enrollment status is not `ACTIVE`, or subscription required (once the subscription branch is live)
- `404` — lesson does not exist

**CompleteLessonResult shape**
```json
{
  "lessonProgress": {
    "id": "uuid",
    "userId": "uuid",
    "lessonId": "uuid",
    "status": "COMPLETED",
    "completedAt": "..."
  },
  "sectionProgress": { "id": "uuid", "sectionId": "uuid", "percentage": 66.7, "status": "IN_PROGRESS" },
  "courseProgress":  { "id": "uuid", "courseId": "uuid",  "percentage": 50.0, "status": "IN_PROGRESS" },
  "pathProgress":    { "id": "uuid", "pathId": "uuid",    "percentage": 25.0, "status": "IN_PROGRESS" } | null,
  "certificatesIssued": [
    {
      "id": "uuid",
      "type": "COURSE",
      "courseId": "uuid",
      "pathId": null,
      "certificateCode": "abc123xyz456",
      "issuedAt": "..."
    }
  ]
}
```

**Idempotency**
- Re-posting on the same `lessonId` when the lesson is already `COMPLETED` is a no-op: returns the current aggregate state without opening a transaction, without updating `completedAt`, without re-issuing certificates. `certificatesIssued` is returned as `[]` on the idempotent path (no NEW certs issued by this call, even if the user holds older ones).
