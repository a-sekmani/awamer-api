# Cache Invalidation — Flow Reference (awamer-api)

> **Source:** every content-domain service that mutates state
> **Companion:** [cache-keys.md](./cache-keys.md) for the key/TTL table

This is the complete map of every place the cache is invalidated,
what it invalidates, and why. Read [cache-keys.md](./cache-keys.md)
first — this document is the "who invalidates what" side of the same
table.

---

## 1. The rule

Every admin mutation that could change a read this project caches
must, **before or immediately after the DB write**, invalidate every
cache key that could now be stale. The invalidation is best-effort
(`CacheService` never throws), but the call is mandatory.

Where possible, the invalidation call is placed **before** the DB
write so a subsequent reader cannot race the writer's commit to
repopulate the cache with pre-write data. `TagsService` is the
canonical example (see §3).

---

## 2. Tag mutations

Tags appear on both public `paths:list:*` and `courses:list:*`
filters, so any tag mutation must invalidate **both** list-pattern
families — not just `tags:*`.

### `TagsService.create(dto)`
**Source:** `src/content/tags/tags.service.ts`

```
del('tags:all')
del('tags:admin:all')
delByPattern('paths:list:*')
delByPattern('courses:list:*')
then: prisma.tag.create(...)
```

Four invalidation calls, **before** the write. Slug uniqueness is
enforced by `@unique` in the DB and surfaces as `ConflictException`
after the calls; the cache is already invalidated by then.

### `TagsService.update(id, dto)`
Same four-call sequence, same order, same reasoning. A name/slug/
status change ripples into list filtering.

### `TagsService.remove(id)`
Same four-call sequence, same order. A deletion also removes the
tag from every path/course association via cascade.

---

## 3. Tag association replacement

### `ReplaceTagAssociationsHelper.replaceForPath(pathId, tagIds)`
**Source:** `src/content/tags/helpers/replace-tag-associations.helper.ts`

```
prisma.$transaction: deleteMany(pathTag) + createMany(pathTag)
delByPattern('paths:list:*')
delByPattern('courses:list:*')
```

Invalidation is **after** the transaction in this case because the
write is strictly inside `$transaction` and the pattern delete has
nothing to race against. See FR-017a in the source file comment.

### `ReplaceTagAssociationsHelper.replaceForCourse(courseId, tagIds)`
Same shape; invalidates both patterns.

Note: `ReplaceTagAssociationsHelper` does **not** invalidate
`tags:all` or `tags:admin:all` — the tag row itself did not change,
only the associations.

---

## 4. Marketing mutations (Features, FAQs, Testimonials)

Each of the three marketing services has five mutation methods
(`create`, `update`, `updateStatus` on Testimonials only, `reorder`,
`remove`). They all follow the same invalidation shape. Using
`FeaturesService` as the template:

```
validate owner + write
del(CacheKeys.marketing.features(ownerType, ownerId))
cache.invalidateOwner(ownerType, ownerId)
revalidationHelper.revalidatePath(...)  // dormant
```

Two invalidation calls per mutation:

1. A **precise** `del` on the marketing key for this owner. This is
   strictly redundant with step 2 — `invalidateOwner` calls the same
   `del` — but keeping the explicit call makes the service-level
   intent readable.
2. A **blunt** `cache.invalidateOwner(type, id)` that in turn
   invalidates the three `marketing:*` keys for the owner plus
   `paths:list:*` + `paths:detail:*` (or the course variants). This
   is the one that ripples to discovery.

`FaqsService` and `TestimonialsService` follow the same shape.
`TestimonialsService.updateStatus` is the same invalidation path
as `TestimonialsService.update`.

---

## 5. `CacheService.invalidateOwner(type, id)` — what it does in full

Called from marketing services (§4) and can also be called directly
from `PathsService` / `CoursesService` admin code (a future expansion).
The full expansion:

