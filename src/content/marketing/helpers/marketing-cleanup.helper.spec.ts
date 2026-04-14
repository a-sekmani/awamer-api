import { Test } from '@nestjs/testing';
import { MarketingOwnerType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketingCleanupHelper } from './marketing-cleanup.helper';

describe('MarketingCleanupHelper', () => {
  let helper: MarketingCleanupHelper;
  let prisma: {
    feature: { deleteMany: jest.Mock };
    faq: { deleteMany: jest.Mock };
    testimonial: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      feature: { deleteMany: jest.fn((args) => ({ __d: 'feature', args })) },
      faq: { deleteMany: jest.fn((args) => ({ __d: 'faq', args })) },
      testimonial: {
        deleteMany: jest.fn((args) => ({ __d: 'testimonial', args })),
      },
      $transaction: jest.fn((ops) => Promise.resolve(ops)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketingCleanupHelper,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    helper = moduleRef.get(MarketingCleanupHelper);
  });

  it('deletes features, faqs, and testimonials for a path in a transaction', async () => {
    await helper.deleteAllForPath('p1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.feature.deleteMany).toHaveBeenCalledWith({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: 'p1' },
    });
    expect(prisma.faq.deleteMany).toHaveBeenCalledWith({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: 'p1' },
    });
    expect(prisma.testimonial.deleteMany).toHaveBeenCalledWith({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: 'p1' },
    });
  });

  it('deletes features, faqs, and testimonials for a course in a transaction', async () => {
    await helper.deleteAllForCourse('c1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.feature.deleteMany).toHaveBeenCalledWith({
      where: { ownerType: MarketingOwnerType.COURSE, ownerId: 'c1' },
    });
    expect(prisma.faq.deleteMany).toHaveBeenCalledWith({
      where: { ownerType: MarketingOwnerType.COURSE, ownerId: 'c1' },
    });
    expect(prisma.testimonial.deleteMany).toHaveBeenCalledWith({
      where: { ownerType: MarketingOwnerType.COURSE, ownerId: 'c1' },
    });
  });

  it('is a no-op on an owner with no marketing content', async () => {
    prisma.feature.deleteMany.mockResolvedValue({ count: 0 });
    prisma.faq.deleteMany.mockResolvedValue({ count: 0 });
    prisma.testimonial.deleteMany.mockResolvedValue({ count: 0 });
    await expect(helper.deleteAllForPath('empty')).resolves.toBeUndefined();
  });
});
