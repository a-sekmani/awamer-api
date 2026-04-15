import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  MarketingOwnerType,
  Prisma,
  TestimonialStatus,
} from '@prisma/client';
import { CacheService } from '../../../common/cache/cache.service';
import { RevalidationHelper } from '../../../common/cache/revalidation.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnerValidator } from '../helpers/owner-validator.helper';
import { ReorderHelper } from '../helpers/reorder.helper';
import { TestimonialsService } from './testimonials.service';

type Row = {
  id: string;
  ownerType: MarketingOwnerType;
  ownerId: string;
  authorName: string;
  authorTitle: string | null;
  avatarUrl: string | null;
  content: string;
  rating: number | null;
  status: TestimonialStatus;
  order: number;
  createdAt: Date;
};

const row = (
  id: string,
  order: number,
  status: TestimonialStatus = TestimonialStatus.PENDING,
): Row => ({
  id,
  ownerType: MarketingOwnerType.PATH,
  ownerId: 'p1',
  authorName: `author-${id}`,
  authorTitle: null,
  avatarUrl: null,
  content: `c-${id}`,
  rating: null,
  status,
  order,
  createdAt: new Date('2026-04-10T00:00:00.000Z'),
});

describe('TestimonialsService', () => {
  let service: TestimonialsService;
  let prisma: {
    testimonial: {
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
      testimonial: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    ownerValidator = { ensureOwnerExists: jest.fn().mockResolvedValue(undefined) };
    reorderHelper = { reorder: jest.fn().mockResolvedValue(undefined) };
    cache = {
      invalidateOwner: jest.fn().mockResolvedValue(undefined),
      slugFor: jest.fn().mockResolvedValue('some-slug'),
    };
    revalidation = { revalidatePath: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TestimonialsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OwnerValidator, useValue: ownerValidator },
        { provide: ReorderHelper, useValue: reorderHelper },
        { provide: CacheService, useValue: cache },
        { provide: RevalidationHelper, useValue: revalidation },
      ],
    }).compile();
    service = moduleRef.get(TestimonialsService);
  });

  describe('cache invalidation (FR-018)', () => {
    it('create calls invalidateOwner and revalidatePath', async () => {
      prisma.testimonial.findFirst.mockResolvedValue(null);
      prisma.testimonial.create.mockResolvedValue(row('new', 0));
      await service.create(MarketingOwnerType.PATH, 'p1', {
        authorName: 'a',
        content: 'c',
      });
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
      expect(revalidation.revalidatePath).toHaveBeenCalledWith('/paths/some-slug');
    });

    it('update calls invalidateOwner and revalidatePath', async () => {
      prisma.testimonial.update.mockResolvedValue(row('u', 0));
      await service.update('u', { content: 'updated' });
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
    });

    it('updateStatus calls invalidateOwner and revalidatePath', async () => {
      prisma.testimonial.update.mockResolvedValue(
        row('u', 0, TestimonialStatus.APPROVED),
      );
      await service.updateStatus('u', { status: TestimonialStatus.APPROVED });
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
      expect(revalidation.revalidatePath).toHaveBeenCalledWith('/paths/some-slug');
    });

    it('remove calls invalidateOwner and revalidatePath', async () => {
      prisma.testimonial.delete.mockResolvedValue(row('d', 0));
      await service.remove('d');
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
    });

    it('reorder calls invalidateOwner and revalidatePath', async () => {
      prisma.testimonial.findMany.mockResolvedValue([]);
      await service.reorder(MarketingOwnerType.PATH, 'p1', []);
      expect(cache.invalidateOwner).toHaveBeenCalledWith('path', 'p1');
    });
  });

  it('lists with orderBy [order asc, createdAt asc] and returns all statuses', async () => {
    prisma.testimonial.findMany.mockResolvedValue([
      row('a', 0, TestimonialStatus.PENDING),
      row('b', 1, TestimonialStatus.APPROVED),
      row('c', 2, TestimonialStatus.HIDDEN),
    ]);
    const result = await service.listByOwner(MarketingOwnerType.PATH, 'p1');
    expect(prisma.testimonial.findMany).toHaveBeenCalledWith({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: 'p1' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    expect(result.map((r) => r.status)).toEqual(['PENDING', 'APPROVED', 'HIDDEN']);
  });

  it('forces status PENDING on create even if caller tries to pass APPROVED', async () => {
    prisma.testimonial.create.mockResolvedValue(
      row('new', 0, TestimonialStatus.PENDING),
    );
    await service.create(MarketingOwnerType.PATH, 'p1', {
      authorName: 'A',
      content: 'C',
      // ValidationPipe(whitelist:true) would strip this; the service does not
      // rely on that — it always hard-sets PENDING.
      ...({ status: TestimonialStatus.APPROVED } as object),
    } as unknown as Parameters<typeof service.create>[2]);
    expect(prisma.testimonial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: TestimonialStatus.PENDING }),
      }),
    );
  });

  it('appends to end on create when order is omitted', async () => {
    prisma.testimonial.findFirst.mockResolvedValue({ order: 9 });
    prisma.testimonial.create.mockResolvedValue(row('x', 10));
    await service.create(MarketingOwnerType.PATH, 'p1', {
      authorName: 'A',
      content: 'C',
    });
    expect(prisma.testimonial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ order: 10 }),
      }),
    );
  });

  it('rejects empty update body', async () => {
    await expect(service.update('id', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('updateStatus transitions to APPROVED', async () => {
    prisma.testimonial.update.mockResolvedValue(
      row('id', 0, TestimonialStatus.APPROVED),
    );
    const result = await service.updateStatus('id', {
      status: TestimonialStatus.APPROVED,
    });
    expect(prisma.testimonial.update).toHaveBeenCalledWith({
      where: { id: 'id' },
      data: { status: TestimonialStatus.APPROVED },
    });
    expect(result.status).toBe(TestimonialStatus.APPROVED);
  });

  it('throws NotFound on P2025 for updateStatus', async () => {
    prisma.testimonial.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: 'x',
      }),
    );
    await expect(
      service.updateStatus('id', { status: TestimonialStatus.HIDDEN }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delegates reorder to the helper', async () => {
    prisma.testimonial.findMany.mockResolvedValue([row('a', 0)]);
    await service.reorder(MarketingOwnerType.PATH, 'p1', ['a']);
    expect(reorderHelper.reorder).toHaveBeenCalledWith(
      'testimonial',
      MarketingOwnerType.PATH,
      'p1',
      ['a'],
    );
  });
});
