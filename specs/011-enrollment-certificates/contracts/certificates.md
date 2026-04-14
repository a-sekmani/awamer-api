# Contract — Certificates endpoints

**Base**: `/api/v1`

---

## GET /certificates/me — List my certificates

**Auth**: `JwtAuthGuard` (global + explicit).

**Responses**
- `200` — `{ data: { certificates: CertificateResponse[] }, message }`
- `401` — unauthenticated

**CertificateResponse shape**
```json
{
  "id": "uuid",
  "type": "PATH" | "COURSE",
  "pathId": "uuid" | null,
  "courseId": "uuid" | null,
  "certificateCode": "abc123xyz456",
  "issuedAt": "2026-04-14T12:00:00.000Z",
  "path": { "id": "uuid", "title": "...", "slug": "..." } | null,
  "course": { "id": "uuid", "title": "...", "slug": "..." } | null
}
```

**Rules**
- Sorted by `issuedAt DESC`.
- For `type = PATH`: `pathId` and `path` populated, `courseId` and `course` null.
- For `type = COURSE`: `courseId` and `course` populated, `pathId` and `path` null.
- Empty list when user has no certificates — NOT a 404.

---

## GET /certificates/verify/:code — Public verification

**Auth**: `@Public()` — no JWT required. This is the only public endpoint in this feature.

**Params**
- `code` — the certificate's `certificateCode`. URL-safe, 12 hex characters.

**Responses**
- `200` — `{ data: CertificateVerificationResponse, message }`
- `404` — code does not exist (do NOT return a 200 with `valid: false` — this avoids probing)

**CertificateVerificationResponse shape** (per clarification Q2)
```json
{
  "valid": true,
  "type": "PATH" | "COURSE",
  "issuedAt": "2026-04-14T12:00:00.000Z",
  "holder": { "fullName": "أحمد السكماني" },
  "subject": {
    "type": "PATH" | "COURSE",
    "title": "تطوير الذكاء الاصطناعي",
    "slug": "ai-development"
  }
}
```

**Security rules**
- `holder.fullName` comes from `User.name` directly — no split, no email, no identifiers.
- Response MUST NOT contain: user email, user id, enrollment date, progress data, or any field not listed above.
- DTO uses `class-transformer` `@Expose()`/`@Exclude()` to enforce the allow-list at serialization time.
