# Polymorphic Marketing Ownership — Flow Reference (awamer-api)

> **Tables:** `Feature`, `Faq`, `Testimonial`
> **Discriminator:** `(ownerType, ownerId)` — no foreign key
> **Services:** `FeaturesService`, `FaqsService`, `TestimonialsService`
> **Helpers:** `OwnerValidator`, `ReorderHelper`, `MarketingCleanupHelper`, `PublicMarketingQueries`

Marketing content (features, FAQs, testimonials) uses a single
shared ownership model: each row is owned by **exactly one Path or
exactly one Course**, identified by the pair
`(ownerType, ownerId)`. There is no foreign key on that pair — the
database does not know which table `ownerId` references. This
document explains the convention so the individual endpoint docs
can reference it instead of re-explaining it.

See [../schema/marketing-content.md](../schema/marketing-content.md)
for the underlying schema and [invalidation by
`CacheService.invalidateOwner`](../cache/invalidation-flow.md).

---

## 1. The ownership pair

```prisma
ownerType MarketingOwnerType   // enum: PATH | COURSE
ownerId   String               // uuid referencing paths(id) OR courses(id)
```

Every marketing row carries these two columns. Every admin endpoint
takes them as route parameters in one of two shapes:

```
/admin/paths/:ownerId/<kind>[...]
/admin/courses/:ownerId/<kind>[...]
```

where `<kind>` is `features`, `faqs`, or `testimonials`. The two
shapes are handled by **separate controller handlers** that call
the same service method with a different `ownerType`:

```ts
@Post('paths/:ownerId/features')   createForPath(...)
@Post('courses/:ownerId/features') createForCourse(...)
```

This duplication is intentional — one handler per owner kind keeps
the route declarations readable and makes the routing table
predictable.

---

## 2. `OwnerValidator` — the only runtime existence check

Source: `src/content/marketing/helpers/owner-validator.helper.ts`.

Because there is no FK, the service layer is responsible for
checking that `ownerId` actually exists before creating, listing,
or reordering a marketing row. `OwnerValidator` exposes three
methods:

```ts
ensurePathExists(pathId): Promise<void>
ensureCourseExists(courseId): Promise<void>
ensureOwnerExists(ownerType, ownerId): Promise<void>  // dispatches on type
```

Each performs a single `SELECT id` query and throws
`NotFoundException(\`Path '${id}' does not exist\`)` (or the
course variant) when the row is missing.

**Every list / create / reorder on the admin marketing endpoints
starts with `ensureOwnerExists(ownerType, ownerId)`.** Update and
delete endpoints do not need the check because they target the
marketing row by its own id, and the row carries its own
`ownerType`/`ownerId` that the service then uses for cache
invalidation.

See [owner-validator.md](./owner-validator.md).

---

## 3. `ReorderHelper` — atomic reorder for any of the three models

Source: `src/content/marketing/helpers/reorder.helper.ts`.

One helper instance serves `Feature`, `Faq`, and `Testimonial` via
a `ReorderableModel` type (`'feature' | 'faq' | 'testimonial'`).
Each reorder call:

1. **Assert no duplicates** in the client-provided `itemIds` array
   (`BadRequestException('Reorder list contains duplicate id ...')`).
2. **Fetch current ids** for the owner from the right model.
3. **Assert set equality** between `currentIds` and `itemIds` —
   size, every requested id is current, every current id is
   requested. Any mismatch throws a precise `BadRequestException`.
4. **Run the updates in a single `$transaction`** — one
   `update({ where: { id }, data: { order: index } })` per item,
   in the order provided by the client.

The helper dispatches to the right Prisma delegate via a small
switch because Prisma's generated types are not structurally
compatible across models.

See [reorder-helper.md](./reorder-helper.md).

---

## 4. `MarketingCleanupHelper` — the FK stand-in

Source: `src/content/marketing/helpers/marketing-cleanup.helper.ts`.

Because there is no `ON DELETE CASCADE` from a path/course to its
marketing rows, deleting a path or course must explicitly call the
cleanup helper:

```ts
await marketingCleanup.deleteAllForPath(pathId);   // or deleteAllForCourse
```

The helper runs three `deleteMany` calls (`Feature`, `Faq`,
`Testimonial`) in a single `$transaction` so a failure leaves no
half-cleaned owner. The operation is idempotent — a second call
with no matching rows is a no-op.

**Any future admin Paths / Courses delete endpoint MUST call this
helper inside the same transaction as the path/course delete.** See
[marketing-cleanup-helper.md](./marketing-cleanup-helper.md).

---

## 5. `PublicMarketingQueries` — the read side

Source: `src/content/marketing/helpers/public-queries.helper.ts`.

