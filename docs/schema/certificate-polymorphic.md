# Schema — Certificate (polymorphic)

> **Source:** `prisma/schema.prisma` (`Certificate`, `CertificateType`)
> **Migration:** `20260414145648_v6_path_course_pages_alignment`
> **Module doc:** [../certificates/README.md](../certificates/README.md)
> **Flow doc:** [../certificates/dual-level-issuance.md](../certificates/dual-level-issuance.md)

The v6 migration extends `Certificate` from "path certificates only"
to a dual-level issuance: a single table stores both **path
certificates** (issued when a user completes an entire path) and
**course certificates** (issued when a user completes a standalone
course). A discriminator column (`type`) and two nullable FKs
distinguish the two cases.

---

## 1. The model

```prisma
model Certificate {
  id              String          @id @default(uuid())
  userId          String
  pathId          String?
  courseId        String?
  type            CertificateType
  certificateCode String          @unique
  certificateUrl  String?
  issuedAt        DateTime        @default(now())
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  path   Path?   @relation(fields: [pathId], references: [id], onDelete: Cascade)
  course Course? @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([pathId])
  @@index([type])
  @@map("certificates")
}
```

| Field | Type | Notes |
|-------|------|-------|
| `userId` | uuid | FK → `users`. `ON DELETE CASCADE`. |
| `pathId` | `uuid?` | FK → `paths`. **Non-null iff `type = PATH`.** |
| `courseId` | `uuid?` | FK → `courses`. **Non-null iff `type = COURSE`.** |
| `type` | `CertificateType` | The discriminator. |
| `certificateCode` | `String` | **Unique.** The public verification code, printed on the certificate PDF. |
| `certificateUrl` | `String?` | URL to the generated PDF in S3. Null until the PDF is rendered (async). |
| `issuedAt` | `DateTime` | When the certificate was awarded. Set inside the progress transaction. |

---

## 2. `CertificateType`

```prisma
enum CertificateType {
  PATH   @map("path")
  COURSE @map("course")

  @@map("certificate_type")
}
```

The discriminator. Combined with the two nullable FKs, it encodes the
business invariant that the application must enforce (the DB does not):

| `type` | `pathId` | `courseId` |
|--------|----------|------------|
| `PATH` | set | `NULL` |
| `COURSE` | `NULL` | set |

`CertificatesService` and `ProgressService` always write in one of
these two shapes. A shape like `{ type: PATH, pathId: NULL }` or
`{ type: PATH, pathId: X, courseId: Y }` is a bug — the DB will accept
it but every consumer will misread it.

---

## 3. Why polymorphic and not two tables

Two options were considered when KAN-73 shipped:

1. **One polymorphic `certificates` table** (chosen).
2. Two tables: `path_certificates` and `course_certificates`.

Option 1 wins because:

- The wire format is one row — the frontend doesn't care which rung
  issued it.
- `GET /certificates/me` is a single query.
- `GET /certificates/verify/:code` is a single unique lookup.
- The existing `certificates` table is preserved (migration adds
  columns, not a new table).

The cost is the "no DB-level invariant" downside in §2, which is
mitigated by keeping all certificate writes in a single service method
(`CertificatesService.issue`) that refuses to write an invalid shape.

---

## 4. `certificateCode` — uniqueness + verification

`certificateCode` is the **public** identifier. It is printed on the
PDF, embedded in the QR code on the PDF, and used by the public
verification endpoint `GET /api/v1/certificates/verify/:code`. Because
it is unique across both PATH and COURSE rows, a single lookup is
enough — the lookup does not need to know the type in advance.

The code is generated in `CertificatesService.generateCode()` and is
**not** reversible to the user id or path/course id. Use a UUID,
not an auto-increment, to avoid leaking the total number of
certificates issued.

---

## 5. `certificateUrl` — nullable by design

`certificateUrl` is `null` at the moment the row is created. The
progress cascade transaction does not wait for PDF generation: the row
is inserted, the transaction commits, and the PDF render runs
asynchronously (future feature — currently the field stays null).
Consumers of `GET /certificates/me` must tolerate null and render a
placeholder.

---

## 6. Indexes

- `UNIQUE(certificateCode)` — serves the public verify lookup.
- `@@index([userId])` — serves `GET /certificates/me`.
- `@@index([pathId])` — serves the "has this user finished this
  path?" check during the progress cascade and admin analytics.
- `@@index([type])` — supports admin reporting that counts by type.

There is **no** index on `courseId` or on `(userId, courseId)`. If
course-level reporting grows heavy, add one.

---

## 7. Cascades

Both `path` and `course` relations have `onDelete: Cascade`. Deleting
a path erases path certificates; deleting a course erases course
certificates. The `userId` relation also cascades.

This is opinionated: it matches the "soft delete is not a concept we
use" policy and assumes that a deleted path/course is one the
business has decided never existed. If you ever need to preserve
historical certificates past a content takedown, this behavior must
change.

---

## 8. Schema tests

| File | Asserts |
|------|---------|
| `test/schema/certificate.spec.ts` | Path-shape row (`type = PATH`, `pathId` set, `courseId` null) persists and round-trips; course-shape row persists and round-trips; `certificateCode` uniqueness; cascade delete from `User`, `Path`, and `Course` all remove the certificate row; the shape invariant in §2 is **not** enforced by the DB (a malformed shape is accepted — the test asserts the freedom so the service layer knows what it is responsible for). |

---

## 9. Things NOT to change without coordination

- The polymorphic shape. Splitting back into two tables would break
  the verify endpoint, `GET /certificates/me`, and the dual-level
  issuance flow in `ProgressService`.
- The nullability of `pathId` and `courseId`. Tightening either to
  NOT NULL is impossible without a new discriminator scheme.
- The uniqueness of `certificateCode`.
- The `onDelete: Cascade` on all three relations — see §7.
- The `type` index. It is the only index that makes the "count
  certificates by type" admin query non-terrible.
