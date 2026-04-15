# OwnerValidator — Backend Reference (awamer-api)

> **Class:** `OwnerValidator`
> **Source:** `src/content/marketing/helpers/owner-validator.helper.ts`
> **Used by:** `FeaturesService`, `FaqsService`, `TestimonialsService`

The single point where "does this `ownerId` actually exist in the
`paths` or `courses` table?" is checked. Exists because the
marketing models use polymorphic ownership with no FK (see
[polymorphic-ownership.md §2](./polymorphic-ownership.md)).

---

## 1. Public methods

```ts
async ensurePathExists(pathId: string): Promise<void>
async ensureCourseExists(courseId: string): Promise<void>
async ensureOwnerExists(ownerType: MarketingOwnerType, ownerId: string): Promise<void>
```

- `ensurePathExists(pathId)` — `prisma.path.findUnique({ where: { id }, select: { id: true } })`, throws
  `NotFoundException(\`Path '${pathId}' does not exist\`)` on miss.
- `ensureCourseExists(courseId)` — same shape for `course`, throws
  `NotFoundException(\`Course '${courseId}' does not exist\`)`.
- `ensureOwnerExists(ownerType, ownerId)` — dispatches to one of
  the above based on the enum. Throws
  `NotFoundException(\`Unknown owner type '${type}'\`)` if the
  enum value is neither `PATH` nor `COURSE` (defensive — the
  Prisma enum only has two values).

---

## 2. Where it runs

Called at the top of every marketing admin endpoint that targets
an owner by id (`list`, `create`, `reorder`). The three
endpoints that target an **existing marketing row** by its own id
(`update`, `updateStatus`, `remove`) do **not** call the
validator — the row carries its own `ownerType`/`ownerId` and the
service trusts those for cache invalidation.

Typical shape:

```ts
async listByOwner(ownerType, ownerId) {
  await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
  // ... list rows
}
```

---

## 3. What it does not do

- **Does not** check that the path/course is published — an admin
  can attach marketing content to a draft.
- **Does not** load any fields other than `id`. Cheap query, no
  wasted I/O.
- **Does not** cache. The validator is called before every
  mutation; caching its result is a trap because paths/courses
  can be deleted between calls.

---

## 4. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/helpers/owner-validator.helper.spec.ts` | Happy path for `PATH` and `COURSE` owners, 404 on unknown id, 404 on unknown enum value. |

---

## 5. Files involved

| File | Role |
|------|------|
| `src/content/marketing/helpers/owner-validator.helper.ts` | The class |
| `src/content/marketing/marketing.module.ts` | Provider registration |

---

## 6. Things NOT to change without coordination

- The `SELECT id` shape. Anything wider is wasted I/O on a check
  that runs on every admin mutation.
- The "no caching" rule. A cached existence check is a
  correctness bug waiting to happen.
- Keeping the three services' call sites consistent. Skipping
  `ensureOwnerExists` in one of them would let an admin typo
  produce an orphaned marketing row with no FK to catch it.