Read-only helper consumed by the public discovery endpoints
(`GET /paths/:slug`, `GET /courses/:slug`). Exposes:

```ts
getFeaturesByOwner(ownerType, ownerId): Promise<Feature[]>
getFaqsByOwner(ownerType, ownerId): Promise<Faq[]>
getApprovedTestimonialsByOwner(ownerType, ownerId): Promise<Testimonial[]>
```

Two quirks:

- **`getApprovedTestimonialsByOwner` filters `status: APPROVED`.**
  The public path/course page only shows approved testimonials;
  `PENDING` and `HIDDEN` are invisible to the public.
- **Ordering** is `[{ order: 'asc' }, tiebreaker]`. For features
  and FAQs the tiebreaker is `{ id: 'asc' }` because there is no
  `createdAt` column (schema frozen by KAN-70). For testimonials
  the tiebreaker is `{ createdAt: 'asc' }`, matching the literal
  spec in KAN-72 §3.

See [public-marketing-queries.md](./public-marketing-queries.md).

---

## 6. Ordering — the `order` column

Every marketing model has `order Int @default(0)`. Reordering is
owned by `ReorderHelper`. The per-service `create` call assigns a
new `order` via a private `nextOrder(ownerType, ownerId)` helper
that reads the current maximum and adds one:

```ts
const top = await prisma.feature.findFirst({
  where: { ownerType, ownerId },
  orderBy: { order: 'desc' },
  select: { order: true },
});
return top ? top.order + 1 : 0;
```

New rows land at the end. The client can override with an explicit
`order` field on the create DTO, but the typical shape is "create
at end, reorder later".

---

## 7. Cache invalidation on every mutation

Every marketing mutation (create, update, reorder, remove,
testimonial-status) runs the same invalidation shape — see
[../cache/invalidation-flow.md §4](../cache/invalidation-flow.md)
for the full sequence. Summary:

1. Write to DB.
2. `cache.invalidateOwner(scope, ownerId)` — flushes the
   `marketing:*` keys for the owner plus the detail/list patterns
   for the scope.
3. `cache.slugFor(scope, ownerId)` + `revalidationHelper.revalidatePath(...)` —
   dormant until `FRONTEND_REVALIDATE_SECRET` is set, but the call
   is in the code so activation is env-only.

The `scope` is a lowercase `'path' | 'course'` derived from the
Prisma enum:

```ts
const scope = ownerType === 'PATH' ? 'path' : 'course';
```

This mapping exists because `CacheService.invalidateOwner` takes
`OwnerType` (`'path' | 'course'`) while Prisma exposes
`MarketingOwnerType` (`PATH | COURSE`). Do not "simplify" to use
the Prisma enum everywhere — the cache keys themselves use the
lowercase form.

---

## 8. Why the duplication between Features/FAQs/Testimonials

Each of the three sub-modules is a near-verbatim copy of the
others:

- Same ownership pair.
- Same `ensureOwnerExists` call.
- Same `nextOrder` assignment.
- Same cache invalidation shape.
- Same reorder logic via the shared `ReorderHelper`.

Reasons to keep them separate rather than collapsing into a
generic `MarketingItemsService`:

1. **DTO shapes differ.** A `Feature` has `icon/title/description`.
   An `Faq` has `question/answer`. A `Testimonial` has
   `authorName/authorTitle/avatarUrl/content/rating/status`. A
   generic service would reintroduce runtime dispatch on the DTO
   shape.
2. **Testimonial has lifecycle.** Only `Testimonial` has a
   `status` column and a dedicated `updateStatus` endpoint. A
   generic service would have to conditionally carry that method.
3. **Code review is cheaper.** Three small files that each fit on
   one screen are easier to read than a single generic service
   with per-model branches.

The duplication is the price of shape-specific clarity. The
shared helpers (`OwnerValidator`, `ReorderHelper`,
`MarketingCleanupHelper`) are where the commonality lives.

---

## 9. Things NOT to change without coordination

- Adding a third `MarketingOwnerType` value (e.g. `CATEGORY`).
  That is a schema + every-endpoint + `OwnerValidator` +
  `MarketingCleanupHelper` change.
- Introducing a real FK on `(ownerType, ownerId)`. See
  [../schema/marketing-content.md §6](../schema/marketing-content.md).
- Collapsing the three services into one. See §8.
- Skipping `ensureOwnerExists` on a list or create endpoint.
  Without it, an admin typo would produce an orphaned row with
  no FK to catch it.
- Forgetting to call `MarketingCleanupHelper` in a new
  path/course delete endpoint. Until there is an admin paths/
  courses CRUD, this is a trap waiting for the first contributor
  who adds one.
