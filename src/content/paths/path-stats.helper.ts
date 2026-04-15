import { Prisma } from '@prisma/client';
import { ListPathsQueryDto, PathLevel } from './dto/list-paths.query.dto';

/**
 * Lessons we know how to override / count. The underlying Prisma row may carry
 * extra fields (createdAt, sectionId, …) — we only care about isFree and
 * estimatedMinutes.
 */
type LessonLike = { isFree: boolean; estimatedMinutes: number | null };
type SectionLike = { lessons: LessonLike[] };
type CourseLike = {
  sections: SectionLike[];
  _count?: { projects?: number };
};
type PathLike = {
  isFree: boolean;
  courses: CourseLike[];
};

export interface PathStats {
  courseCount: number;
  lessonCount: number;
  totalDurationMinutes: number;
  projectCount: number;
}

export function computePathStats(path: PathLike): PathStats {
  let lessonCount = 0;
  let totalDurationMinutes = 0;
  let projectCount = 0;
  for (const course of path.courses) {
    for (const section of course.sections) {
      lessonCount += section.lessons.length;
      for (const lesson of section.lessons) {
        totalDurationMinutes += lesson.estimatedMinutes ?? 0;
      }
    }
    projectCount += course._count?.projects ?? 0;
  }
  return {
    courseCount: path.courses.length,
    lessonCount,
    totalDurationMinutes,
    projectCount,
  };
}

/**
 * Mutates every nested lesson's `isFree` to `true`. Used when the parent path
 * (or course) is itself free — design rule from API Design §5.4.
 *
 * Generic enough to accept either a Path-shaped object (courses → sections →
 * lessons) or a Course-shaped object (sections → lessons).
 */
export function applyIsFreeOverride(
  parent: { courses?: CourseLike[]; sections?: SectionLike[] },
): void {
  if (parent.courses) {
    for (const course of parent.courses) {
      for (const section of course.sections) {
        for (const lesson of section.lessons) {
          lesson.isFree = true;
        }
      }
    }
  }
  if (parent.sections) {
    for (const section of parent.sections) {
      for (const lesson of section.lessons) {
        lesson.isFree = true;
      }
    }
  }
}

/**
 * Path.level is stored as `String?` (Decision D — schema is frozen). Validate
 * incoming or stored values against the canonical lowercase enum and return
 * `null` on anything else.
 */
const LEVELS: ReadonlySet<PathLevel> = new Set([
  'beginner',
  'intermediate',
  'advanced',
]);

export function normalizeLevel(value: string | null): PathLevel | null {
  if (value === null || value === undefined) return null;
  const lower = value.toLowerCase();
  return LEVELS.has(lower as PathLevel) ? (lower as PathLevel) : null;
}

/**
 * Build the Prisma orderBy array for `GET /paths`. Per FR-030a the array MUST
 * always end with `{ id: 'asc' }` so paginated requests return deterministic
 * row ordering even when the primary sort key has ties.
 */
export function buildOrderBy(
  query: ListPathsQueryDto,
): Prisma.PathOrderByWithRelationInput[] {
  const order = query.order ?? 'asc';
  const primary: Prisma.PathOrderByWithRelationInput =
    query.sort === 'created_at'
      ? { createdAt: order }
      : query.sort === 'title'
        ? { title: order }
        : { order };
  return [primary, { id: 'asc' }];
}
