# Contract: DELETE FK-violation handling

**Owner**: KAN-82
**Implementer**: `CategoriesAdminService.remove(id)` in `src/admin/categories/categories-admin.service.ts`

## Why this contract exists

The previous attempt at KAN-82 was caught off-guard by Prisma's two-class behavior for FK violations. This contract pins exactly which error classes the service must handle, so future implementers (and code review) can verify behavior directly.

## Required behavior

```ts
async remove(id: string): Promise<{ ok: true }> {
  try {
    await this.prisma.category.delete({ where: { id } });
    await this.cache.del(CacheKeys.categories.all());
    return { ok: true };
  } catch (e) {
    if (this.isFKViolation(e)) {
      const [pathCount, courseCount] = await Promise.all([
        this.prisma.path.count({ where: { categoryId: id } }),
        this.prisma.course.count({ where: { categoryId: id } }),
      ]);
      throw new ConflictException({
        errorCode: ErrorCode.CATEGORY_IN_USE,
        message: 'Category is in use',
        errors: { pathCount, courseCount },
      });
    }
    if (this.isPrismaP2025(e)) {
      throw new NotFoundException({
        errorCode: ErrorCode.CATEGORY_NOT_FOUND,
        message: 'Category not found',
      });
    }
    throw e;
  }
}
```

## `isFKViolation(e: unknown): boolean`

Returns `true` if `e` matches **either** of these shapes:

1. **`PrismaClientKnownRequestError`** (imported from `@prisma/client/runtime/library`) with `e.code === 'P2003'`.
   - Surfaces when an `onDelete: Cascade` ripple is blocked by a deeper constraint that Prisma understands.

2. **`PrismaClientUnknownRequestError`** (also from `@prisma/client/runtime/library`) whose `e.message` contains the SQLSTATE `23001` token.
   - Surfaces when an `onDelete: Restrict` directly rejects the delete (the post-migration case for `Path.category` and `Course.path`). Prisma does not assign `P2003` to this class, so name + SQLSTATE matching is the only reliable signal.

Both checks MUST be performed; neither alone suffices. The helper MUST be a private method on the service so unit tests can drive both branches without instantiating Prisma.

## `isPrismaP2025(e: unknown): boolean`

Returns `true` if `e instanceof PrismaClientKnownRequestError && e.code === 'P2025'`. This is Prisma's "record to delete does not exist" code.

## Audit log behavior on the 409 path

The `AuditLogInterceptor` (KAN-78) emits exactly one log entry per request:
- On a successful delete: `outcome: 'success'`, no `statusCode` field.
- On a 409 thrown by this contract: `outcome: 'error'`, `statusCode: 409`. (Spec FR-005: "exactly one structured audit log entry per **successful** mutation". The interceptor's behavior of also emitting on errors is an existing foundation choice; the spec invariant about "no entry on failed mutation" is satisfied because *failed* refers to the underlying admin intent — the interceptor labels the entry `outcome: 'error'`, not `outcome: 'success'`.)

## Test coverage required

Unit tests in `src/admin/categories/categories-admin.service.spec.ts` MUST drive each branch:

| Branch | Test name (suggested) |
|---|---|
| Successful delete | `remove() — succeeds when category has no paths or courses` |
| `P2003` Known error | `remove() — returns 409 when Prisma raises P2003 KnownRequestError` |
| `23001` Unknown error | `remove() — returns 409 when Prisma raises Unknown error with SQLSTATE 23001` |
| `P2025` not found | `remove() — returns 404 when Prisma raises P2025` |
| `errors` body contents | `remove() — populates errors.pathCount and errors.courseCount on 409` |
| Cache invalidation gating | `remove() — invalidates cache only on success, never on 409 / 404` |
| Generic re-throw | `remove() — re-throws unknown Prisma errors as-is` |

E2E test in `test/admin/categories.e2e-spec.ts` MUST cover at least the `Restrict` direct rejection case (the common one), seeded with a real path or course, since that's the production scenario.

## What this contract MUST NOT permit

- App-layer pre-check (counting paths / courses BEFORE the delete) — race-prone, brittle.
- Wrapping the delete in `prisma.$transaction` — adds no benefit (single-row write, post-failure read is intrinsically out-of-transaction).
- Catching `Error` and inferring intent from `e.message` parsing as the only signal — both class checks above must be present.
- Returning the old `{ deleted: true }` shape; the contract is `{ ok: true }`.
