# Schema — Feature, Faq, Testimonial (polymorphic marketing)

> **Source:** `prisma/schema.prisma` (`Feature`, `Faq`, `Testimonial`)
> **Migration:** `20260414145648_v6_path_course_pages_alignment`
> **Module doc:** [../marketing/README.md](../marketing/README.md)
> **Flow doc:** [../marketing/polymorphic-ownership.md](../marketing/polymorphic-ownership.md)

Three parallel tables sharing the same polymorphic-ownership shape.
Each row is owned by exactly one **path** or exactly one **course**,
identified by the pair `(ownerType, ownerId)`. There is no foreign key
on either side of the pair — cleanup is handled in application code via
`MarketingCleanupHelper`.

---

## 1. The ownership pair

All three models share two columns:

```prisma
ownerType MarketingOwnerType
ownerId   String
```

and an index that makes the ownership lookup cheap:

```prisma
@@index([ownerType, ownerId])
```

### `MarketingOwnerType`

```prisma
enum MarketingOwnerType {
  PATH   @map("path")
  COURSE @map("course")

  @@map("marketing_owner_type")
}
```

Exactly two owner kinds. If you need a third (e.g. `CATEGORY`), it is
a coordinated migration across all three tables, every reorder endpoint,
`OwnerValidator`, and `MarketingCleanupHelper`.

---

## 2. `Feature`

```prisma
model Feature {
  id          String             @id @default(uuid())
  ownerType   MarketingOwnerType
  ownerId     String
  icon        String
  title       String
  description String             @db.Text
  order       Int                @default(0)

  @@index([ownerType, ownerId])
  @@map("features")
}
```

- No `status` column — `Feature` rows are either present or absent.
- No `createdAt` / `updatedAt` — features are rewritten often by the
  admin reorder endpoint; audit fields would churn.
- `description` is `@db.Text` — unbounded length; the rendering side
  takes care of truncation.

---

## 3. `Faq`

```prisma
model Faq {
  id        String             @id @default(uuid())
  ownerType MarketingOwnerType
  ownerId   String
  question  String             @db.Text
  answer    String             @db.Text
  order     Int                @default(0)

  @@index([ownerType, ownerId])
  @@map("faqs")
}
```

Same shape as `Feature`. `question` and `answer` are both `@db.Text`.
No status, no timestamps.

---

## 4. `Testimonial`

```prisma
model Testimonial {
  id          String             @id @default(uuid())
  ownerType   MarketingOwnerType
  ownerId     String
  authorName  String
  authorTitle String?
  avatarUrl   String?
  content     String             @db.Text
  rating      Int?
  status      TestimonialStatus  @default(PENDING)
  order       Int                @default(0)
  createdAt   DateTime           @default(now())

  @@index([ownerType, ownerId])
  @@index([status])
  @@map("testimonials")
}
```

`Testimonial` is the only marketing type with a lifecycle:

- `status TestimonialStatus @default(PENDING)` — `PENDING`, `APPROVED`,
  `HIDDEN`.
- `@@index([status])` — the public list query filters `{ status:
  APPROVED }`.
- `createdAt` — the only marketing model with an audit field, because
  testimonials need a "submitted" timestamp for review.
- `rating Int?` — optional 1–5 star rating; validation is in
  `CreateTestimonialDto` (not enforced by the DB).

### `TestimonialStatus`

```prisma
enum TestimonialStatus {
  PENDING  @map("pending")
  APPROVED @map("approved")
  HIDDEN   @map("hidden")

  @@map("testimonial_status")
}
```

Lifecycle is one-way in the admin UI (`PENDING → APPROVED`/`HIDDEN`,
and `APPROVED ↔ HIDDEN`), but the schema does not enforce transitions.
See the testimonials update-status endpoint doc for the rules.

---

## 5. No `FeatureStatus`, no `FaqStatus`

The v6 plan originally called for lifecycle columns on `Feature` and
`Faq`. The implementation dropped them: features and FAQs are trivially
created, edited, reordered, and deleted, and no stakeholder needed a
"hidden" state. If you search the code for `FeatureStatus` or
`FaqStatus`, you will not find either — their absence is intentional.

---

## 6. No foreign keys on the owner pair

The ownership pair is **not** a foreign key. A row in `features`
carrying `ownerType = 'path', ownerId = '<uuid>'` is not linked to
`paths(id)` by the database. Reasons:

1. A polymorphic FK is not expressible in standard SQL. Modeling
   `(ownerType, ownerId)` as a real FK would require either two
   nullable FKs (one to `paths`, one to `courses`) or a table-per-kind
   inheritance scheme; neither plays well with the uniform query shape
   the admin endpoints use.
2. Validation is cheap in application code via `OwnerValidator` — it
   issues a single `SELECT` per admin mutation. See
   [../marketing/owner-validator.md](../marketing/owner-validator.md).
3. Cleanup is handled by `MarketingCleanupHelper`, which deletes all
   marketing rows owned by a given `(ownerType, ownerId)` when the
   path or course is deleted. See
   [../marketing/marketing-cleanup-helper.md](../marketing/marketing-cleanup-helper.md).

The cost is that an orphaned row is possible if the cleanup helper is
not called on path/course deletion. Every delete path in
`PathsService` / `CoursesService` that removes a path or course **must**
call `MarketingCleanupHelper.cleanup(tx, type, id)` inside the same
transaction.

---

## 7. The `order` column

Every marketing model carries `order Int @default(0)`. The reorder
endpoints (`PATCH /admin/<path|course>/:ownerId/<kind>/reorder`) assign
dense `0..n-1` values in an atomic `updateMany`. See
[../marketing/reorder-helper.md](../marketing/reorder-helper.md).

Do not insert rows with explicit `order` values from the admin UI; the
reorder helper owns the column.

---

## 8. Schema tests

| File | Asserts |
|------|---------|
| `test/schema/marketing-content.spec.ts` | Creation of features/faqs/testimonials owned by a path and by a course, the `(ownerType, ownerId)` index makes per-owner queries fast, `TestimonialStatus` defaults to `PENDING`, the lack of a foreign key on `ownerId` (insertion with a bogus `ownerId` succeeds and is the whole point of the "clean up in application code" decision). |

---

## 9. Things NOT to change without coordination

- Adding a foreign key on the `(ownerType, ownerId)` pair. The
  polymorphic design is deliberate.
- Adding a new `MarketingOwnerType` value. See §1.
- Adding `status` to `Feature` or `Faq` — if you need it, design the
  frontend workflow first, then coordinate the migration across the
  reorder and public-list queries.
- The `@@index([ownerType, ownerId])` on all three tables — removing
  it turns the admin list query into a full scan.
