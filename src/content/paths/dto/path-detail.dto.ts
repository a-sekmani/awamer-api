import { CategoryRefDto, TagRefDto } from './path-summary.dto';
import { PathLevel } from './list-paths.query.dto';

export class PromoVideoDto {
  url!: string;
  thumbnail!: string | null;
}

export class CertificateDto {
  enabled!: boolean;
  requiresAwamerPlus!: boolean;
  text!: string;
}

export class PathDetailStatsDto {
  courseCount!: number;
  lessonCount!: number;
  totalDurationMinutes!: number;
  projectCount!: number;
}

export class PathLessonDto {
  id!: string;
  title!: string;
  type!: string;
  order!: number;
  estimatedMinutes!: number | null;
  isFree!: boolean;
}

export class PathSectionDto {
  id!: string;
  title!: string;
  order!: number;
  totalDurationMinutes!: number;
}

export class CourseInPathDto {
  id!: string;
  slug!: string;
  order!: number;
  title!: string;
  subtitle!: string | null;
  isFree!: boolean;
  sections!: PathSectionDto[];
}

export class FeatureDto {
  id!: string;
  title!: string;
  description!: string | null;
  icon!: string | null;
  order!: number;
}

export class FaqDto {
  id!: string;
  question!: string;
  answer!: string;
  order!: number;
}

export class TestimonialDto {
  id!: string;
  authorName!: string;
  authorTitle!: string | null;
  authorAvatar!: string | null;
  body!: string;
  rating!: number | null;
  order!: number;
}

export class PathCoreDto {
  id!: string;
  slug!: string;
  title!: string;
  subtitle!: string | null;
  description!: string | null;
  featuresIntro!: string | null;
  level!: PathLevel | null;
  thumbnail!: string | null;
  promoVideo!: PromoVideoDto | null;
  isFree!: boolean;
  isNew!: boolean;
  status!: string;
  skills!: string[];
  category!: CategoryRefDto;
  tags!: TagRefDto[];
  stats!: PathDetailStatsDto;
  certificate!: CertificateDto;
}

export class PathDetailDto {
  path!: PathCoreDto;
  curriculum!: CourseInPathDto[];
  features!: FeatureDto[];
  faqs!: FaqDto[];
  testimonials!: TestimonialDto[];
}