```
del('marketing:features:<type>:<id>')
del('marketing:faqs:<type>:<id>')
del('marketing:testimonials:<type>:<id>')
if type === 'path':
  delByPattern('paths:detail:*')
  delByPattern('paths:list:*')
else:
  delByPattern('courses:detail:*')
  delByPattern('courses:list:*')
```

Five calls. The blunt `delByPattern` choices for the detail/list
families are deliberate: a single row change may touch any cached
list or detail, and enumerating the exact subset is not worth the
complexity.

---

## 6. Categories

`CategoriesService.listAllPublic()` reads `categories:all` and writes
it back on a miss. **There is currently no admin Categories CRUD, so
there is no invalidation call site.** A TODO at the top of
`src/content/categories/categories.service.ts` flags this:

> When the admin Categories CRUD module is built, it MUST call
> `this.cache.del(CacheKeys.categories.all())` on every mutation.

Until then, changes made directly via SQL or Prisma seed scripts
require a manual `redis-cli DEL categories:all`.

---

## 7. Full call-site inventory

| Site | File | Calls |
|------|------|-------|
| `TagsService.create` | `src/content/tags/tags.service.ts` | `del tags:all`, `del tags:admin:all`, `delByPattern paths:list:*`, `delByPattern courses:list:*` |
| `TagsService.update` | same | same |
| `TagsService.remove` | same | same |
| `ReplaceTagAssociationsHelper.replaceForPath` | `src/content/tags/helpers/replace-tag-associations.helper.ts` | `delByPattern paths:list:*`, `delByPattern courses:list:*` |
| `ReplaceTagAssociationsHelper.replaceForCourse` | same | same |
| `FeaturesService.create` / `update` / `reorder` / `remove` | `src/content/marketing/features/features.service.ts` | `del marketing:features:<t>:<id>` + `invalidateOwner(type, id)` |
| `FaqsService.create` / `update` / `reorder` / `remove` | `src/content/marketing/faqs/faqs.service.ts` | `del marketing:faqs:<t>:<id>` + `invalidateOwner(type, id)` |
| `TestimonialsService.create` / `update` / `updateStatus` / `reorder` / `remove` | `src/content/marketing/testimonials/testimonials.service.ts` | `del marketing:testimonials:<t>:<id>` + `invalidateOwner(type, id)` |

That is **5 tag-related call sites** and **13 marketing call sites**
(4 Features + 4 FAQs + 5 Testimonials), totaling **18 invalidation
call sites** across the content domain. Categories adds zero until
the admin module lands.

Each marketing call site is "one `del` + one `invalidateOwner`" — if
you are counting distinct `del`/`delByPattern` invocations on the
wire, the number is higher because `invalidateOwner` itself expands
into 5 calls. The "18 call sites" number is the count of
service-method entry points, not redis round-trips.

---

## 8. Ordering: before or after the write?

Two patterns, both valid:

1. **Invalidate first, then write** (tags). Safe when the invalidation
   is to pattern families that a concurrent reader could not
   repopulate with pre-write data within the invalidate → write
   window. If a reader races and repopulates, the next write will
   invalidate again.
2. **Write first, then invalidate** (tag associations, marketing).
   Safe when the write is inside a `$transaction` and the
   invalidation targets keys that are either already empty or whose
   content is bounded by the transaction's visibility.

Either pattern is correct as long as the invalidation happens. Do
not *remove* a call to match the other pattern — add, rather than
subtract, if you are in doubt.

---

## 9. Things NOT to change without coordination

- Removing any invalidation call from §7. Every one of them is load-
  bearing for a specific discovery read.
- Narrowing `invalidateOwner` to a single key. The blunt pattern
  delete is a deliberate choice — §5.
- The mandatory pairing of marketing mutation → `invalidateOwner`.
  Per FR-019, new marketing services must follow the same DI + call
  pattern; the reviewer will reject a mutation that forgets it.
- The ordering of invalidation relative to the write for the tag
  mutations. Moving it after the write opens a small but real race
  window where a fresh read repopulates `paths:list:*` with
  pre-write data.
