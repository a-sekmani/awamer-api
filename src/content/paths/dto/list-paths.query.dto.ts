import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export type PathLevel = 'beginner' | 'intermediate' | 'advanced';
export type PathSort = 'order' | 'created_at' | 'title';
export type SortOrder = 'asc' | 'desc';

export class ListPathsQueryDto {
  @IsOptional()
  @IsUUID(4, { message: 'categoryId must be a valid UUID' })
  categoryId?: string;

  @IsOptional()
  @IsUUID(4, { message: 'tagId must be a valid UUID' })
  tagId?: string;

  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced'])
  level?: PathLevel;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsEnum(['order', 'created_at', 'title'])
  sort?: PathSort = 'order';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: SortOrder = 'asc';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
