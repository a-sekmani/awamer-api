# ReorderItemsDto — Backend Reference (awamer-api)

> **Classes:** `ReorderItemDto`, `ReorderItemsDto`
> **Source:** `src/admin/common/dto/reorder-items.dto.ts`
> **Decorator stack:** `class-validator` + `class-transformer`
> **Enforced by:** the global `ValidationPipe` configured in `src/main.ts`

`ReorderItemsDto` is the shared admin primitive for bulk reorder
endpoints — any handler that needs to mutate `sortOrder` across
multiple records of one entity in a single request. Defined here once,
imported by every per-entity admin sub-module that supports manual
ordering. Future admin sub-modules MUST NOT redefine an equivalent
DTO.

---

## 1. Summary

The DTO accepts `{ items: Array<{ id: UUID, sortOrder: non-negative integer }> }`.
At least one item is required. No `id` may appear twice. Each item is
validated nested as a `ReorderItemDto`. Duplicate `sortOrder` values
across different ids are intentionally allowed at the DTO layer —
collision policy is a consumer-service decision, not a validation
decision.

The DTO produces no business-logic effects. Validation failures
short-circuit at the global `ValidationPipe` and surface as
`VALIDATION_FAILED` through the global `HttpExceptionFilter`. Consumer
services receive a `ReorderItemsDto` instance only when every item is
already valid.

---

## 2. Shape

Source for both classes (`ReorderItemDto` and `ReorderItemsDto`):
`src/admin/common/dto/reorder-items.dto.ts:20–50`.

```ts
export class ReorderItemDto {
  @IsUUID('4')                                 // line 21
  id!: string;

  @IsInt()                                     // line 24
  @Min(0)                                      // line 25
  sortOrder!: number;
}

export class ReorderItemsDto {
  @IsArray()                                   // line 42
  @ArrayMinSize(1)                             // line 43
  @ArrayUnique<ReorderItemDto>((o) => o.id, {  // lines 44–46
    message: 'reorder items contain duplicate ids',
  })
  @ValidateNested({ each: true })              // line 47
  @Type(() => ReorderItemDto)                  // line 48
  items!: ReorderItemDto[];
}
```

| Field | Decorators | Meaning |
|---|---|---|
| `ReorderItemDto.id` | `@IsUUID('4')` | UUID v4 only — Prisma generates v4 by default for every primary key in this project. |
| `ReorderItemDto.sortOrder` | `@IsInt()` + `@Min(0)` | Non-negative integer. `0` is valid. `1.5` is rejected. `-1` is rejected. |
| `ReorderItemsDto.items` | `@IsArray()` + `@ArrayMinSize(1)` + `@ArrayUnique(o => o.id)` + `@ValidateNested({ each: true })` + `@Type(() => ReorderItemDto)` | The array of items. Empty array rejected. Duplicate ids rejected. Each item validated as a nested `ReorderItemDto` — the `@Type(() => ReorderItemDto)` is what enables `class-transformer` to build the nested instances so `class-validator` can walk them. |

The `@Type(() => ReorderItemDto)` decorator is **required** for the
nested validation to fire — without it, `class-transformer` leaves
items as plain objects and `@ValidateNested` has nothing to recurse
into. This is a `class-validator` footgun; do not remove the
`@Type` line when refactoring.

---

## 3. Validation matrix

Asserted by 11 unit cases (`DTO-T01`..`DTO-T11`) in
`src/admin/common/dto/reorder-items.dto.spec.ts`.

| Case | Payload | Result |
|---|---|---|
| `DTO-T01` | `{ items: [{ id: <uuid v4>, sortOrder: 0 }] }` | ✅ valid (single item) |
| `DTO-T02` | Two items, both UUID v4, distinct ids, distinct `sortOrder` | ✅ valid |
| `DTO-T03` | Two items, distinct ids, same `sortOrder` | ✅ valid (collision policy is consumer-service business) |
| `DTO-T04` | `{ items: [] }` | ❌ `@ArrayMinSize(1)` |
| `DTO-T05` | `{}` (no `items` key) | ❌ `@IsArray()` |
| `DTO-T06` | Item with `id: 'not-a-uuid'` | ❌ `@IsUUID('4')` |
| `DTO-T07` | Item with `sortOrder: -1` | ❌ `@Min(0)` |
| `DTO-T08` | Item with `sortOrder: 1.5` | ❌ `@IsInt()` |
| `DTO-T09` | Two items with the same `id` | ❌ `@ArrayUnique` — message: `'reorder items contain duplicate ids'` |
| `DTO-T10` | Item missing `id` | ❌ `@IsUUID('4')` (validator runs against `undefined`) |
| `DTO-T11` | Item missing `sortOrder` | ❌ `@IsInt()` |

**Important — UUID version**: `@IsUUID('4')` is strict on the version
nibble of the third group (the digit after the second hyphen). UUID v4
encodes a `4` there; v1/v3/v5 do not. A test fixture using a v5-shaped
UUID was caught during KAN-78 implementation — see the spec note in
`src/admin/common/dto/reorder-items.dto.spec.ts` for the working v4
fixtures (`UUID_A` and `UUID_B`).

---

## 4. Error response shape

