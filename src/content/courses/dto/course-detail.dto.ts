import { CourseLevelFilter } from './list-courses.query.dto';
import { CoursePathRefDto } from './course-summary.dto';
import { CategoryRefDto, TagRefDto } from '../../paths/dto/path-summary.dto';
import {
  CertificateDto,
  FaqDto,
  FeatureDto,
  TestimonialDto,
} from '../../paths/dto/path-detail.dto';

export class CourseLessonDto {
  id!: string;
  title!: string;
  type!: string;
  order!: number;
  estimatedMinutes!: number | null;
  isFree!: boolean;
}

export class CourseSectionDto {
  id!: string;
  title!: string;
  order!: number;
  lessons!: CourseLessonDto[];
}

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
  featuresIntro!: string | null;
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
  curriculum!: CourseSectionDto[];
  features!: FeatureDto[];
  faqs!: FaqDto[];
  testimonials!: TestimonialDto[];
}

// Re-export shared marketing types so consumers don't reach across DTO directories.
export { FaqDto, FeatureDto, TestimonialDto };
