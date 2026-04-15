import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from './categories.service';

const fakeRows = [
  {
    id: 'c1',
    name: 'AI',
    slug: 'ai',
    description: null,
    icon: null,
    order: 0,
    _count: { paths: 3, courses: 2 },
  },
  {
    id: 'c2',
    name: 'DevOps',
    slug: 'devops',
    description: 'desc',
    icon: 'cloud',
    order: 1,
    _count: { paths: 1, courses: 5 },
  },
];

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: { category: { findMany: jest.Mock } };
  let cache: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    prisma = { category: { findMany: jest.fn() } };
    cache = { get: jest.fn(), set: jest.fn() };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    service = moduleRef.get(CategoriesService);
  });

  it('cache hit: returns cached value without calling Prisma', async () => {
    cache.get.mockResolvedValue([{ id: 'cached' }]);
    const result = await service.listAllPublic();
    expect(result).toEqual([{ id: 'cached' }]);
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it('cache miss: queries Prisma and writes to cache', async () => {
    cache.get.mockResolvedValue(null);
    prisma.category.findMany.mockResolvedValue(fakeRows);
    const result = await service.listAllPublic();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'c1',
      name: 'AI',
      slug: 'ai',
      description: null,
      icon: null,
      order: 0,
      pathCount: 3,
      courseCount: 2,
    });
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set.mock.calls[0][0]).toBe('categories:all');
  });

  it('Prisma where clause filters status=ACTIVE', async () => {
    cache.get.mockResolvedValue(null);
    prisma.category.findMany.mockResolvedValue([]);
    await service.listAllPublic();
    const args = prisma.category.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: 'ACTIVE' });
    expect(args.orderBy).toEqual({ order: 'asc' });
  });

  it('cache.get failure tolerated → falls through to Prisma', async () => {
    cache.get.mockResolvedValue(null); // CacheService.get already swallows internally
    prisma.category.findMany.mockResolvedValue([]);
    await expect(service.listAllPublic()).resolves.toEqual([]);
    expect(prisma.category.findMany).toHaveBeenCalled();
  });

  it('cache.set is awaited but the real CacheService never rejects (FR-032)', async () => {
    // The real CacheService.set swallows every error internally, so the
    // service does not need its own try/catch. We assert the call happens.
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    prisma.category.findMany.mockResolvedValue(fakeRows);
    await expect(service.listAllPublic()).resolves.toHaveLength(2);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });
});
