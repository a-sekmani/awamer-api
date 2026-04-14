import { prisma, truncateAll } from './setup';

async function seedCtx() {
  const cat = await prisma.category.create({ data: { name: 'C', slug: 'tg-cat' } });
  const p1 = await prisma.path.create({
    data: { categoryId: cat.id, title: 'P1', slug: 'tg-p1' },
  });
  const p2 = await prisma.path.create({
    data: { categoryId: cat.id, title: 'P2', slug: 'tg-p2' },
  });
  const c1 = await prisma.course.create({
    data: { categoryId: cat.id, slug: 'tg-c1', title: 'C1' },
  });
  const c2 = await prisma.course.create({
    data: { categoryId: cat.id, slug: 'tg-c2', title: 'C2' },
  });
  return { cat, p1, p2, c1, c2 };
}

describe('Tag schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a tag with unique slug', async () => {
    const t = await prisma.tag.create({ data: { name: 'AI', slug: 'ai' } });
    expect(t.slug).toBe('ai');
    await expect(
      prisma.tag.create({ data: { name: 'Other', slug: 'ai' } }),
    ).rejects.toThrow();
  });

  it('links one tag to multiple paths', async () => {
    const { p1, p2 } = await seedCtx();
    const t = await prisma.tag.create({ data: { name: 'T', slug: 't' } });
    await prisma.pathTag.createMany({
      data: [
        { pathId: p1.id, tagId: t.id },
        { pathId: p2.id, tagId: t.id },
      ],
    });
    const rows = await prisma.pathTag.findMany({ where: { tagId: t.id } });
    expect(rows.length).toBe(2);
  });

  it('links one tag to multiple courses', async () => {
    const { c1, c2 } = await seedCtx();
    const t = await prisma.tag.create({ data: { name: 'T', slug: 't' } });
    await prisma.courseTag.createMany({
      data: [
        { courseId: c1.id, tagId: t.id },
        { courseId: c2.id, tagId: t.id },
      ],
    });
    const rows = await prisma.courseTag.findMany({ where: { tagId: t.id } });
    expect(rows.length).toBe(2);
  });

  it('rejects duplicate (pathId, tagId)', async () => {
    const { p1 } = await seedCtx();
    const t = await prisma.tag.create({ data: { name: 'T', slug: 't' } });
    await prisma.pathTag.create({ data: { pathId: p1.id, tagId: t.id } });
    await expect(
      prisma.pathTag.create({ data: { pathId: p1.id, tagId: t.id } }),
    ).rejects.toThrow();
  });

  it('rejects duplicate (courseId, tagId)', async () => {
    const { c1 } = await seedCtx();
    const t = await prisma.tag.create({ data: { name: 'T', slug: 't' } });
    await prisma.courseTag.create({ data: { courseId: c1.id, tagId: t.id } });
    await expect(
      prisma.courseTag.create({ data: { courseId: c1.id, tagId: t.id } }),
    ).rejects.toThrow();
  });

  it('cascades deletes from Tag to pivot rows', async () => {
    const { p1, c1 } = await seedCtx();
    const t = await prisma.tag.create({ data: { name: 'T', slug: 't' } });
    await prisma.pathTag.create({ data: { pathId: p1.id, tagId: t.id } });
    await prisma.courseTag.create({ data: { courseId: c1.id, tagId: t.id } });
    await prisma.tag.delete({ where: { id: t.id } });
    expect(await prisma.pathTag.count({ where: { tagId: t.id } })).toBe(0);
    expect(await prisma.courseTag.count({ where: { tagId: t.id } })).toBe(0);
  });
});
