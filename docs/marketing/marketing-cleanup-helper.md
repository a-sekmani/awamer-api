# MarketingCleanupHelper — Backend Reference (awamer-api)

> **Class:** `MarketingCleanupHelper`
> **Source:** `src/content/marketing/helpers/marketing-cleanup.helper.ts`
> **Status:** defined and tested; **not yet called from any
> production delete path** (there is no admin paths/courses CRUD
> yet). Exists so that the first delete endpoint can wire it in
> as a single import.

The stand-in for the foreign key that does not exist. Because
marketing rows are polymorphically owned by paths or courses with
no FK, `ON DELETE CASCADE` cannot clean them up — the service
layer must. This helper is the only way to do it correctly.

---

## 1. Public API

```ts
async deleteAllForPath(pathId: string): Promise<void>
async deleteAllForCourse(courseId: string): Promise<void>
```

Both delegate to a private `deleteAllForOwner(ownerType, ownerId)`
that runs three `deleteMany` calls inside a single transaction:

```ts
await this.prisma.$transaction([
  this.prisma.feature.deleteMany({ where: { ownerType, ownerId } }),
  this.prisma.faq.deleteMany({ where: { ownerType, ownerId } }),
  this.prisma.testimonial.deleteMany({ where: { ownerType, ownerId } }),
]);
```

---

## 2. Idempotence

`deleteMany` returns `{ count: 0 }` when no rows match — calling
the helper on an owner with no marketing rows (or on an already-
cleaned owner) is a no-op. This makes the helper safe to call
defensively from any future admin endpoint that thinks it might
need to clean up.

---

## 3. The transaction

All three `deleteMany`s run inside a single `$transaction`. If
any of the three fails, none commit. The failure modes are tiny
(any production failure is a DB outage, which would fail all
three), but the transaction is free and protects against the
partial-cleanup "half a path's marketing content is gone" state.

---

## 4. Intended call site

The helper is imported by `MarketingModule` and exported for
other modules to use. The intended consumers are:

- A future `PathsService.remove(pathId)` — must call
  `deleteAllForPath(pathId)` **inside the same transaction** as
  the path delete (or immediately before/after, inside an outer
  transaction).
- A future `CoursesService.remove(courseId)` — same pattern with
  `deleteAllForCourse(courseId)`.

Neither admin CRUD endpoint exists today. When they land, the
reviewer should ensure this helper is wired in.

### The trap

If a contributor adds a delete endpoint without calling this
helper, the marketing rows are orphaned — they stay in the DB
forever with an `ownerId` that no longer references anything.
The orphaned rows do not cause failures (no FK, no constraint),
they just accumulate. `PublicMarketingQueries.getFeaturesByOwner`
will never return them because the owner is gone, so they are
invisible but eat disk.

This is the hardest aspect of polymorphic ownership. The helper
is the mitigation; calling it is the contributor's
responsibility.

---

## 5. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/helpers/marketing-cleanup.helper.spec.ts` | Happy path deletes all three row types for a PATH owner and a COURSE owner, idempotence (second call is a no-op), transaction atomicity (one failing deleteMany leaves the others intact). |

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/helpers/marketing-cleanup.helper.ts` | The class |
| `src/content/marketing/marketing.module.ts` | Provider registration + export |

---

## 7. Things NOT to change without coordination

- The transaction scope. Running the three `deleteMany`s
  sequentially outside a transaction would leak a partial
  cleanup state.
- The idempotence contract. A future caller may depend on the
  no-op safety (e.g., to run the helper in a scheduled cleanup
  job).
- Removing the helper on the grounds that "no one calls it
  today". That would bury the trap in §4.
