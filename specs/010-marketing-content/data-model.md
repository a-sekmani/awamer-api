# Phase 1 — Data Model: Marketing Content Module

**Feature**: 010-marketing-content
**Date**: 2026-04-14

This feature does **not** introduce or modify any Prisma schema. The three tables and two enums already exist from KAN-70. This document maps each entity to its application-layer validation, ordering contract, state machine, and lifecycle.

---

## Enums (already in schema)

### `MarketingOwnerType`

| Value | DB value |
|-------|----------|
| `PATH` | `path` |
| `COURSE` | `course` |

Used by all three entities to identify the owner kind.

### `TestimonialStatus`

| Value | DB value | Public visibility |
|-------|----------|-------------------|
| `PENDING` | `pending` | Hidden — awaits moderation |
| `APPROVED` | `approved` | Visible on public pages |
| `HIDDEN` | `hidden` | Hidden — explicitly suppressed |

Default on create: `PENDING`.

---

## Entity: Feature

**Table**: `features` · **Prisma model**: `Feature`

### Fields

| Field | Type | Nullable | Constraints |
|-------|------|----------|-------------|
| `id` | UUID | no | PK, `@default(uuid())` |
| `ownerType` | `MarketingOwnerType` | no | — |
| `ownerId` | string (UUID) | no | — |
| `icon` | string | no | Non-empty after trim |
| `title` | string | no | 1–150 chars, trimmed, rejects whitespace-only |
| `description` | string (Text) | no | 1–500 chars, trimmed, rejects whitespace-only |
| `order` | int | no | `@default(0)`, non-negative in practice |

### Indexes
- `@@index([ownerType, ownerId])` (existing) — powers the per-owner list query.

### Ordering contract
- Primary sort: `order` ASC.
- Tie-breaker: `id` ASC. **Note**: Prisma model has no `createdAt` on Feature/Faq (only Testimonial has one). The ticket's phrasing "order ASC then createdAt ASC" cannot be literally satisfied for features/faqs without a schema change (out of scope per §15). We fall back to `id` ASC, which is deterministic and stable. This is documented here and in the service-layer comment at the sort site.

### Append-on-create
When the DTO omits `order`, the service runs `findFirst({ where: { ownerType, ownerId }, orderBy: { order: 'desc' } })` inside the same Prisma call chain and uses `(max.order ?? -1) + 1`, falling back to `0` when the list is empty.

### Lifecycle
Created by admin → edited by admin → deleted by admin or cascaded when the owning Path/Course is deleted (via `MarketingCleanupHelper`).

---

## Entity: Faq

**Table**: `faqs` · **Prisma model**: `Faq`

### Fields

| Field | Type | Nullable | Constraints |
|-------|------|----------|-------------|
| `id` | UUID | no | PK |
| `ownerType` | `MarketingOwnerType` | no | — |
| `ownerId` | string (UUID) | no | — |
| `question` | string (Text) | no | 1–300 chars, trimmed, rejects whitespace-only |
| `answer` | string (Text) | no | 1–2000 chars, trimmed, rejects whitespace-only |
| `order` | int | no | `@default(0)` |

### Indexes
- `@@index([ownerType, ownerId])` (existing).

### Ordering contract
Same as Feature: `order` ASC, `id` ASC tie-breaker (no `createdAt` column).

### Append-on-create
Same rule as Feature.

### Lifecycle
Identical to Feature.

---

## Entity: Testimonial

**Table**: `testimonials` · **Prisma model**: `Testimonial`

### Fields

| Field | Type | Nullable | Constraints |
|-------|------|----------|-------------|
| `id` | UUID | no | PK |
| `ownerType` | `MarketingOwnerType` | no | — |
| `ownerId` | string (UUID) | no | — |
| `authorName` | string | no | 1–100 chars, trimmed, required |
| `authorTitle` | string | yes | 1–100 chars when provided |
| `avatarUrl` | string | yes | Must be a valid URL when provided |
| `content` | string (Text) | no | 1–1000 chars, trimmed, required |
| `rating` | int | yes | 1–5 inclusive when provided |
| `status` | `TestimonialStatus` | no | `@default(PENDING)` |
| `order` | int | no | `@default(0)` |
| `createdAt` | DateTime | no | `@default(now())` |

### Indexes
- `@@index([ownerType, ownerId])` (existing).
- `@@index([status])` (existing) — supports the `APPROVED` public filter.

### Ordering contract
- Primary sort: `order` ASC.
- Tie-breaker: `createdAt` ASC (the ticket's literal rule, now satisfiable because the column exists).

### State machine

```
         ┌──────────┐    approve     ┌──────────┐
         │ PENDING  │───────────────▶│ APPROVED │
         └──────────┘                └──────────┘
              │  hide                     │  hide
              ▼                           ▼
         ┌──────────┐   approve      ┌──────────┐
         │  HIDDEN  │◀──────────────▶│  HIDDEN  │  (no-op if already)
         └──────────┘                └──────────┘
```

All six transitions (including self-loops) are permitted via `PATCH /admin/testimonials/:id/status`. The standard update endpoint (`PATCH /admin/testimonials/:id`) never touches `status` — the DTO simply lacks the field, and global `ValidationPipe({ whitelist: true })` strips anything extra the client sends.

### Creation rule
`TestimonialsService.create` always sets `status: PENDING`, regardless of DTO content. The create DTO does **not** include `status`.

### Public visibility rule
`getApprovedTestimonialsByOwner` adds `where: { status: 'APPROVED' }` to the base query. The admin list path applies no status filter.

### Append-on-create
Same rule as Feature/Faq.

### Lifecycle
Identical to Feature, plus the moderation state machine.

---

## Polymorphic ownership — integrity rules

- No Prisma `@relation` exists between `Feature`/`Faq`/`Testimonial` and `Path`/`Course`. Referential integrity is enforced at the service layer via `OwnerValidator`.
- **Before every admin create**: `ensureOwnerExists(ownerType, ownerId)` → 404 on miss.
- **Before every admin update**: the record is fetched by `id` first (404 if missing), then its (ownerType, ownerId) is trusted; updates never change ownership.
- **Before every admin reorder**: the controller extracts `(ownerType, ownerId)` from the URL; `ReorderHelper` re-reads all ids for that owner and validates set equality against the request body.
- **Public query helpers**: do NOT call `OwnerValidator` (KAN-26 validates the path/course up the stack).

---

## Cascade cleanup contract

`MarketingCleanupHelper.deleteAllForPath(pathId)` runs, inside a single `prisma.$transaction`:

```ts
prisma.feature.deleteMany({ where: { ownerType: 'PATH', ownerId: pathId } });
prisma.faq.deleteMany({ where: { ownerType: 'PATH', ownerId: pathId } });
prisma.testimonial.deleteMany({ where: { ownerType: 'PATH', ownerId: pathId } });
```

`deleteAllForCourse(courseId)` is identical with `ownerType: 'COURSE'`. Both are idempotent (`deleteMany` returns `{ count: 0 }` on empty matches) and isolated (never touch other owners).

---

## Shared invariants

- **UUIDs** for all primary keys (enforced by schema).
- **DateTime** values are serialized as ISO 8601 strings in HTTP responses (standard NestJS serialization).
- **Arabic text** must round-trip through every text column (`varchar` + UTF-8 in Postgres; already verified by KAN-71 Tags tests).
- **No field removal** from responses is required — none of these entities carry secrets.
- **Response shape** follows the standard `{ data, message }` envelope via the existing global response interceptor (Constitution Principle III).
