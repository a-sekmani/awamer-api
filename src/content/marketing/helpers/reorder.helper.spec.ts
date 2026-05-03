import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MarketingOwnerType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReorderHelper } from './reorder.helper';

describe('ReorderHelper', () => {
  let helper: ReorderHelper;
  let prisma: {
    feature: { findMany: jest.Mock; update: jest.Mock };
    faq: { findMany: jest.Mock; update: jest.Mock };
    testimonial: { findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      feature: {
        findMany: jest.fn(),
        update: jest.fn((args) => ({ __update: args })),
      },
      faq: {
        findMany: jest.fn(),
        update: jest.fn((args) => ({ __update: args })),
      },
      testimonial: {
        findMany: jest.fn(),
        update: jest.fn((args) => ({ __update: args })),
      },
      $transaction: jest.fn((ops) => Promise.resolve(ops)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ReorderHelper, { provide: PrismaService, useValue: prisma }],
    }).compile();
    helper = moduleRef.get(ReorderHelper);
  });

  it('reassigns order based on input list index (happy path)', async () => {
    prisma.feature.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    await helper.reorder('feature', MarketingOwnerType.PATH, 'p1', [
      'c',
      'a',
      'b',
    ]);
    expect(prisma.feature.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'c' },
      data: { order: 0 },
    });
    expect(prisma.feature.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'a' },
      data: { order: 1 },
    });
    expect(prisma.feature.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'b' },
      data: { order: 2 },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects input with duplicate ids', async () => {
    await expect(
      helper.reorder('faq', MarketingOwnerType.PATH, 'p1', ['a', 'a']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects input missing an existing id', async () => {
    prisma.faq.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(
      helper.reorder('faq', MarketingOwnerType.PATH, 'p1', ['a']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects input containing a foreign id', async () => {
    prisma.testimonial.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(
      helper.reorder('testimonial', MarketingOwnerType.COURSE, 'c1', [
        'a',
        'foreign',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('runs inside a Prisma transaction', async () => {
    prisma.faq.findMany.mockResolvedValue([{ id: 'a' }]);
    await helper.reorder('faq', MarketingOwnerType.COURSE, 'c1', ['a']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(1);
  });
});
