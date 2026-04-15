import { Prisma } from '@prisma/client';
import { ListCoursesQueryDto } from './dto/list-courses.query.dto';

// Re-export applyIsFreeOverride from the path helper to honour DRY (T009 / Fix 5).
// The function is shape-polymorphic and works on any object with a nested
// sections/lessons array.
export { applyIsFreeOverride } from '../paths/path-stats.helper';

type LessonLike = { estimatedMinutes: number | null };
type SectionLike = { lessons: LessonLike[] };
type CourseLike = {
  sections: SectionLike[];
  _count?: { projects?: number };
};

export interface CourseStats {
  sectionCount: number;
  lessonCount: number;
  totalDurationMinutes: number;
  projectCount: number;
}

export function computeCourseStats(course: CourseLike): CourseStats {
  let lessonCount = 0;
  let totalDurationMinutes = 0;
  for (const section of course.sections) {
    lessonCount += section.lessons.length;
    for (const lesson of section.lessons) {
      totalDurationMinutes += lesson.estimatedMinutes ?? 0;
    }
  }
  return {
    sectionCount: course.sections.length,
    lessonCount,
    totalDurationMinutes,
    projectCount: course._count?.projects ?? 0,
  };
}

/**
 * Build the Prisma orderBy array for `GET /courses`. Per FR-030a the array MUST
 * always end with `{ id: 'asc' }` so paginated requests are deterministic.
 */
export function buildCourseOrderBy(
  query: ListCoursesQueryDto,
): Prisma.CourseOrderByWithRelationInput[] {
  const order = query.order ?? 'asc';
  const primary: Prisma.CourseOrderByWithRelationInput =
    query.sort === 'created_at'
      ? { createdAt: order }
      : query.sort === 'title'
        ? { title: order }
        : { order };
  return [primary, { id: 'asc' }];
}
