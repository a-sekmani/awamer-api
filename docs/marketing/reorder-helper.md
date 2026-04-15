# ReorderHelper — Backend Reference (awamer-api)

> **Class:** `ReorderHelper`
> **Source:** `src/content/marketing/helpers/reorder.helper.ts`
> **Used by:** `FeaturesService.reorder`, `FaqsService.reorder`, `TestimonialsService.reorder`

Shared helper that atomically reassigns the `order` column for
every marketing row belonging to a given owner, to match a
client-provided id list.

---

## 1. Public API

```ts
type ReorderableModel = 'feature' | 'faq' | 'testimonial';

async reorder(
  model: ReorderableModel,
  ownerType: MarketingOwnerType,
  ownerId: string,
  itemIds: string[],
): Promise<void>
```

A single helper instance serves all three models. Dispatch to
the right Prisma delegate is done via a `switch` because Prisma's
generated types are not structurally compatible across models —
`prisma.feature.update` and `prisma.faq.update` do not share a
common update signature.

---

## 2. Validation steps

Before touching the DB, the helper runs two assertions:

### 2.1 `assertNoDuplicates(itemIds)`
Walks the array and maintains a `Set<string>`. Throws
`BadRequestException(\`Reorder list contains duplicate id '${id}'\`)`
on the first repeated id.

### 2.2 `assertSetEquality(currentIds, itemIds)`
Builds two `Set<string>`s and throws a precise
`BadRequestException` on any of:

- Size mismatch
  (`Reorder list size mismatch: owner has N items but request provided M`).
- An id in the request that does not belong to the owner
  (`Reorder list contains id 'X' which does not belong to this owner`).
- An id on the owner that is missing from the request
  (`Reorder list is missing id 'X' which belongs to this owner`).

The messages are intentionally specific so the admin UI can
surface a useful diagnostic.

### 2.3 `fetchCurrentIds`
Reads `[id]` for every row with `(ownerType, ownerId)` from the
right model. Uses the same `switch` on `model` as the update
step. Does not include an ordering — set equality is the only
consumer.

---

## 3. Atomic update

```ts
await this.prisma.$transaction(
  itemIds.map((id, index) => this.buildUpdate(model, id, index)),
);
```

One Prisma update per item, batched as a transaction. Each row
ends with `order: <index>` where `index` is its position in the
client-provided array. The transaction commits atomically — a
failure partway through leaves the old ordering intact.

There is no optimistic-locking step and no "version" column. The
helper assumes the admin UI has just loaded the list and the
client-provided ids match the current state; the set-equality
check rejects any request that no longer does.

---

## 4. Return value

Returns `void`. The caller is responsible for re-listing the
rows (typically via `listByOwner`) if it needs to return the
updated order to the client. All three service `reorder` methods
do exactly that:

```ts
async reorder(ownerType, ownerId, itemIds) {
  await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
  await this.reorderHelper.reorder('feature', ownerType, ownerId, itemIds);
  await this.cache.invalidateOwner(scope, ownerId);
  // ... revalidate
  return this.listByOwner(ownerType, ownerId);
}
```

---

## 5. Tests

| File | Covers |
|------|--------|
| `src/content/marketing/helpers/reorder.helper.spec.ts` | Duplicate rejection, set-equality rejection (extra id, missing id, size mismatch), happy path assigns `0..n-1` in the client-provided order, atomicity (one failing update rolls everything back), all three models via the switch. |

---

## 6. Files involved

| File | Role |
|------|------|
| `src/content/marketing/helpers/reorder.helper.ts` | The class |
| `src/content/marketing/marketing.module.ts` | Provider registration + export |

---

## 7. Things NOT to change without coordination

- The set-equality check. Skipping it would allow partial
  reorders that leave the owner in an inconsistent state.
- The "dispatch on `model` via switch" pattern. Attempting to
  parameterize the Prisma delegate is a type-system fight for no
  correctness benefit.
- The transaction scope. A non-transactional loop would leak a
  partially-reordered state to concurrent readers.
- The `void` return. Moving the re-list inside the helper would
  couple it to the DTO shape of whichever service is calling.
