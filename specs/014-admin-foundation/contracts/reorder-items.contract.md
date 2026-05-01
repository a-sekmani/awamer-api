# Contract: `ReorderItemsDto`

**Feature**: 014-admin-foundation
**Location**: `src/admin/common/dto/reorder-items.dto.ts`
**Consumers**: future admin sub-modules — Sections, Lessons, Content Blocks, possibly Paths and Courses. NOT used by Categories.

## Purpose

A reusable, validated payload shape for any admin endpoint that mutates `sortOrder` across multiple records of one entity in a single request (bulk reorder). The DTO contains only the validation primitive — service-layer handling (transactional `updateMany`, etc.) is each consumer's responsibility.

## TypeScript shape (target)

```ts
import { ArrayMinSize, ArrayUnique, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReorderItemDto {
  @IsUUID('4')
  id!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((o: ReorderItemDto) => o.id, { message: 'reorder items contain duplicate ids' })
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}
```

## Validation matrix

| Input | Outcome |
|---|---|
| `{ "items": [{ "id": "<uuid>", "sortOrder": 0 }] }` | ✅ valid (single item) |
| `{ "items": [{ "id": "<uuid>", "sortOrder": 0 }, { "id": "<uuid2>", "sortOrder": 1 }] }` | ✅ valid (two unique items) |
| `{ "items": [{ "id": "<uuid>", "sortOrder": 5 }, { "id": "<uuid2>", "sortOrder": 5 }] }` | ✅ valid — duplicate `sortOrder` allowed at DTO layer; consumer service decides |
| `{ "items": [] }` | ❌ rejected — `ArrayMinSize(1)` |
| `{ "items": [{ "id": "<uuid>", "sortOrder": 0 }, { "id": "<uuid>", "sortOrder": 1 }] }` | ❌ rejected — `ArrayUnique` (duplicate id) |
| `{ "items": [{ "id": "not-a-uuid", "sortOrder": 0 }] }` | ❌ rejected — `IsUUID('4')` |
| `{ "items": [{ "id": "<uuid>", "sortOrder": -1 }] }` | ❌ rejected — `Min(0)` |
| `{ "items": [{ "id": "<uuid>", "sortOrder": 1.5 }] }` | ❌ rejected — `IsInt` |
| `{ "items": [{ "id": "<uuid>", "sortOrder": "0" }] }` | ❌ rejected — `IsInt` (string instead of number) |
| `{ "items": [{ "id": "<uuid>" }] }` | ❌ rejected — `sortOrder` missing |
| `{ "items": [{ "sortOrder": 0 }] }` | ❌ rejected — `id` missing |
| `{ }` | ❌ rejected — `IsArray` (`items` undefined) |
| `{ "items": "not-an-array" }` | ❌ rejected — `IsArray` |

## Error response shape (via existing global filter)

```json
{
  "statusCode": 422,
  "errorCode": "VALIDATION_FAILED",
  "message": "Validation failed",
  "errors": [
    "items.0.id must be a UUID",
    "items.1.sortOrder must not be less than 0",
    "reorder items contain duplicate ids"
  ]
}
```

(The `statusCode` may be `400` rather than `422` depending on the global `ValidationPipe`'s `errorHttpStatusCode` setting — current project default is unspecified; either is acceptable. The contract is on the SHAPE, not the status code.)

## Unit test coverage (FR-013)

| Test ID | Input | Expected |
|---|---|---|
| DTO-T01 | Valid single item. | No validation errors. |
| DTO-T02 | Valid multi item, all-unique ids. | No validation errors. |
| DTO-T03 | Valid multi item, duplicate `sortOrder` across different ids. | No validation errors. |
| DTO-T04 | Empty `items: []`. | Validation error mentioning `items` minimum size. |
| DTO-T05 | `items` missing entirely. | Validation error mentioning `items` must be array. |
| DTO-T06 | Non-UUID `id`. | Validation error mentioning `id`. |
| DTO-T07 | Negative `sortOrder`. | Validation error mentioning `sortOrder` minimum. |
| DTO-T08 | Non-integer `sortOrder` (1.5). | Validation error mentioning `sortOrder` int. |
| DTO-T09 | Duplicate ids across two items. | Validation error mentioning duplicate ids. |
| DTO-T10 | Missing `id` field on an item. | Validation error mentioning `id`. |
| DTO-T11 | Missing `sortOrder` field on an item. | Validation error mentioning `sortOrder`. |

Run via `class-validator`'s `validate()` directly in the unit spec — no Nest module setup needed for this DTO's tests.
