import { prisma, truncateAll } from './setup';
import { MarketingOwnerType, TestimonialStatus } from '@prisma/client';

async function ctx() {
  const cat = await prisma.category.create({
    data: { name: 'C', slug: 'mc-cat' },
  });
  const p = await prisma.path.create({
    data: { categoryId: cat.id, title: 'P', slug: 'mc-p' },
  });
  const c = await prisma.course.create({
    data: { categoryId: cat.id, slug: 'mc-c', title: 'C' },
  });
  return { p, c };
}

describe('Polymorphic marketing content', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates Feature/Faq/Testimonial for ownerType=PATH', async () => {
    const { p } = await ctx();
    const f = await prisma.feature.create({
      data: {
        ownerType: MarketingOwnerType.PATH,
        ownerId: p.id,
        icon: 'i',
        title: 't',
        description: 'd',
      },
    });
    const q = await prisma.faq.create({
      data: {
        ownerType: MarketingOwnerType.PATH,
        ownerId: p.id,
        question: 'q',
        answer: 'a',
      },
    });
    const t = await prisma.testimonial.create({
      data: {
        ownerType: MarketingOwnerType.PATH,
        ownerId: p.id,
        authorName: 'A',
        content: 'c',
        status: TestimonialStatus.APPROVED,
      },
    });
    expect(f.ownerType).toBe(MarketingOwnerType.PATH);
    expect(q.ownerId).toBe(p.id);
    expect(t.status).toBe(TestimonialStatus.APPROVED);
  });

  it('creates Feature/Faq/Testimonial for ownerType=COURSE', async () => {
    const { c } = await ctx();
    const f = await prisma.feature.create({
      data: {
        ownerType: MarketingOwnerType.COURSE,
        ownerId: c.id,
        icon: 'i',
        title: 't',
        description: 'd',
      },
    });
    const q = await prisma.faq.create({
      data: {
        ownerType: MarketingOwnerType.COURSE,
        ownerId: c.id,
        question: 'q',
        answer: 'a',
      },
    });
    const t = await prisma.testimonial.create({
      data: {
        ownerType: MarketingOwnerType.COURSE,
        ownerId: c.id,
        authorName: 'A',
        content: 'c',
      },
    });
    expect(f.ownerType).toBe(MarketingOwnerType.COURSE);
    expect(q.ownerId).toBe(c.id);
    expect(t.ownerId).toBe(c.id);
  });

  it('PENDING testimonial is excluded from APPROVED filter', async () => {
    const { p } = await ctx();
    await prisma.testimonial.create({
      data: {
        ownerType: MarketingOwnerType.PATH,
        ownerId: p.id,
        authorName: 'P',
        content: 'x',
        status: TestimonialStatus.PENDING,
      },
    });
    await prisma.testimonial.create({
      data: {
        ownerType: MarketingOwnerType.PATH,
        ownerId: p.id,
        authorName: 'A',
        content: 'y',
        status: TestimonialStatus.APPROVED,
      },
    });
    const approved = await prisma.testimonial.findMany({
      where: { ownerId: p.id, status: TestimonialStatus.APPROVED },
    });
    expect(approved.length).toBe(1);
    expect(approved[0].authorName).toBe('A');
  });

  it('orders features/faqs/testimonials by order field', async () => {
    const { p } = await ctx();
    await prisma.feature.createMany({
      data: [
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: p.id,
          icon: 'i',
          title: 'b',
          description: 'd',
          order: 2,
        },
        {
          ownerType: MarketingOwnerType.PATH,
          ownerId: p.id,
          icon: 'i',
          title: 'a',
          description: 'd',
          order: 1,
        },
      ],
    });
    const rows = await prisma.feature.findMany({
      where: { ownerId: p.id },
      orderBy: { order: 'asc' },
    });
    expect(rows.map((r) => r.title)).toEqual(['a', 'b']);
  });

  it('index on (ownerType, ownerId) exists', async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('features','faqs','testimonials') AND indexdef ILIKE '%ownerType%' AND indexdef ILIKE '%ownerId%'`,
    );
    expect(idx.length).toBeGreaterThanOrEqual(3);
  });
});
