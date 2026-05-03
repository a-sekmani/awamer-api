import 'reflect-metadata';
import {
  applyIsFreeOverride,
  buildCourseOrderBy,
  computeCourseStats,
} from './course-stats.helper';
import { ListCoursesQueryDto } from './dto/list-courses.query.dto';

describe('computeCourseStats', () => {
  it('sums sections, lessons, durations, and project count', () => {
    const course = {
      sections: [
        {
          lessons: [{ estimatedMinutes: 10 }, { estimatedMinutes: 20 }],
        },
        { lessons: [{ estimatedMinutes: null }, { estimatedMinutes: 5 }] },
      ],
      _count: { projects: 4 },
    };
    expect(computeCourseStats(course)).toEqual({
      sectionCount: 2,
      lessonCount: 4,
      totalDurationMinutes: 35,
      projectCount: 4,
    });
  });

  it('handles a course with zero sections', () => {
    expect(
      computeCourseStats({ sections: [], _count: { projects: 0 } }),
    ).toEqual({
      sectionCount: 0,
      lessonCount: 0,
      totalDurationMinutes: 0,
      projectCount: 0,
    });
  });
});

describe('applyIsFreeOverride (re-exported)', () => {
  it('flips every nested lesson on a course-shaped object', () => {
    const course = {
      sections: [
        {
          lessons: [
            { isFree: false, estimatedMinutes: 10 },
            { isFree: false, estimatedMinutes: 20 },
          ],
        },
      ],
    };
    applyIsFreeOverride(course);
    expect(course.sections[0].lessons.every((l) => l.isFree)).toBe(true);
  });
});

describe('buildCourseOrderBy (FR-030a)', () => {
  function q(over: Partial<ListCoursesQueryDto> = {}): ListCoursesQueryDto {
    return Object.assign(new ListCoursesQueryDto(), over);
  }

  it('default query → [{ order: asc }, { id: asc }]', () => {
    expect(buildCourseOrderBy(q())).toEqual([{ order: 'asc' }, { id: 'asc' }]);
  });

  it('?sort=title&order=desc → [{ title: desc }, { id: asc }]', () => {
    expect(buildCourseOrderBy(q({ sort: 'title', order: 'desc' }))).toEqual([
      { title: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('?sort=created_at&order=desc → [{ createdAt: desc }, { id: asc }]', () => {
    expect(
      buildCourseOrderBy(q({ sort: 'created_at', order: 'desc' })),
    ).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });
});
