import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicMarketingQueries } from '../marketing/helpers/public-queries.helper';
import { CoursesService } from './courses.service';
import { ListCoursesQueryDto } from './dto/list-courses.query.dto';

const baseCategory = { id: 'cat1', name: 'DevOps', slug: 'devops' };

const fakeCourseRow = (over: any = {}) => ({
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
  skills: [],
  pathId: null,
  category: baseCategory,
  path: null,
  tags: [],
  sections: [
    {
      id: 's1',
      title: 'S1',
      order: 1,
      lessons: [
        {
          id: 'l1',
          title: 'L1',
          type: 'video',
          order: 1,
          estimatedMinutes: 10,
          isFree: false,
        },
      ],
    },
  ],
  _count: { projects: 1 },
  ...over,
});

function q(over: Partial<ListCoursesQueryDto> = {}): ListCoursesQueryDto {
  return Object.assign(new ListCoursesQueryDto(), over);
}

describe('CoursesService', () => {
  let service: CoursesService;
  let prisma: any;
  let cache: { get: jest.Mock; set: jest.Mock };
  let marketing: any;

  beforeEach(async () => {
    prisma = {
      course: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(async (ops: Promise<any>[]) => Promise.all(ops)),
    };
    cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined) };
    marketing = {
      getFeaturesByOwner: jest.fn().mockResolvedValue([]),
      getFaqsByOwner: jest.fn().mockResolvedValue([]),
      getApprovedTestimonialsByOwner: jest.fn().mockResolvedValue([]),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: PublicMarketingQueries, useValue: marketing },
      ],
    }).compile();
    service = moduleRef.get(CoursesService);
  });

  // ============================================================
  // listPublic
  // ============================================================

  describe('listPublic', () => {
    it('cache hit → returns cached value', async () => {
      const cached = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
      cache.get.mockResolvedValue(cached);
      const result = await service.listPublic(q());
      expect(result).toBe(cached);
      expect(prisma.course.findMany).not.toHaveBeenCalled();
    });

    it('cache miss → queries Prisma + caches', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findMany.mockResolvedValue([fakeCourseRow()]);
      prisma.course.count.mockResolvedValue(1);
      const result = await service.listPublic(q());
      expect(result.data).toHaveLength(1);
      expect(cache.set).toHaveBeenCalled();
    });

    it('?pathId filters to that pathId', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);
      await service.listPublic(q({ pathId: 'p1' }));
      const args = prisma.course.findMany.mock.calls[0][0];
      expect(args.where.pathId).toBe('p1');
    });

    it('?standalone=true filters pathId IS NULL', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);
      await service.listPublic(q({ standalone: true }));
      const args = prisma.course.findMany.mock.calls[0][0];
      expect(args.where.pathId).toBeNull();
    });

    it('FR-013: pathId + standalone → BadRequestException 400', async () => {
      await expect(
        service.listPublic(q({ pathId: 'p1', standalone: true })),
      ).rejects.toThrow(BadRequestException);
    });

    it('builds where clause with tagId, level, search', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);
      await service.listPublic(
        q({ tagId: 't1', level: 'beginner', search: 'git' }),
      );
      const args = prisma.course.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        status: 'PUBLISHED',
        tags: { some: { tagId: 't1' } },
        level: 'BEGINNER',
        OR: expect.any(Array),
      });
    });

    it('buildCourseOrderBy integration: orderBy is [primary, { id: asc }]', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);
      await service.listPublic(q({ sort: 'created_at', order: 'desc' }));
      const args = prisma.course.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    });

    it('FR-016: zero rows → exact empty meta shape', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);
      const result = await service.listPublic(q());
      expect(result).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });
    });

    it('FR-032: cache.get returning null falls through to DB without throwing', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);
      await expect(service.listPublic(q())).resolves.toBeDefined();
    });

    it('FR-032: cache.set is awaited but real CacheService never rejects', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);
      cache.set.mockResolvedValue(undefined);
      await expect(service.listPublic(q())).resolves.toBeDefined();
      expect(cache.set).toHaveBeenCalled();
    });
  });

  // ============================================================
  // findDetailBySlug
  // ============================================================

  describe('findDetailBySlug', () => {
    it('cache hit → returns cached without Prisma', async () => {
      const cached = { course: {}, curriculum: [], features: [], faqs: [], testimonials: [] };
      cache.get.mockResolvedValue(cached);
      const result = await service.findDetailBySlug('s');
      expect(result).toBe(cached);
      expect(prisma.course.findUnique).not.toHaveBeenCalled();
    });

    it('cache miss → fetches and caches', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue(fakeCourseRow());
      const result = await service.findDetailBySlug('git-basics');
      expect(result.course.slug).toBe('git-basics');
      expect(cache.set).toHaveBeenCalled();
    });

    it('NotFoundException on missing slug', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue(null);
      await expect(service.findDetailBySlug('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('NotFoundException when status != PUBLISHED', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue(
        fakeCourseRow({ status: 'DRAFT' }),
      );
      await expect(service.findDetailBySlug('s')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('parentPath null for standalone, populated for path-attached', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue(fakeCourseRow());
      const standalone = await service.findDetailBySlug('s');
      expect(standalone.course.parentPath).toBeNull();

      cache.get.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue(
        fakeCourseRow({
          pathId: 'p1',
          path: { id: 'p1', slug: 'ai', title: 'AI Path' },
        }),
      );
      const attached = await service.findDetailBySlug('s');
      expect(attached.course.parentPath).toEqual({
        id: 'p1',
        slug: 'ai',
        title: 'AI Path',
      });
    });

    it('isFree=true → all nested lessons get isFree=true', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue(
        fakeCourseRow({ isFree: true }),
      );
      const result = await service.findDetailBySlug('s');
      expect(result.curriculum.every((s) => s.lessons.every((l) => l.isFree))).toBe(
        true,
      );
    });

    it('certificate mirrors course.isFree', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue(
        fakeCourseRow({ isFree: true }),
      );
      const free = await service.findDetailBySlug('s');
      expect(free.course.certificate.requiresAwamerPlus).toBe(false);
    });

    it('three marketing methods invoked in parallel', async () => {
      cache.get.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue(fakeCourseRow());
      const delay = (ms: number) =>
        new Promise((r) => setTimeout(() => r([]), ms));
      marketing.getFeaturesByOwner.mockImplementation(() => delay(50));
      marketing.getFaqsByOwner.mockImplementation(() => delay(50));
      marketing.getApprovedTestimonialsByOwner.mockImplementation(() =>
        delay(50),
      );
      const start = Date.now();
      await service.findDetailBySlug('s');
      expect(Date.now() - start).toBeLessThan(120);
      expect(marketing.getFeaturesByOwner).toHaveBeenCalledWith('COURSE', 'c1');
    });
  });
});
