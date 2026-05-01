// TODO(KAN-?-certificate-config): When the schema gains certificateText/
// certificateEnabled/certificateRequiresAwamerPlus columns on Course, replace
// this constant with a per-row read. For MVP, all courses grant a certificate
// and the text is uniform.
const COURSE_CERTIFICATE_TEXT = 'أكمل الدورة للحصول على شهادة معتمدة';

import { CourseLevelFilter } from './dto/list-courses.query.dto';
import {
  CourseDetailDto,
  CourseCoreDto,
  CourseSectionDto,
  FaqDto,
  FeatureDto,
  TestimonialDto,
} from './dto/course-detail.dto';
import { CourseSummaryDto } from './dto/course-summary.dto';
import { CertificateDto } from '../paths/dto/path-detail.dto';
import { CourseStats } from './course-stats.helper';

export function buildCourseCertificate(course: {
  isFree: boolean;
}): CertificateDto {
  return {
    enabled: true,
    requiresAwamerPlus: !course.isFree,
    text: COURSE_CERTIFICATE_TEXT,
  };
}

type CategoryRow = { id: string; name: string; slug: string };
type TagRow = { id: string; name: string; slug: string };
type TagJoinRow = { tag: TagRow };
type PathRow = { id: string; slug: string; title: string };
type LessonRow = {
  id: string;
  title: string;
  type: string;
  order: number;
  estimatedMinutes: number | null;
  isFree: boolean;
};
type SectionRow = {
  id: string;
  title: string;
  order: number;
  lessons: LessonRow[];
};
type CourseRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  featuresIntro: string | null;
  level: string | null;
  thumbnail: string | null;
  isFree: boolean;
  isNew: boolean;
  status: string;
  skills: unknown;
  pathId: string | null;
  category: CategoryRow;
  path?: PathRow | null;
  tags: TagJoinRow[];
  sections: SectionRow[];
  _count?: { projects?: number };
};

function lowercaseLevel(value: string | null): CourseLevelFilter | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === 'beginner' || lower === 'intermediate' || lower === 'advanced') {
    return lower;
  }
  return null;
}

function mapCategory(c: CategoryRow) {
  return { id: c.id, name: c.name, slug: c.slug };
}

function mapTags(tags: TagJoinRow[]) {
  return tags.map((t) => ({ id: t.tag.id, name: t.tag.name, slug: t.tag.slug }));
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [];
}

export function toCourseSummaryDto(
  course: CourseRow,
  stats: CourseStats,
): CourseSummaryDto {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    level: lowercaseLevel(course.level),
    thumbnail: course.thumbnail,
    category: mapCategory(course.category),
    path: course.path
      ? { id: course.path.id, slug: course.path.slug, title: course.path.title }
      : null,
    tags: mapTags(course.tags),
    isFree: course.isFree,
    isNew: course.isNew,
    stats: {
      sectionCount: stats.sectionCount,
      lessonCount: stats.lessonCount,
      totalDurationMinutes: stats.totalDurationMinutes,
    },
  };
}

export function toCourseDetailDto(
  course: CourseRow,
  marketing: {
    features: FeatureDto[];
    faqs: FaqDto[];
    testimonials: TestimonialDto[];
  },
  stats: CourseStats,
): CourseDetailDto {
  const curriculum: CourseSectionDto[] = course.sections.map((section) => ({
    id: section.id,
    title: section.title,
    order: section.order,
    lessons: section.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      type: lesson.type,
      order: lesson.order,
      estimatedMinutes: lesson.estimatedMinutes,
      isFree: lesson.isFree,
    })),
  }));

  const core: CourseCoreDto = {
    id: course.id,
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    featuresIntro: course.featuresIntro,
    level: lowercaseLevel(course.level),
    thumbnail: course.thumbnail,
    isFree: course.isFree,
    isNew: course.isNew,
    status: course.status,
    skills: asStringArray(course.skills),
    category: mapCategory(course.category),
    parentPath: course.path
      ? { id: course.path.id, slug: course.path.slug, title: course.path.title }
      : null,
    tags: mapTags(course.tags),
    stats: {
      sectionCount: stats.sectionCount,
      lessonCount: stats.lessonCount,
      totalDurationMinutes: stats.totalDurationMinutes,
      projectCount: stats.projectCount,
    },
    certificate: buildCourseCertificate({ isFree: course.isFree }),
  };

  return {
    course: core,
    curriculum,
    features: marketing.features,
    faqs: marketing.faqs,
    testimonials: marketing.testimonials,
  };
}

export const __TEST_ONLY__ = { COURSE_CERTIFICATE_TEXT };