Validation failures are caught by the global `ValidationPipe`
(configured `whitelist: true, forbidNonWhitelisted: true, transform: true`
in `src/main.ts`) and re-thrown as `BadRequestException` carrying a
`message: string[]`. The global `HttpExceptionFilter`
(`src/common/filters/http-exception.filter.ts:46–49`) converts that
array into `errors[]` and sets `errorCode: 'VALIDATION_FAILED'`.

```json
{
  "statusCode": 400,
  "errorCode": "VALIDATION_FAILED",
  "message": "Validation failed",
  "errors": [
    "items.0.id must be a UUID",
    "items.1.sortOrder must not be less than 0"
  ]
}
```

> The status is `400` because `ValidationPipe`'s default is
> `BadRequestException`. There is no project-wide override to `422`.
> Frontend code switches on `errorCode === 'VALIDATION_FAILED'`, not
> the status code.

---

## 5. Who uses it (and who doesn't)

### Future consumers (admin sub-modules added after KAN-78)

| Entity | Status | Why |
|---|---|---|
| **Sections** | Will use | Sections are ordered within a course; admins reorder them. |
| **Lessons** | Will use | Lessons are ordered within a section. |
| **Content Blocks** | Will use | Blocks are ordered within a lesson. |
| **Paths** | May use | Paths sort by `sortOrder` on category landing pages. If admin reorder ships, this DTO is the contract. |
| **Courses** | May use | Courses sort by `sortOrder` within a path. Same reasoning. |

### Explicitly NOT a consumer

| Entity | Why |
|---|---|
| **Categories** | Categories are sorted by `createdAt DESC` on the public discovery surface. There is no manual ordering, so there is no admin reorder endpoint, so there is nothing to validate with this DTO. Re-introducing manual category ordering would be a product decision; until then the DTO stays unused on this entity. |

This is a deliberate constraint inherited from KAN-26 (public
discovery): categories' surface area is intentionally minimal so that
new categories appear in a predictable position without admin
intervention.

### Import convention

Future consumers import the DTO directly from this file:

```ts
import { ReorderItemsDto } from 'src/admin/common/dto/reorder-items.dto';

@Patch('reorder')
async reorder(@Body() dto: ReorderItemsDto) {
  return this.service.reorder(dto.items);
}
```

Do **not** redefine `ReorderItemsDto` inside a sub-module's `dto/`
folder. The whole point of placing it under `src/admin/common/dto/` is
that there is one canonical contract for every admin reorder endpoint.

---

## 6. Files involved

| File | Role |
|---|---|
| `src/admin/common/dto/reorder-items.dto.ts` | The DTO definitions. |
| `src/main.ts` | Configures the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) that enforces the DTO. |
| `src/common/filters/http-exception.filter.ts` | Translates a `class-validator` array of messages into the `errors[]` field and sets `errorCode: 'VALIDATION_FAILED'`. |
| `src/common/error-codes.enum.ts` | `VALIDATION_FAILED`. |

---

## 7. Tests

| File | Covers |
|---|---|
| `src/admin/common/dto/reorder-items.dto.spec.ts` | 11 unit cases (`DTO-T01`..`DTO-T11`) covering every constraint: valid single + multi item, allowed sortOrder collision, empty array, missing items key, non-UUID id, negative sortOrder, non-integer sortOrder, duplicate ids, missing id field, missing sortOrder field. The spec uses `class-validator`'s `validate()` directly with `plainToInstance` from `class-transformer` — no Nest TestingModule needed; the DTO has no service dependencies. |

When a per-entity admin endpoint adopts the DTO (Sections, Lessons,
Content Blocks, …), the new endpoint's e2e spec is responsible for
covering the integration path (the global `ValidationPipe` + the
global `HttpExceptionFilter` + the actual response shape). Those
integration assertions belong with the consumer endpoint, not here.

---

## 8. Things NOT to change without coordination

- **The location.** `src/admin/common/dto/reorder-items.dto.ts` is the
  canonical path. Moving the file changes every consumer's import. If
  the file does need to move, every consumer must be updated in the
  same change.
- **The shape.** Adding optional fields (e.g. a `parentId` for nested
  reorders) would break the "one shape for every admin reorder
  endpoint" guarantee. New fields belong in entity-specific
  extension DTOs that include `ReorderItemsDto` as a member, not
  inline.
- **`@IsUUID('4')` vs `@IsUUID()`.** Loosening to any version would
  silently accept ids the database did not generate (Prisma generates
  v4 only). Tightening to a custom regex would risk false positives.
- **`@ArrayUnique<ReorderItemDto>((o) => o.id, ...)` selector.**
  Removing the type parameter or the selector function reverts to
  default reference-equality, which is meaningless for plain-object
  items and silently lets duplicates through.
- **The `@Type(() => ReorderItemDto)` decorator.** Removing it skips
  nested validation (see §2). The `@ValidateNested({ each: true })`
  decorator is the one that triggers recursion; `@Type` is what
  builds the recursable instances. Both are required.
- **The custom message `'reorder items contain duplicate ids'`.**
  E2E tests, frontend toasts, and possibly external API consumers
  match on this string. Renaming it requires a coordinated update.
- **The exclusion of Categories.** If product ever wants manual
  category ordering, that is a separate feature that brings back
  category-level `sortOrder` into the schema. Adding Categories to
  the consumer list before that schema change ships does nothing
  useful.
