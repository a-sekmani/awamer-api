import { INestApplication } from '@nestjs/common';
import {
  MarketingOwnerType,
  PrismaClient,
  TestimonialStatus,
} from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from '../tags/test-app';
import { MarketingCleanupHelper } from '../../../src/content/marketing/helpers/marketing-cleanup.helper';

const prisma: PrismaClient = testPrisma;

describe('MarketingCleanupHelper (e2e)', () => {
  let app: INestApplication;
  let helper: MarketingCleanupHelper;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    helper = app.get(MarketingCleanupHelper);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function seedOwnerWithContent(
    kind: 'path' | 'course',
    slugSuffix: string,
  ): Promise<string> {
    const cat = await prisma.category.create({
      data: { name: `Cat-${slugSuffix}`, slug: `cleanup-cat-${slugSuffix}` },
    });
    let ownerId: string;
    let ownerType: MarketingOwnerType;
    if (kind === 'path') {
      const p = await prisma.path.create({
        data: {
          categoryId: cat.id,
          title: 'P',
          slug: `cleanup-p-${slugSuffix}`,
        },
      });
      ownerId = p.id;
      ownerType = MarketingOwnerType.PATH;
    } else {
      const c = await prisma.course.create({
        data: {
          categoryId: cat.id,
          title: 'C',
          slug: `cleanup-c-${slugSuffix}`,
        },
      });
      ownerId = c.id;
      ownerType = MarketingOwnerType.COURSE;
    }
    await prisma.feature.create({
      data: {
        ownerType,
        ownerId,
        icon: 'i',
        title: 'T',
        description: 'D',
      },
    });
    await prisma.faq.create({
      data: { ownerType, ownerId, question: 'Q', answer: 'A' },
    });
    await prisma.testimonial.create({
      data: {
        ownerType,
        ownerId,
        authorName: 'X',
        content: 'C',
        status: TestimonialStatus.APPROVED,
      },
    });
    return ownerId;
  }

  it('deleteAllForPath removes only the target path content', async () => {
    const pathAId = await seedOwnerWithContent('path', 'a');
    const pathBId = await seedOwnerWithContent('path', 'b');

    await helper.deleteAllForPath(pathAId);

    const aFeatures = await prisma.feature.count({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: pathAId },
    });
    const aFaqs = await prisma.faq.count({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: pathAId },
    });
    const aTestimonials = await prisma.testimonial.count({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: pathAId },
    });
    expect(aFeatures).toBe(0);
    expect(aFaqs).toBe(0);
    expect(aTestimonials).toBe(0);

    const bFeatures = await prisma.feature.count({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: pathBId },
    });
    const bFaqs = await prisma.faq.count({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: pathBId },
    });
    const bTestimonials = await prisma.testimonial.count({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: pathBId },
    });
    expect(bFeatures).toBe(1);
    expect(bFaqs).toBe(1);
    expect(bTestimonials).toBe(1);
  });

  it('deleteAllForCourse removes only the target course content', async () => {
    const courseId = await seedOwnerWithContent('course', 'x');
    const otherCourseId = await seedOwnerWithContent('course', 'y');

    await helper.deleteAllForCourse(courseId);

    expect(
      await prisma.feature.count({
        where: { ownerType: MarketingOwnerType.COURSE, ownerId: courseId },
      }),
    ).toBe(0);
    expect(
      await prisma.feature.count({
        where: {
          ownerType: MarketingOwnerType.COURSE,
          ownerId: otherCourseId,
        },
      }),
    ).toBe(1);
  });

  it('is a no-op on an owner with no marketing content', async () => {
    const cat = await prisma.category.create({
      data: { name: 'C', slug: 'cleanup-empty' },
    });
    const path = await prisma.path.create({
      data: { categoryId: cat.id, title: 'P', slug: 'cleanup-empty-p' },
    });
    await expect(helper.deleteAllForPath(path.id)).resolves.toBeUndefined();
  });
});
