import {
  __TEST_ONLY__,
  buildPathCertificate,
  toPathDetailDto,
  toPathSummaryDto,
} from './path-mapper';

const TEXT = __TEST_ONLY__.PATH_CERTIFICATE_TEXT;

describe('buildPathCertificate', () => {
  it('isFree=true → requiresAwamerPlus=false', () => {
    expect(buildPathCertificate({ isFree: true })).toEqual({
      enabled: true,
      requiresAwamerPlus: false,
      text: TEXT,
    });
  });

  it('isFree=false → requiresAwamerPlus=true', () => {
    expect(buildPathCertificate({ isFree: false })).toEqual({
      enabled: true,
      requiresAwamerPlus: true,
      text: TEXT,
    });
  });
});

const baseCategory = { id: 'cat1', name: 'AI', slug: 'ai' };
const tag = (id: string, name: string, slug: string) => ({
  tag: { id, name, slug },
});

const baseLesson = (id: string, isFree = false) => ({
  id,
  title: `L-${id}`,
  type: 'video',
  order: 1,
  estimatedMinutes: 10,
  isFree,
});

const baseSection = (id: string, lessons = [baseLesson('l1')]) => ({
  id,
  title: `S-${id}`,
  order: 1,
  lessons,
});

const baseCourse = (id: string, sections = [baseSection('s1')]) => ({
  id,
  slug: `c-${id}`,
  order: 1,
  title: `Course ${id}`,
  subtitle: null,
  description: null,
  isFree: false,
  sections,
  _count: { projects: 1 },
});

const basePath = (over: any = {}) => ({
  id: 'p1',
  slug: 'ai-fundamentals',
  title: 'AI Fundamentals',
  subtitle: 'A subtitle',
  description: 'A description',
  level: 'BEGINNER',
  thumbnail: 'thumb.png',
  promoVideoUrl: null,
  promoVideoThumbnail: null,
  isFree: false,
  isNew: true,
  status: 'PUBLISHED',
  skills: ['python'],
  category: baseCategory,
  tags: [tag('t1', 'Python', 'python')],
  courses: [baseCourse('c1')],
  ...over,
});

const stats = {
  courseCount: 1,
  lessonCount: 1,
  totalDurationMinutes: 10,
  projectCount: 1,
};

describe('toPathSummaryDto', () => {
  it('produces the documented summary shape with normalized level', () => {
    const dto = toPathSummaryDto(basePath() as never, stats);
    expect(dto).toEqual({
      id: 'p1',
      slug: 'ai-fundamentals',
      title: 'AI Fundamentals',
      subtitle: 'A subtitle',
      level: 'beginner',
      thumbnail: 'thumb.png',
      category: { id: 'cat1', name: 'AI', slug: 'ai' },
      tags: [{ id: 't1', name: 'Python', slug: 'python' }],
      isFree: false,
      isNew: true,
      stats: {
        courseCount: 1,
        lessonCount: 1,
        totalDurationMinutes: 10,
      },
    });
  });

  it('returns level=null when stored value is non-canonical', () => {
    const dto = toPathSummaryDto(
      basePath({ level: 'expert' }) as never,
      stats,
    );
    expect(dto.level).toBeNull();
  });
});

describe('toPathDetailDto', () => {
  it('embeds certificate built via buildPathCertificate and normalized level', () => {
    const dto = toPathDetailDto(
      basePath() as never,
      { features: [], faqs: [], testimonials: [] },
      stats,
    );
    expect(dto.path.certificate).toEqual({
      enabled: true,
      requiresAwamerPlus: true,
      text: TEXT,
    });
    expect(dto.path.level).toBe('beginner');
    expect(dto.path.skills).toEqual(['python']);
    expect(dto.curriculum).toHaveLength(1);
    expect(dto.curriculum[0].sections).toHaveLength(1);
    expect(dto.curriculum[0].sections[0].totalDurationMinutes).toBe(10);
  });

  it('flips requiresAwamerPlus to false when path.isFree=true', () => {
    const dto = toPathDetailDto(
      basePath({ isFree: true }) as never,
      { features: [], faqs: [], testimonials: [] },
      stats,
    );
    expect(dto.path.certificate.requiresAwamerPlus).toBe(false);
  });

  it('embeds promoVideo when promoVideoUrl is set, null otherwise', () => {
    expect(
      toPathDetailDto(
        basePath() as never,
        { features: [], faqs: [], testimonials: [] },
        stats,
      ).path.promoVideo,
    ).toBeNull();
    const withVideo = toPathDetailDto(
      basePath({
        promoVideoUrl: 'https://x/video.mp4',
        promoVideoThumbnail: 'thumb.jpg',
      }) as never,
      { features: [], faqs: [], testimonials: [] },
      stats,
    );
    expect(withVideo.path.promoVideo).toEqual({
      url: 'https://x/video.mp4',
      thumbnail: 'thumb.jpg',
    });
  });
});
