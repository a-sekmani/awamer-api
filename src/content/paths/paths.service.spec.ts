import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicMarketingQueries } from '../marketing/helpers/public-queries.helper';
import { PathsService } from './paths.service';
import { ListPathsQueryDto } from './dto/list-paths.query.dto';

const baseCategory = { id: 'cat1', name: 'AI', slug: 'ai' };
const tag = (id: string) => ({ tag: { id, name: id, slug: id } });

const fakePathRow = (over: any = {}) => ({
  id: 'p1',
  slug: 'ai-fundamentals',
  title: 'AI Fundamentals',
  subtitle: 'sub',
  description: 'desc',
  level: 'beginner',
  thumbnail: null,
  promoVideoUrl: null,
  promoVideoThumbnail: null,
  isFree: false,
  isNew: true,
  status: 'PUBLISHED',
  skills: [],
  category: baseCategory,
  tags: [tag('t1')],
  courses: [
    {
      id: 'c1',
      slug: 'c1',
      order: 1,
      title: 'C1',
      subtitle: null,
      description: null,
      isFree: false,
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
    },
  ],
  ...over,
});

function q(over: Partial<ListPathsQueryDto> = {}): ListPathsQueryDto {
  return Object.assign(new ListPathsQueryDto(), over);
}

describe('PathsService', () => {
  let service: PathsService;
  let prisma: any;
  let cache: { get: jest.Mock; set: jest.Mock };
  let marketing: {
    getFeaturesByOwner: jest.Mock;
    getFaqsByOwner: jest.Mock;
    getApprovedTestimonialsByOwner: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      path: {
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
        PathsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: PublicMarketingQueries, useValue: marketing },
      ],
    }).compile();
    service = moduleRef.get(PathsService);
  });

  // ============================================================
  // listPublic
  // ============================================================

  describe('listPublic', () => {
    it('cache hit → returns cached result without touching Prisma', async () => {
      const cached = {
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      };
      cache.get.mockResolvedValue(cached);
      const result = await service.listPublic(q());
      expect(result).toBe(cached);
      expect(prisma.path.findMany).not.toHaveBeenCalled();
    });

    it('cache miss → queries Prisma + caches result', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findMany.mockResolvedValue([fakePathRow()]);
      prisma.path.count.mockResolvedValue(1);
      const result = await service.listPublic(q());
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(cache.set).toHaveBeenCalled();
    });

    it('builds where clause with categoryId, tagId, level, search', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findMany.mockResolvedValue([]);
      prisma.path.count.mockResolvedValue(0);
      await service.listPublic(
        q({
          categoryId: 'cat1',
          tagId: 'tag1',
          level: 'beginner',
          search: 'AI',
        }),
      );
      const args = prisma.path.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        status: 'PUBLISHED',
        categoryId: 'cat1',
        tags: { some: { tagId: 'tag1' } },
        level: { equals: 'beginner', mode: 'insensitive' },
        OR: expect.any(Array),
      });
    });

    it('orderBy passed to Prisma is [primary, { id: asc }] (FR-030a)', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findMany.mockResolvedValue([]);
      prisma.path.count.mockResolvedValue(0);
      await service.listPublic(q({ sort: 'title', order: 'desc' }));
      const args = prisma.path.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ title: 'desc' }, { id: 'asc' }]);
    });

    it('pagination meta math: totalPages = ceil(total / limit)', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findMany.mockResolvedValue([]);
      prisma.path.count.mockResolvedValue(45);
      const result = await service.listPublic(q({ limit: 20 }));
      expect(result.meta.totalPages).toBe(3);
    });

    it('FR-016: zero rows → exact empty meta shape', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findMany.mockResolvedValue([]);
      prisma.path.count.mockResolvedValue(0);
      const result = await service.listPublic(q());
      expect(result).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });
    });

    it('cache.get failure tolerance: returning null falls through to DB', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findMany.mockResolvedValue([]);
      prisma.path.count.mockResolvedValue(0);
      await expect(service.listPublic(q())).resolves.toBeDefined();
      expect(prisma.path.findMany).toHaveBeenCalled();
    });
  });

  // ============================================================
  // findDetailBySlug
  // ============================================================

  describe('findDetailBySlug', () => {
    it('cache hit → returns cached without touching Prisma', async () => {
      const cached = {
        path: {},
        curriculum: [],
        features: [],
        faqs: [],
        testimonials: [],
      };
      cache.get.mockResolvedValue(cached);
      const result = await service.findDetailBySlug('s');
      expect(result).toBe(cached);
      expect(prisma.path.findUnique).not.toHaveBeenCalled();
      expect(marketing.getFeaturesByOwner).not.toHaveBeenCalled();
    });

    it('cache miss → fetches Prisma, marketing, and caches', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findUnique.mockResolvedValue(fakePathRow());
      const result = await service.findDetailBySlug('ai-fundamentals');
      expect(result.path.slug).toBe('ai-fundamentals');
      expect(cache.set).toHaveBeenCalled();
      expect(marketing.getFeaturesByOwner).toHaveBeenCalledWith('PATH', 'p1');
      expect(marketing.getFaqsByOwner).toHaveBeenCalledWith('PATH', 'p1');
      expect(marketing.getApprovedTestimonialsByOwner).toHaveBeenCalledWith(
        'PATH',
        'p1',
      );
    });

    it('throws NotFoundException when slug missing', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findUnique.mockResolvedValue(null);
      await expect(service.findDetailBySlug('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when status != PUBLISHED', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findUnique.mockResolvedValue(
        fakePathRow({ status: 'DRAFT' }),
      );
      await expect(service.findDetailBySlug('s')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('certificate built via buildPathCertificate (mirrors path.isFree)', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findUnique.mockResolvedValue(fakePathRow({ isFree: false }));
      const result = await service.findDetailBySlug('s');
      expect(result.path.certificate.requiresAwamerPlus).toBe(true);
    });

    it('all three marketing methods invoked in parallel via Promise.all', async () => {
      cache.get.mockResolvedValue(null);
      prisma.path.findUnique.mockResolvedValue(fakePathRow());
      const delay = (ms: number) =>
        new Promise((r) => setTimeout(() => r([]), ms));
      marketing.getFeaturesByOwner.mockImplementation(() => delay(50));
      marketing.getFaqsByOwner.mockImplementation(() => delay(50));
      marketing.getApprovedTestimonialsByOwner.mockImplementation(() =>
        delay(50),
      );
      const start = Date.now();
      await service.findDetailBySlug('s');
      const elapsed = Date.now() - start;
      // Three serial 50ms calls would be 150ms. Parallel is ~50ms.
      expect(elapsed).toBeLessThan(120);
    });
  });
});
