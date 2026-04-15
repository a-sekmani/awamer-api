# Schema — Index

Prisma schema reference for epic E3 (v6). The authoritative source is
`prisma/schema.prisma`; these docs explain the v6 shape, the naming
conventions, and the entities that were added or modified by
KAN-70..KAN-26.

Older entities (User, Path, Section, Lesson, Quiz, Subscription, etc.)
are covered only where epic E3 touched them — the rest is outside the
scope of this docs pass.

| File | Purpose |
|------|---------|
| [conventions.md](./conventions.md) | Field, model, and enum naming; `@@map` rules; UUID keys; timestamp policy; derived-stats rule |
| [migrations.md](./migrations.md) | Full migration history and a detailed breakdown of the v6 migration |
| [tag.md](./tag.md) | `Tag`, `PathTag`, `CourseTag`, `TagStatus` |
| [marketing-content.md](./marketing-content.md) | `Feature`, `Faq`, `Testimonial`, `MarketingOwnerType`, `TestimonialStatus` |
| [course-enrollment.md](./course-enrollment.md) | `CourseEnrollment`, `CourseEnrollmentStatus`, relationship to `PathEnrollment` |
| [course-changes.md](./course-changes.md) | v6 changes to the existing `Course` model (nullable `pathId`, unique `slug`, `categoryId`, `CourseLevel`) |
| [certificate-polymorphic.md](./certificate-polymorphic.md) | `Certificate` dual-level issuance, `CertificateType` discriminator |
