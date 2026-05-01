import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Single item in a bulk reorder request: a target record's id and its new sortOrder.
 *
 * Used by per-entity admin sub-modules that mutate `sortOrder` across multiple
 * records of one entity in a single request (Sections, Lessons, Content Blocks,
 * possibly Paths and Courses). NOT used by Categories (Categories are sorted
 * by `createdAt DESC`).
 */
export class ReorderItemDto {
  @IsUUID('4')
  id!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

/**
 * Bulk reorder payload — an array of `{ id, sortOrder }` items.
 *
 * Validation:
 * - array length ≥ 1 (rejects empty arrays — a reorder with zero items is meaningless)
 * - no duplicate `id` values across items (a single id MUST NOT appear twice)
 * - each item validated nested as `ReorderItemDto`
 *
 * Note: duplicate `sortOrder` values across DIFFERENT ids are intentionally allowed
 * at the DTO layer — consumer services decide whether collisions are valid for
 * their entity.
 */
export class ReorderItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique<ReorderItemDto>((o) => o.id, {
    message: 'reorder items contain duplicate ids',
  })
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}
