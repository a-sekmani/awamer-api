import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CategoryStatus } from '@prisma/client';
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/library';
import { CacheService } from '../../common/cache/cache.service';
import { ErrorCode } from '../../common/error-codes.enum';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesAdminService } from './categories-admin.service';

const NOW = new Date('2026-05-02T12:00:00.000Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'AI',
    slug: 'ai',
    order: 0,
    status: CategoryStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { paths: 0, courses: 0 },
    ...overrides,
  };
}

function makeP2003(): PrismaClientKnownRequestError {
  // The constructor signature changed across versions; we cast through `any` to
  // construct a minimal error whose `code` property the service inspects.
  const err = Object.create(
    PrismaClientKnownRequestError.prototype,
  ) as PrismaClientKnownRequestError;
  Object.assign(err, {
    code: 'P2003',
    message: 'Foreign key constraint failed',
    meta: {},
  });
  return err;
}

function makeP2025(): PrismaClientKnownRequestError {
  const err = Object.create(
    PrismaClientKnownRequestError.prototype,
  ) as PrismaClientKnownRequestError;
  Object.assign(err, { code: 'P2025', message: 'Record not found', meta: {} });
  return err;
}

function makeUnknown23001(): PrismaClientUnknownRequestError {
  const err = Object.create(
    PrismaClientUnknownRequestError.prototype,
  ) as PrismaClientUnknownRequestError;
  Object.assign(err, {
    message: 'pq: SQLSTATE 23001 — restrict on update/delete',
  });
  return err;
}

