import { PathLevel } from './list-paths.query.dto';

export class CategoryRefDto {
  id!: string;
  name!: string;
  slug!: string;
}

export class TagRefDto {
  id!: string;
  name!: string;
  slug!: string;
}

export class PathStatsDto {
  courseCount!: number;
  lessonCount!: number;
  totalDurationMinutes!: number;
}

export class PathSummaryDto {
  id!: string;
  slug!: string;
  title!: string;
  subtitle!: string | null;
  level!: PathLevel | null;
  thumbnail!: string | null;
  category!: CategoryRefDto;
  tags!: TagRefDto[];
  isFree!: boolean;
  isNew!: boolean;
  stats!: PathStatsDto;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}
