import { CourseLevelFilter } from './list-courses.query.dto';
import { CoursePathRefDto } from './course-summary.dto';
import {
  CategoryRefDto,
  TagRefDto,
} from '../../paths/dto/path-summary.dto';
import {
  CertificateDto,
  FaqDto,
  FeatureDto,
  PathLessonDto,
  PathSectionDto,
  TestimonialDto,
} from '../../paths/dto/path-detail.dto';

export class CourseDetailStatsDto {
  sectionCount!: number;
  lessonCount!: number;
  totalDurationMinutes!: number;
  projectCount!: number;
}

export class CourseCoreDto {
  id!: string;
  slug!: string;
  title!: string;
  subtitle!: string | null;
  description!: string | null;
  level!: CourseLevelFilter | null;
  thumbnail!: string | null;
  isFree!: boolean;
  isNew!: boolean;
  status!: string;
  skills!: string[];
  category!: CategoryRefDto;
  parentPath!: CoursePathRefDto | null;
  tags!: TagRefDto[];
  stats!: CourseDetailStatsDto;
  certificate!: CertificateDto;
}

export class CourseDetailDto {
  course!: CourseCoreDto;
  curriculum!: PathSectionDto[];
  features!: FeatureDto[];
  faqs!: FaqDto[];
  testimonials!: TestimonialDto[];
}

// Re-export shared types so consumers don't reach across DTO directories.
export { FaqDto, FeatureDto, PathLessonDto, PathSectionDto, TestimonialDto };