describe('CategoriesAdminService', () => {
  let service: CategoriesAdminService;
  let prisma: {
    category: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    path: { count: jest.Mock };
    course: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let cache: { del: jest.Mock };

  beforeEach(async () => {
    prisma = {
      category: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      path: { count: jest.fn() },
      course: { count: jest.fn() },
      $transaction: jest.fn(),
    };
    cache = { del: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    service = moduleRef.get(CategoriesAdminService);
  });

  // ===========================================================================
  // create()  — T022 (US1)
  // ===========================================================================
  describe('create()', () => {
    it('returns mapped DTO with counts 0/0 on success', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.findUnique.mockResolvedValue(null);
      prisma.category.create.mockResolvedValue(makeRow());

      const result = await service.create({ name: 'AI', slug: 'ai' });

      expect(result).toEqual({
        id: '11111111-1111-1111-1111-111111111111',
        name: 'AI',
        slug: 'ai',
        order: 0,
        status: CategoryStatus.ACTIVE,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        pathCount: 0,
        courseCount: 0,
      });
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { name: 'AI', slug: 'ai' },
      });
      expect(cache.del).toHaveBeenCalledWith('categories:all');
    });

    it('throws CATEGORY_NAME_EXISTS when name pre-check finds a row', async () => {
      prisma.category.findFirst.mockResolvedValue(makeRow());

      await expect(service.create({ name: 'AI', slug: 'ai' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.category.findUnique).not.toHaveBeenCalled();
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('throws CATEGORY_SLUG_EXISTS when slug pre-check finds a row (name unique)', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.findUnique.mockResolvedValue(makeRow({ slug: 'ai' }));

      await expect(
        service.create({ name: 'AI', slug: 'ai' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: ErrorCode.CATEGORY_SLUG_EXISTS,
        }),
      });
      expect(prisma.category.create).not.toHaveBeenCalled();
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('name wins when both name AND slug would collide (slug check skipped)', async () => {
      prisma.category.findFirst.mockResolvedValue(makeRow({ name: 'AI' }));

      await expect(
        service.create({ name: 'AI', slug: 'ai' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: ErrorCode.CATEGORY_NAME_EXISTS,
        }),
      });
      expect(prisma.category.findUnique).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // list()  — T023 (US1)
  // ===========================================================================
  describe('list()', () => {
    function setupList(total: number, rows: ReturnType<typeof makeRow>[]) {
      prisma.$transaction.mockImplementation(
        async (calls: Promise<unknown>[]) => {
          // Mirror our service's call sequence: [count, findMany]
          await Promise.all(calls);
          return [total, rows];
        },
      );
    }

    it('paginates with totalPages computed from total / limit', async () => {
      setupList(45, []);
      const result = await service.list({ page: 2, limit: 20 } as never);
      expect(result.meta).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
      });
    });

    it('builds search OR clause across name and slug, case-insensitive', async () => {
      setupList(0, []);
      await service.list({ page: 1, limit: 20, search: 'cy' } as never);
      const findManyArgs = prisma.category.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({
        OR: [
          { name: { contains: 'cy', mode: 'insensitive' } },
          { slug: { contains: 'cy', mode: 'insensitive' } },
        ],
      });
    });

    it('filters by status when provided', async () => {
      setupList(0, []);
      await service.list({
        page: 1,
        limit: 20,
        status: CategoryStatus.HIDDEN,
      } as never);
      const findManyArgs = prisma.category.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({ status: CategoryStatus.HIDDEN });
    });

    it('omits status filter when not provided', async () => {
      setupList(0, []);
      await service.list({ page: 1, limit: 20 } as never);
      const findManyArgs = prisma.category.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({});
    });

    it('orders by createdAt DESC', async () => {
      setupList(0, []);
      await service.list({ page: 1, limit: 20 } as never);
      const findManyArgs = prisma.category.findMany.mock.calls[0][0];
      expect(findManyArgs.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('maps _count to pathCount and courseCount', async () => {
      setupList(1, [makeRow({ _count: { paths: 3, courses: 7 } })]);
      const result = await service.list({ page: 1, limit: 20 } as never);
      expect(result.data[0].pathCount).toBe(3);
      expect(result.data[0].courseCount).toBe(7);
    });

    it('does not invalidate cache (read-only)', async () => {
      setupList(0, []);
      await service.list({ page: 1, limit: 20 } as never);
      expect(cache.del).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // get()  — T040 (US7)
  // ===========================================================================
  describe('get()', () => {
    it('returns DTO with counts when row exists', async () => {
      prisma.category.findUnique.mockResolvedValue(
        makeRow({ _count: { paths: 3, courses: 7 } }),
      );
      const result = await service.get('11111111-1111-1111-1111-111111111111');
      expect(result.pathCount).toBe(3);
      expect(result.courseCount).toBe(7);
    });

    it('throws CATEGORY_NOT_FOUND on null findUnique', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(
        service.get('00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: ErrorCode.CATEGORY_NOT_FOUND,
        }),
      });
    });

    it('does not invalidate cache (read-only)', async () => {
      prisma.category.findUnique.mockResolvedValue(makeRow());
      await service.get('11111111-1111-1111-1111-111111111111');
      expect(cache.del).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // update()  — T037 (US6)
  // ===========================================================================
  describe('update()', () => {
    const id = '11111111-1111-1111-1111-111111111111';

    it('PATCH single field preserves other fields and invalidates cache', async () => {
      prisma.category.findUnique
        .mockResolvedValueOnce(makeRow()) // existence check
        .mockResolvedValueOnce(null); // slug check (won't run since slug undefined)
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.update.mockResolvedValue(makeRow({ name: 'New' }));

      const result = await service.update(id, { name: 'New' });

      expect(result.name).toBe('New');
      expect(prisma.category.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id }, data: { name: 'New' } }),
      );
      expect(cache.del).toHaveBeenCalledWith('categories:all');
    });

    it('throws 404 CATEGORY_NOT_FOUND when row does not exist', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.update(id, { name: 'Anything' })).rejects.toThrow(
        NotFoundException,
      );
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('throws CATEGORY_NAME_EXISTS on name conflict against another row', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(makeRow());
      prisma.category.findFirst.mockResolvedValue(
        makeRow({ id: 'other', name: 'Taken' }),
      );

      await expect(service.update(id, { name: 'Taken' })).rejects.toMatchObject(
        {
          response: expect.objectContaining({
            errorCode: ErrorCode.CATEGORY_NAME_EXISTS,
          }),
        },
      );
    });

    it('throws CATEGORY_SLUG_EXISTS on slug conflict against another row', async () => {
      prisma.category.findUnique
        .mockResolvedValueOnce(makeRow()) // existence
        .mockResolvedValueOnce(makeRow({ id: 'other', slug: 'taken' })); // slug check
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(service.update(id, { slug: 'taken' })).rejects.toMatchObject(
        {
          response: expect.objectContaining({
            errorCode: ErrorCode.CATEGORY_SLUG_EXISTS,
          }),
        },
      );
    });

    it('name wins when both name AND slug collide on different rows (slug check NOT reached)', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(makeRow()); // existence
      prisma.category.findFirst.mockResolvedValue(
        makeRow({ id: 'other', name: 'Taken' }),
      );

      await expect(
        service.update(id, { name: 'Taken', slug: 'taken-slug' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: ErrorCode.CATEGORY_NAME_EXISTS,
        }),
      });
      // findUnique called once for existence, NOT a second time for slug
      expect(prisma.category.findUnique).toHaveBeenCalledTimes(1);
    });

    it('PATCH-ing same row to its own name/slug is allowed (no conflict)', async () => {
      const existing = makeRow({ name: 'AI', slug: 'ai' });
      prisma.category.findUnique
        .mockResolvedValueOnce(existing) // existence
        .mockResolvedValueOnce(existing); // slug-check returns same row
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.update.mockResolvedValue(existing);

      // Same name AND slug → no conflict, update proceeds (no-op, but valid).
      // Service short-circuits when dto field equals existing value — name and
      // slug pre-checks don't run; update is called.
      await expect(
        service.update(id, { name: 'AI', slug: 'ai' }),
      ).resolves.toBeDefined();
      expect(cache.del).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // remove()  — T030 (US3)
  // ===========================================================================
  describe('remove()', () => {
    const id = '11111111-1111-1111-1111-111111111111';

    it('returns { ok: true } and invalidates cache on successful delete', async () => {
      prisma.category.delete.mockResolvedValue(makeRow());
      const result = await service.remove(id);
      expect(result).toEqual({ ok: true });
      expect(cache.del).toHaveBeenCalledWith('categories:all');
    });

    it('throws 409 CATEGORY_IN_USE on Prisma P2003 (KnownRequestError)', async () => {
      prisma.category.delete.mockRejectedValue(makeP2003());
      prisma.path.count.mockResolvedValue(2);
      prisma.course.count.mockResolvedValue(5);

      await expect(service.remove(id)).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: ErrorCode.CATEGORY_IN_USE,
          errors: { pathCount: 2, courseCount: 5 },
        }),
      });
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('throws 409 CATEGORY_IN_USE on Prisma Unknown error with SQLSTATE 23001', async () => {
      prisma.category.delete.mockRejectedValue(makeUnknown23001());
      prisma.path.count.mockResolvedValue(1);
      prisma.course.count.mockResolvedValue(0);

      await expect(service.remove(id)).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: ErrorCode.CATEGORY_IN_USE,
          errors: { pathCount: 1, courseCount: 0 },
        }),
      });
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('throws 404 CATEGORY_NOT_FOUND on Prisma P2025', async () => {
      prisma.category.delete.mockRejectedValue(makeP2025());

      await expect(service.remove(id)).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: ErrorCode.CATEGORY_NOT_FOUND,
        }),
      });
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('re-throws unrelated errors as-is', async () => {
      const generic = new Error('something else');
      prisma.category.delete.mockRejectedValue(generic);
      await expect(service.remove(id)).rejects.toBe(generic);
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('populates errors.pathCount and errors.courseCount via parallel counts', async () => {
      prisma.category.delete.mockRejectedValue(makeUnknown23001());
      prisma.path.count.mockResolvedValue(7);
      prisma.course.count.mockResolvedValue(13);

      await expect(service.remove(id)).rejects.toMatchObject({
        response: expect.objectContaining({
          errors: { pathCount: 7, courseCount: 13 },
        }),
      });
    });
  });

  // ===========================================================================
  // Cache invalidation gating — T034 (US5)
  // ===========================================================================
  describe('cache invalidation gating', () => {
    it('does NOT invalidate on validation/conflict failure during create', async () => {
      prisma.category.findFirst.mockResolvedValue(makeRow());
      await expect(
        service.create({ name: 'AI', slug: 'ai' }),
      ).rejects.toThrow();
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('does NOT invalidate on 404 during update', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(service.update('id', { name: 'X' })).rejects.toThrow();
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('does NOT invalidate on 409 during remove', async () => {
      prisma.category.delete.mockRejectedValue(makeUnknown23001());
      prisma.path.count.mockResolvedValue(1);
      prisma.course.count.mockResolvedValue(0);
      await expect(service.remove('id')).rejects.toThrow();
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('does NOT invalidate on 404 during remove', async () => {
      prisma.category.delete.mockRejectedValue(makeP2025());
      await expect(service.remove('id')).rejects.toThrow();
      expect(cache.del).not.toHaveBeenCalled();
    });
  });
});
