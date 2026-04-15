import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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

export type CourseLevelFilter = 'beginner' | 'intermediate' | 'advanced';
export type CourseSort = 'order' | 'created_at' | 'title';
export type SortOrder = 'asc' | 'desc';

export class ListCoursesQueryDto {
  @IsOptional()
  @IsUUID(4)
  categoryId?: string;

  @IsOptional()
  @IsUUID(4)
  tagId?: string;

  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced'])
  level?: CourseLevelFilter;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsUUID(4)
  pathId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  standalone?: boolean;

  @IsOptional()
  @IsEnum(['order', 'created_at', 'title'])
  sort?: CourseSort = 'order';

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
