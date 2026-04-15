# List My Certificates — Backend Spec (awamer-api)

> **Module:** `CertificatesModule`
> **Endpoint:** `GET /api/v1/certificates/me`
> **Guards:** `JwtAuthGuard` (method-level)
> **Status code:** `200 OK`

---

## 1. Summary

Returns every certificate issued to the calling user — both path-
and course-level — in reverse chronological order, each with the
slug and title of its owning path or course.

---

## 2. Request

```
GET /api/v1/certificates/me
Cookie: access_token=<JWT>
```

No query parameters.

---

## 3. Behavior — `CertificatesService.listForUser(userId)`

Source: `src/certificates/certificates.service.ts` `listForUser()`.

```ts
const rows = await this.prisma.certificate.findMany({
  where: { userId },
  orderBy: { issuedAt: 'desc' },
  include: {
    path:   { select: { id: true, title: true, slug: true } },
    course: { select: { id: true, title: true, slug: true } },
  },
});
return rows.map((c) =>
  CertificateResponseDto.fromEntity(c as CertificateWithRelations),
);
```

Each row carries exactly one of `path` or `course` populated (the
other is `null`) because of the polymorphic shape of the
`Certificate` model — see
[../schema/certificate-polymorphic.md](../schema/certificate-polymorphic.md).

---

## 4. Controller wrapping

The controller wraps the list into a `{ certificates }` envelope
before the global response interceptor adds the outer
`{ data, message }`:

```ts
async listForUser(req) {
  const { userId } = req.user;
  return { certificates: await this.certificates.listForUser(userId) };
}
```

This gives the wire shape `{ data: { certificates: [...] }, message: 'Success' }`,
which is slightly unusual — most list endpoints return an array
directly at `data` (see
[../enrollment/list-my-enrollments.md](../enrollment/list-my-enrollments.md)
for the plain-array pattern). The extra wrapper is load-bearing:
the frontend expects `response.data.certificates` specifically.

---

## 5. `CertificateResponseDto`

Built by `CertificateResponseDto.fromEntity(...)`. Fields:

```ts
{
  id: string,
  type: 'PATH' | 'COURSE',
  certificateCode: string,
  certificateUrl: string | null,
  issuedAt: string,           // ISO
  subject: {
    id: string,               // path.id or course.id
    title: string,
    slug: string,
  }
}
```

The DTO hides the polymorphic `pathId` / `courseId` split by
surfacing a single `subject` block built from whichever relation
is populated.

---

## 6. Successful response

```json
{
  "data": {
    "certificates": [
      {
        "id": "uuid",
        "type": "PATH",
        "certificateCode": "abc123def456",
        "certificateUrl": null,
        "issuedAt": "2026-04-10T12:00:00.000Z",
        "subject": { "id": "uuid", "title": "Full-Stack Path", "slug": "full-stack-path" }
      },
      {
        "id": "uuid",
        "type": "COURSE",
        "certificateCode": "def789abc123",
        "certificateUrl": null,
        "issuedAt": "2026-03-15T08:30:00.000Z",
        "subject": { "id": "uuid", "title": "Intro to SQL", "slug": "intro-to-sql" }
      }
    ]
  },
  "message": "Success"
}
```

`certificateUrl` is typically `null` until an async PDF render
writes the S3 key back — see
[../schema/certificate-polymorphic.md §5](../schema/certificate-polymorphic.md).

---

## 7. Error responses

| Status | When |
|--------|------|
| `401`  | Missing/invalid access token. |
| `429 RATE_LIMIT_EXCEEDED` | Throttler. |
| `500 INTERNAL_ERROR` | Prisma read failure. |

---

## 8. Side effects

None. Read-only.

---

## 9. Files involved

| File | Role |
|------|------|
| `src/certificates/certificates.controller.ts` | `listForUser()` handler, `{ certificates }` wrapping |
| `src/certificates/certificates.service.ts` | `listForUser()` logic |
| `src/certificates/dto/certificate-response.dto.ts` | `fromEntity` + polymorphic subject |

---

## 10. Tests

| File | Covers |
|------|--------|
| `src/certificates/certificates.service.spec.ts` | Mixed path+course rows, correct `subject` mapping for each type, empty list, order by `issuedAt desc`. |
| `test/certificates/*.e2e-spec.ts` | Response envelope including the extra `certificates` wrapper; 401 without cookie. |

---

## 11. Things NOT to change without coordination

- The `{ certificates }` wrapping. See §4.
- The `subject` shape. Splitting into `path` / `course` fields
  would push the polymorphism onto the frontend, which was the
  whole reason for introducing a DTO.
- The `orderBy: { issuedAt: 'desc' }`. The dashboard renders the
  list in this order.
