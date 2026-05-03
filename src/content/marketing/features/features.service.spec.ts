import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MarketingOwnerType, Prisma } from '@prisma/client';
import { CacheService } from '../../../common/cache/cache.service';
import { RevalidationHelper } from '../../../common/cache/revalidation.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnerValidator } from '../helpers/owner-validator.helper';
import { ReorderHelper } from '../helpers/reorder.helper';
import { FeaturesService } from './features.service';

type Row = {
  id: string;
  ownerType: MarketingOwnerType;
  ownerId: string;
  icon: string;
  title: string;
  description: string;
  order: number;
};

const row = (id: string, order: number): Row => ({
  id,
  ownerType: MarketingOwnerType.PATH,
  ownerId: 'p1',
  icon: 'i',
  title: `t-${id}`,
  description: `d-${id}`,
  order,
});

describe('FeaturesService', () => {
  let service: FeaturesService;
  let prisma: {
    feature: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let ownerValidator: { ensureOwnerExists: jest.Mock };
  let reorderHelper: { reorder: jest.Mock };
  let cache: { invalidateOwner: jest.Mock; slugFor: jest.Mock };
  let revalidation: { revalidatePath: jest.Mock };

  beforeEach(async () => {
    prisma = {
      feature: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    ownerValidator = {
      ensureOwnerExists: jest.fn().mockResolvedValue(undefined),
    };
    reorderHelper = { reorder: jest.fn().mockResolvedValue(undefined) };
    cache = {
      invalidateOwner: jest.fn().mockResolvedValue(undefined),
      slugFor: jest.fn().mockResolvedValue('some-slug'),
    };
    revalidation = { revalidatePath: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FeaturesService,
        { provide: PrismaService, useValue: prisma },
        { provide: OwnerValidator, useValue: ownerValidator },
        { provide: ReorderHelper, useValue: reorderHelper },
        { provide: CacheService, useValue: cache },
        { provide: RevalidationHelper, useValue: revalidation },
      ],
    }).compile();
    service = moduleRef.get(FeaturesService);
  });

  describe('cache invalidation (FR-018)', () => {
    it('create calls invalidateOwner and revalidatePath', async () => {
      prisma.feature.findFirst.mockResolvedValue(null);
      prisma.feature.create.mockResolvedValue(row('new', 0));
      await service.create(MarketingOwnerType.PATH, 'p1', {
        icon: 'i',
        title: 't',
        description: 'd',
      });
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
      expect(cache.slugFor).toHaveBeenCalledWith('path', 'p1');
      expect(revalidation.revalidatePath).toHaveBeenCalledWith(
        '/paths/some-slug',
      );
    });

    it('update calls invalidateOwner and revalidatePath', async () => {
      prisma.feature.update.mockResolvedValue(row('u', 0));
      await service.update('u', { title: 'new' });
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
      expect(revalidation.revalidatePath).toHaveBeenCalledWith(
        '/paths/some-slug',
      );
    });

    it('remove calls invalidateOwner and revalidatePath', async () => {
      prisma.feature.delete.mockResolvedValue(row('d', 0));
      await service.remove('d');
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
      expect(revalidation.revalidatePath).toHaveBeenCalledWith(
        '/paths/some-slug',
      );
    });

    it('reorder calls invalidateOwner and revalidatePath', async () => {
      prisma.feature.findMany.mockResolvedValue([]);
      await service.reorder(MarketingOwnerType.PATH, 'p1', []);
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
      expect(revalidation.revalidatePath).toHaveBeenCalledWith(
        '/paths/some-slug',
      );
    });

    it('skips revalidation when slugFor returns null', async () => {
      cache.slugFor.mockResolvedValue(null);
      prisma.feature.findFirst.mockResolvedValue(null);
      prisma.feature.create.mockResolvedValue(row('new', 0));
      await service.create(MarketingOwnerType.PATH, 'p1', {
        icon: 'i',
        title: 't',
        description: 'd',
      });
      expect(revalidation.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe('listByOwner', () => {
    it('returns features sorted by order ASC then id ASC', async () => {
      prisma.feature.findMany.mockResolvedValue([row('a', 0), row('b', 1)]);
      const result = await service.listByOwner(MarketingOwnerType.PATH, 'p1');
      expect(ownerValidator.ensureOwnerExists).toHaveBeenCalledWith(
        MarketingOwnerType.PATH,
        'p1',
      );
      expect(prisma.feature.findMany).toHaveBeenCalledWith({
        where: { ownerType: MarketingOwnerType.PATH, ownerId: 'p1' },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
      expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    });
  });

  describe('create', () => {
    it('uses the provided order', async () => {
      prisma.feature.create.mockResolvedValue(row('new', 7));
      const result = await service.create(MarketingOwnerType.PATH, 'p1', {
        icon: 'i',
        title: 't',
        description: 'd',
        order: 7,
      });
      expect(prisma.feature.create).toHaveBeenCalledWith({
        data: {
          ownerType: MarketingOwnerType.PATH,
          ownerId: 'p1',
          icon: 'i',
          title: 't',
          description: 'd',
          order: 7,
        },
      });
      expect(result.order).toBe(7);
    });

    it('appends when order is omitted (max + 1)', async () => {
      prisma.feature.findFirst.mockResolvedValue({ order: 4 });
      prisma.feature.create.mockResolvedValue(row('new', 5));
      await service.create(MarketingOwnerType.PATH, 'p1', {
        icon: 'i',
        title: 't',
        description: 'd',
      });
      expect(prisma.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ order: 5 }),
        }),
      );
    });

    it('appends to 0 on empty owner', async () => {
      prisma.feature.findFirst.mockResolvedValue(null);
      prisma.feature.create.mockResolvedValue(row('new', 0));
      await service.create(MarketingOwnerType.PATH, 'p1', {
        icon: 'i',
        title: 't',
        description: 'd',
      });
      expect(prisma.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ order: 0 }),
        }),
      );
    });

    it('surfaces owner-not-found from the validator', async () => {
      ownerValidator.ensureOwnerExists.mockRejectedValue(
        new NotFoundException("Path 'p1' does not exist"),
      );
      await expect(
        service.create(MarketingOwnerType.PATH, 'p1', {
          icon: 'i',
          title: 't',
          description: 'd',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws BadRequest on empty body', async () => {
      await expect(service.update('id', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('updates provided fields', async () => {
      prisma.feature.update.mockResolvedValue(row('id', 2));
      await service.update('id', { title: 'new' });
      expect(prisma.feature.update).toHaveBeenCalledWith({
        where: { id: 'id' },
        data: { title: 'new' },
      });
    });

    it('throws NotFound on P2025', async () => {
      prisma.feature.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('missing', {
          code: 'P2025',
          clientVersion: 'x',
        }),
      );
      await expect(service.update('id', { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('throws NotFound on P2025', async () => {
      prisma.feature.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('missing', {
          code: 'P2025',
          clientVersion: 'x',
        }),
      );
      await expect(service.remove('id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reorder', () => {
    it('delegates to ReorderHelper and returns the refreshed list', async () => {
      prisma.feature.findMany.mockResolvedValue([row('a', 0), row('b', 1)]);
      const result = await service.reorder(MarketingOwnerType.PATH, 'p1', [
        'b',
        'a',
      ]);
      expect(reorderHelper.reorder).toHaveBeenCalledWith(
        'feature',
        MarketingOwnerType.PATH,
        'p1',
        ['b', 'a'],
      );
      expect(result).toHaveLength(2);
    });

    it('propagates owner-not-found from the validator', async () => {
      ownerValidator.ensureOwnerExists.mockRejectedValue(
        new NotFoundException("Path 'p1' does not exist"),
      );
      await expect(
        service.reorder(MarketingOwnerType.PATH, 'p1', ['a']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reorderHelper.reorder).not.toHaveBeenCalled();
    });
  });
});
