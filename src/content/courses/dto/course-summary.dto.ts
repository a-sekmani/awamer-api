import { CourseLevelFilter } from './list-courses.query.dto';
import {
  CategoryRefDto,
  TagRefDto,
  PaginatedResponse,
  PaginationMeta,
} from '../../paths/dto/path-summary.dto';

export class CoursePathRefDto {
  id!: string;
  slug!: string;
  title!: string;
}

export class CourseSummaryStatsDto {
  sectionCount!: number;
  lessonCount!: number;
  totalDurationMinutes!: number;
}

export class CourseSummaryDto {
  id!: string;
  slug!: string;
  title!: string;
  subtitle!: string | null;
  level!: CourseLevelFilter | null;
  thumbnail!: string | null;
  category!: CategoryRefDto;
  path!: CoursePathRefDto | null;
  tags!: TagRefDto[];
  isFree!: boolean;
  isNew!: boolean;
  stats!: CourseSummaryStatsDto;
}

export type { PaginatedResponse, PaginationMeta };
