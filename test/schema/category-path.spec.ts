import { prisma, truncateAll } from './setup';
import { PathStatus, CategoryStatus } from '@prisma/client';

async function makeCategory(slug = 'cat-test') {
  return prisma.category.create({
    data: { name: 'Test', slug, status: CategoryStatus.ACTIVE },
  });
}

describe('Category / Path schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a Path referencing an existing Category', async () => {
    const cat = await makeCategory();
    const path = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'Path',
        slug: 'p1',
        status: PathStatus.DRAFT,
      },
    });
    expect(path.categoryId).toBe(cat.id);
  });

  it('fails to create a Path with a missing/invalid categoryId (FK)', async () => {
    await expect(
      prisma.path.create({
        data: {
          categoryId: '00000000-0000-0000-0000-000000000000',
          title: 'Path',
          slug: 'p2',
        },
      }),
    ).rejects.toThrow();
  });

  it('round-trips all new Path fields', async () => {
    const cat = await makeCategory('cat-rt');
    const created = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'RT',
        slug: 'rt-path',
        subtitle: 'Sub',
        promoVideoUrl: 'https://v/x.mp4',
        promoVideoThumbnail: 'https://v/x.jpg',
        isNew: true,
        skills: ['a', 'b', 'c'],
      },
    });
    const found = await prisma.path.findUnique({ where: { id: created.id } });
    expect(found?.subtitle).toBe('Sub');
    expect(found?.promoVideoUrl).toBe('https://v/x.mp4');
    expect(found?.promoVideoThumbnail).toBe('https://v/x.jpg');
    expect(found?.isNew).toBe(true);
    expect(found?.skills).toEqual(['a', 'b', 'c']);
  });

  it('skills JSONB accepts arrays of varying length', async () => {
    const cat = await makeCategory('cat-sk');
    const lengths = [3, 5, 10];
    for (const [i, n] of lengths.entries()) {
      const arr = Array.from({ length: n }, (_, k) => `s${k}`);
      const p = await prisma.path.create({
        data: {
          categoryId: cat.id,
          title: 'L',
          slug: `sk-${i}`,
          skills: arr,
        },
      });
      const re = await prisma.path.findUnique({ where: { id: p.id } });
      expect(Array.isArray(re?.skills)).toBe(true);
      expect((re?.skills as string[]).length).toBe(n);
    }
  });

  it('preserves skills element order and Arabic characters', async () => {
    const cat = await makeCategory('cat-ar');
    const arr = ['بايثون', 'تعلم آلي', 'شبكات'];
    const p = await prisma.path.create({
      data: { categoryId: cat.id, title: 'AR', slug: 'ar-path', skills: arr },
    });
    const re = await prisma.path.findUnique({ where: { id: p.id } });
    expect(re?.skills).toEqual(arr);
  });
});
