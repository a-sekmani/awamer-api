// TODO(KAN-?-certificate-config): When the schema gains certificateText/
// certificateEnabled/certificateRequiresAwamerPlus columns on Path, replace
// this constant with a per-row read. For MVP, all paths grant a certificate
// and the text is uniform.
const PATH_CERTIFICATE_TEXT =
  'أكمل جميع دورات المسار للحصول على شهادة معتمدة';

import { CertificateDto, PathDetailDto } from './dto/path-detail.dto';
import { PathSummaryDto, PaginatedResponse } from './dto/path-summary.dto';
import { PathStats, normalizeLevel } from './path-stats.helper';

export function buildPathCertificate(path: { isFree: boolean }): CertificateDto {
  return {
    enabled: true,
    requiresAwamerPlus: !path.isFree,
    text: PATH_CERTIFICATE_TEXT,
  };
}

type CategoryRow = { id: string; name: string; slug: string };
type TagRow = { id: string; name: string; slug: string };
type TagJoinRow = { tag: TagRow };
type LessonRow = {
  estimatedMinutes: number | null;
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
  order: number | null;
  title: string;
  subtitle: string | null;
  isFree: boolean;
  sections: SectionRow[];
  _count?: { projects?: number };
};
type PathRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  featuresIntro: string | null;
  level: string | null;
  thumbnail: string | null;
  promoVideoUrl: string | null;
  promoVideoThumbnail: string | null;
  isFree: boolean;
  isNew: boolean;
  status: string;
  skills: unknown;
  category: CategoryRow;
  tags: TagJoinRow[];
  courses: CourseRow[];
};

function mapTags(tags: TagJoinRow[]) {
  return tags.map((t) => ({ id: t.tag.id, name: t.tag.name, slug: t.tag.slug }));
}

function mapCategory(c: CategoryRow) {
  return { id: c.id, name: c.name, slug: c.slug };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [];
}

export function toPathSummaryDto(
  path: PathRow,
  stats: PathStats,
): PathSummaryDto {
  return {
    id: path.id,
    slug: path.slug,
    title: path.title,
    subtitle: path.subtitle,
    level: normalizeLevel(path.level),
    thumbnail: path.thumbnail,
    category: mapCategory(path.category),
    tags: mapTags(path.tags),
    isFree: path.isFree,
    isNew: path.isNew,
    stats: {
      courseCount: stats.courseCount,
      lessonCount: stats.lessonCount,
      totalDurationMinutes: stats.totalDurationMinutes,
    },
  };
}

export function toPathDetailDto(
  path: PathRow,
  marketing: {
    features: PathDetailDto['features'];
    faqs: PathDetailDto['faqs'];
    testimonials: PathDetailDto['testimonials'];
  },
  stats: PathStats,
): PathDetailDto {
  const promoVideo =
    path.promoVideoUrl !== null
      ? { url: path.promoVideoUrl, thumbnail: path.promoVideoThumbnail }
      : null;

  const curriculum = path.courses.map((course) => ({
    id: course.id,
    slug: course.slug,
    order: course.order ?? 0,
    title: course.title,
    subtitle: course.subtitle,
    isFree: course.isFree,
    sections: course.sections.map((section) => {
      let totalDurationMinutes = 0;
      for (const lesson of section.lessons) {
        totalDurationMinutes += lesson.estimatedMinutes ?? 0;
      }
      return {
        id: section.id,
        title: section.title,
        order: section.order,
        totalDurationMinutes,
      };
    }),
  }));

  return {
    path: {
      id: path.id,
      slug: path.slug,
      title: path.title,
      subtitle: path.subtitle,
      description: path.description,
      featuresIntro: path.featuresIntro,
      level: normalizeLevel(path.level),
      thumbnail: path.thumbnail,
      promoVideo,
      isFree: path.isFree,
      isNew: path.isNew,
      status: path.status,
      skills: asStringArray(path.skills),
      category: mapCategory(path.category),
      tags: mapTags(path.tags),
      stats,
      certificate: buildPathCertificate({ isFree: path.isFree }),
    },
    curriculum,
    features: marketing.features,
    faqs: marketing.faqs,
    testimonials: marketing.testimonials,
  };
}

export function emptyPaginatedResponse<T>(
  page: number,
  limit: number,
): PaginatedResponse<T> {
  return {
    data: [],
    meta: { total: 0, page, limit, totalPages: 0 },
  };
}

// Exported for tests.
export const __TEST_ONLY__ = { PATH_CERTIFICATE_TEXT };
