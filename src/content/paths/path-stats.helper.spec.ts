import 'reflect-metadata';
import {
  applyIsFreeOverride,
  buildOrderBy,
  computePathStats,
  normalizeLevel,
} from './path-stats.helper';
import { ListPathsQueryDto } from './dto/list-paths.query.dto';

function lesson(estimatedMinutes: number | null, isFree = false) {
  return { isFree, estimatedMinutes };
}

describe('normalizeLevel', () => {
  it('returns lowercase canonical values as-is', () => {
    expect(normalizeLevel('beginner')).toBe('beginner');
    expect(normalizeLevel('intermediate')).toBe('intermediate');
    expect(normalizeLevel('advanced')).toBe('advanced');
  });

  it('lowercases uppercase input', () => {
    expect(normalizeLevel('BEGINNER')).toBe('beginner');
    expect(normalizeLevel('Advanced')).toBe('advanced');
  });

  it('returns null for non-canonical values', () => {
    expect(normalizeLevel('expert')).toBeNull();
    expect(normalizeLevel('')).toBeNull();
    expect(normalizeLevel(null)).toBeNull();
  });
});

describe('computePathStats', () => {
  it('sums lessons and durations across all courses and sections', () => {
    const path = {
      isFree: false,
      courses: [
        {
          sections: [
            { lessons: [lesson(10), lesson(20)] },
            { lessons: [lesson(30)] },
          ],
          _count: { projects: 2 },
        },
        {
          sections: [{ lessons: [lesson(15), lesson(null)] }],
          _count: { projects: 1 },
        },
      ],
    };
    expect(computePathStats(path)).toEqual({
      courseCount: 2,
      lessonCount: 5,
      totalDurationMinutes: 75,
      projectCount: 3,
    });
  });

  it('handles a path with zero published courses', () => {
    expect(computePathStats({ isFree: false, courses: [] })).toEqual({
      courseCount: 0,
      lessonCount: 0,
      totalDurationMinutes: 0,
      projectCount: 0,
    });
  });
});

describe('applyIsFreeOverride', () => {
  it('mutates every nested lesson on a path-shaped object', () => {
    const path = {
      courses: [
        { sections: [{ lessons: [lesson(10, false), lesson(20, false)] }] },
      ],
    };
    applyIsFreeOverride(path);
    expect(path.courses[0].sections[0].lessons.every((l) => l.isFree)).toBe(
      true,
    );
  });

  it('mutates every nested lesson on a course-shaped object', () => {
    const course = { sections: [{ lessons: [lesson(5, false)] }] };
    applyIsFreeOverride(course);
    expect(course.sections[0].lessons[0].isFree).toBe(true);
  });
});

describe('buildOrderBy (FR-030a)', () => {
  function q(over: Partial<ListPathsQueryDto> = {}): ListPathsQueryDto {
    return Object.assign(new ListPathsQueryDto(), over);
  }

  it('default query → [{ order: asc }, { id: asc }]', () => {
    expect(buildOrderBy(q())).toEqual([{ order: 'asc' }, { id: 'asc' }]);
  });

  it('?sort=title&order=desc → [{ title: desc }, { id: asc }]', () => {
    expect(buildOrderBy(q({ sort: 'title', order: 'desc' }))).toEqual([
      { title: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('?sort=created_at&order=desc → [{ createdAt: desc }, { id: asc }]', () => {
    expect(buildOrderBy(q({ sort: 'created_at', order: 'desc' }))).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('always appends id asc tiebreaker last', () => {
    const result = buildOrderBy(q({ sort: 'title' }));
    expect(result[result.length - 1]).toEqual({ id: 'asc' });
  });
});
