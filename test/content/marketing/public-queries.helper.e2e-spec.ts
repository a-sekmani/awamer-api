import { INestApplication } from '@nestjs/common';
import {
  MarketingOwnerType,
  PrismaClient,
  TestimonialStatus,
} from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from '../tags/test-app';
import { PublicMarketingQueries } from '../../../src/content/marketing/helpers/public-queries.helper';

const prisma: PrismaClient = testPrisma;

describe('PublicMarketingQueries (e2e)', () => {
  let app: INestApplication;
  let queries: PublicMarketingQueries;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    queries = app.get(PublicMarketingQueries);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function seedPath() {
    const cat = await prisma.category.create({
      data: { name: 'C', slug: 'pq-cat' },
    });
    return prisma.path.create({
      data: { categoryId: cat.id, title: 'P', slug: 'pq-p' },
    });
  }

  it('getFeaturesByOwner returns features ordered by order ASC, id ASC', async () => {
    const path = await seedPath();
    await prisma.feature.createMany({
      data: [
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          icon: 'a',
          title: 'T1',
          description: 'D',
          order: 2,
        },
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          icon: 'a',
          title: 'T2',
          description: 'D',
          order: 0,
        },
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          icon: 'a',
          title: 'T3',
          description: 'D',
          order: 1,
        },
      ],
    });
    const features = await queries.getFeaturesByOwner(
      MarketingOwnerType.PATH,
      path.id,
    );
    expect(features.map((f) => f.order)).toEqual([0, 1, 2]);
  });

  it('getFaqsByOwner returns faqs ordered by order ASC', async () => {
    const path = await seedPath();
    await prisma.faq.createMany({
      data: [
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          question: 'Q1',
          answer: 'A',
          order: 1,
        },
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          question: 'Q2',
          answer: 'A',
          order: 0,
        },
      ],
    });
    const faqs = await queries.getFaqsByOwner(MarketingOwnerType.PATH, path.id);
    expect(faqs.map((f) => f.order)).toEqual([0, 1]);
  });

  it('getApprovedTestimonialsByOwner returns only APPROVED items in order', async () => {
    const path = await seedPath();
    await prisma.testimonial.createMany({
      data: [
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          authorName: 'A',
          content: 'Pending',
          status: TestimonialStatus.PENDING,
          order: 0,
        },
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          authorName: 'B',
          content: 'Approved 2',
          status: TestimonialStatus.APPROVED,
          order: 2,
        },
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          authorName: 'C',
          content: 'Approved 1',
          status: TestimonialStatus.APPROVED,
          order: 1,
        },
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: path.id,
          authorName: 'D',
          content: 'Hidden',
          status: TestimonialStatus.HIDDEN,
          order: 3,
        },
      ],
    });

    const approved = await queries.getApprovedTestimonialsByOwner(
      MarketingOwnerType.PATH,
      path.id,
    );
    expect(approved).toHaveLength(2);
    expect(approved.map((t) => t.content)).toEqual([
      'Approved 1',
      'Approved 2',
    ]);
    expect(approved.every((t) => t.status === TestimonialStatus.APPROVED)).toBe(
      true,
    );
  });

  it('returns [] when owner has no marketing content', async () => {
    const path = await seedPath();
    expect(
      await queries.getFeaturesByOwner(MarketingOwnerType.PATH, path.id),
    ).toEqual([]);
    expect(
      await queries.getFaqsByOwner(MarketingOwnerType.PATH, path.id),
    ).toEqual([]);
    expect(
      await queries.getApprovedTestimonialsByOwner(
        MarketingOwnerType.PATH,
        path.id,
      ),
    ).toEqual([]);
  });
});
