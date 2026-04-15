# ReplaceTagAssociationsHelper — Backend Reference (awamer-api)

> **Class:** `ReplaceTagAssociationsHelper`
> **Source:** `src/content/tags/helpers/replace-tag-associations.helper.ts`
> **Module:** `TagsModule`
> **Used by:** `PathsService` / `CoursesService` admin CRUD (not yet
> exposed via the public admin endpoints, but imported for the
> upcoming path/course admin module)

This helper replaces the complete set of tag associations for a
given path or course, atomically, with validation that all provided
tags exist and are `ACTIVE`. It exists so that admin code can say
"the tags for this path are now `[A, B, C]`" without thinking about
the delta against the previous state.

---

## 1. Public methods

```ts
class ReplaceTagAssociationsHelper {
  async replaceForPath(pathId: string, tagIds: string[]): Promise<void>
  async replaceForCourse(courseId: string, tagIds: string[]): Promise<void>
}
```

Both have the same shape; only the target join table differs.

---

## 2. `replaceForPath(pathId, tagIds)`

1. **Open a transaction.** `prisma.$transaction(async (tx) => ...)`.
2. **Validate and dedupe** via the private `validateAndDedupe(tagIds, tx)`:
   - Deduplicate via `Array.from(new Set(tagIds))`. Empty arrays
     are allowed (they represent "remove all tags").
   - Early return when the deduped array is empty.
   - `tx.tag.findMany({ where: { id: { in: unique } }, select: { id, status } })`.
   - Build a `Map<id, status>`.
   - For each unique id:
     - Missing from the map → `NotFoundException(\`Tag '${id}' does not exist\`)`.
     - Status is not `ACTIVE` → `BadRequestException(\`Tag '${id}' is hidden and cannot be attached\`)`.
   - Return the unique array.
3. **Delete existing associations.** `tx.pathTag.deleteMany({ where: { pathId } })`.
4. **Insert new associations.** `tx.pathTag.createMany({ data: unique.map((tagId) => ({ pathId, tagId })) })`.
5. **Commit** the transaction.
6. **Invalidate after commit:**
   ```
   delByPattern paths:list:*
   delByPattern courses:list:*
   ```
   See FR-017a in the source file comment.

The transaction guarantees the "delete + insert" pair is atomic: a
concurrent reader never sees a path with zero tags during the swap.

`replaceForCourse` is identical with `pathTag` replaced by
`courseTag` and the `pathId` parameter replaced by `courseId`.

---

## 3. Why `$transaction`?

Two reasons:

1. **Atomicity.** Without a transaction, a reader querying `PathTag`
   between the `deleteMany` and the `createMany` would see the path
   with zero tags for a brief window. That would misreport the
   filter state in any cache that mirrors the association.
2. **Rollback on validation failure.** If `validateAndDedupe` throws
   after the `deleteMany` but before the `createMany`, the whole
   thing rolls back. In practice the helper calls
   `validateAndDedupe` **before** the delete, so this is just a
   safety net — but the safety net is worth having.

Note: the validation runs inside the transaction via the `tx` client.
Using the top-level `prisma` client instead would create a visibility
gap where a validated tag could be deleted by a concurrent tx before
the insert ran.

---

## 4. Empty-array semantics

Passing `tagIds: []` is a valid call:

1. `validateAndDedupe` returns `[]` immediately.
2. `deleteMany` removes every association for the owner.
3. `createMany` is skipped (`unique.length > 0` guard).

This is how "clear all tags for this path" is expressed.

---

## 5. Validation errors

| Status | When |
|--------|------|
| `404` (no `errorCode`) | At least one id in `tagIds` does not exist. |
| `400` (no `errorCode`) | At least one id exists but has `status: HIDDEN`. |

The helper stops on the **first** bad id in the iteration order. The
caller does not receive a multi-error list; if you need one, collect
inside `validateAndDedupe` and throw after the loop. The current
behavior matches FR-017 which specifies fail-fast.

---

## 6. Cache invalidation after commit

Only `paths:list:*` and `courses:list:*` are invalidated. The helper
does **not** touch `tags:all` — the tag rows themselves have not
changed, only their associations.

See [../cache/invalidation-flow.md §3](../cache/invalidation-flow.md)
for the placement of these calls in the full map.

---

## 7. Tests

| File | Covers |
|------|--------|
| `src/content/tags/helpers/replace-tag-associations.helper.spec.ts` | Happy path round-trip, dedupe, empty-array "clear", missing tag → 404, hidden tag → 400, atomicity (no partial state visible to concurrent readers), pattern invalidation calls fire after commit. |

The spec file must start with `import 'reflect-metadata';` — see
[../development/testing.md §4](../development/testing.md).

---

## 8. Files involved

| File | Role |
|------|------|
| `src/content/tags/helpers/replace-tag-associations.helper.ts` | The helper |
| `src/content/tags/tags.module.ts` | Provider registration + export |
| `src/common/cache/cache-keys.ts` | Pattern functions |

---

## 9. Things NOT to change without coordination

- The `validateAndDedupe` inside the transaction. Moving the
  validation outside re-opens a visibility gap.
- The fail-fast behavior. Collecting all bad ids would require a
  coordinated frontend error-shape change.
- The "empty array = clear" semantics. Any other interpretation
  (e.g. "empty array = no-op") would make it impossible to remove
  all tags from a path via the helper.
- The `HIDDEN` rejection on attach. Hidden tags should not be
  re-attached by accident; they are "retired".
- Omitting `tags:all` from the invalidation set. The tag rows
  themselves are unchanged by this helper; touching `tags:all`
  would be pointless churn.
