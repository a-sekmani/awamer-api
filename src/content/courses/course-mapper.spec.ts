import {
  __TEST_ONLY__,
  buildCourseCertificate,
  toCourseDetailDto,
  toCourseSummaryDto,
} from './course-mapper';

const TEXT = __TEST_ONLY__.COURSE_CERTIFICATE_TEXT;

describe('buildCourseCertificate', () => {
  it('isFree=true → requiresAwamerPlus=false', () => {
    expect(buildCourseCertificate({ isFree: true })).toEqual({
      enabled: true,
      requiresAwamerPlus: false,
      text: TEXT,
    });
  });

  it('isFree=false → requiresAwamerPlus=true', () => {
    expect(buildCourseCertificate({ isFree: false })).toEqual({
      enabled: true,
      requiresAwamerPlus: true,
      text: TEXT,
    });
  });
});

const baseCategory = { id: 'cat1', name: 'DevOps', slug: 'devops' };

const lesson = (id: string, isFree = false) => ({
  id,
  title: `L-${id}`,
  type: 'video',
  order: 1,
  estimatedMinutes: 8,
  isFree,
});

const section = (id: string, lessons = [lesson('l1')]) => ({
  id,
  title: `S-${id}`,
  order: 1,
  lessons,
});

const baseCourse = (over: any = {}) => ({
  id: 'c1',
  slug: 'git-basics',
  title: 'Git Basics',
  subtitle: null,
  description: null,
  level: 'BEGINNER',
  thumbnail: null,
  isFree: false,
  isNew: false,
  status: 'PUBLISHED',
  skills: ['git'],
  pathId: null,
  category: baseCategory,
  path: null,
  tags: [],
  sections: [section('s1')],
  _count: { projects: 2 },
  ...over,
});

const stats = {
  sectionCount: 1,
  lessonCount: 1,
  totalDurationMinutes: 8,
  projectCount: 2,
};

describe('toCourseSummaryDto', () => {
  it('maps a standalone course with parentPath=null', () => {
    const dto = toCourseSummaryDto(baseCourse() as never, stats);
    expect(dto.path).toBeNull();
    expect(dto.level).toBe('beginner');
  });

  it('maps a path-attached course with parentPath populated', () => {
    const dto = toCourseSummaryDto(
      baseCourse({
        pathId: 'p1',
        path: { id: 'p1', slug: 'ai', title: 'AI Path' },
      }) as never,
      stats,
    );
    expect(dto.path).toEqual({ id: 'p1', slug: 'ai', title: 'AI Path' });
  });
});

describe('toCourseDetailDto', () => {
  it('embeds certificate, lowercased level, parentPath null for standalone', () => {
    const dto = toCourseDetailDto(
      baseCourse() as never,
      { features: [], faqs: [], testimonials: [] },
      stats,
    );
    expect(dto.course.certificate).toEqual({
      enabled: true,
      requiresAwamerPlus: true,
      text: TEXT,
    });
    expect(dto.course.level).toBe('beginner');
    expect(dto.course.parentPath).toBeNull();
    expect(dto.curriculum).toHaveLength(1);
  });

  it('populates parentPath for path-attached course', () => {
    const dto = toCourseDetailDto(
      baseCourse({
        pathId: 'p1',
        path: { id: 'p1', slug: 'ai', title: 'AI Path' },
      }) as never,
      { features: [], faqs: [], testimonials: [] },
      stats,
    );
    expect(dto.course.parentPath).toEqual({
      id: 'p1',
      slug: 'ai',
      title: 'AI Path',
    });
  });

  it('flips requiresAwamerPlus to false for free courses', () => {
    const dto = toCourseDetailDto(
      baseCourse({ isFree: true }) as never,
      { features: [], faqs: [], testimonials: [] },
      stats,
    );
    expect(dto.course.certificate.requiresAwamerPlus).toBe(false);
  });
});
