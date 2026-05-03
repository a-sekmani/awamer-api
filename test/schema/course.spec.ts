import { prisma, truncateAll } from './setup';
import { CourseLevel, CourseStatus, PathStatus } from '@prisma/client';

async function makeCategory(slug = 'c-cat') {
  return prisma.category.create({ data: { name: 'C', slug } });
}
async function makePath(categoryId: string, slug = 'c-path') {
  return prisma.path.create({
    data: { categoryId, title: 'P', slug, status: PathStatus.DRAFT },
  });
}

describe('Course schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a standalone course (categoryId set, pathId=null, order=null)', async () => {
    const cat = await makeCategory();
    const c = await prisma.course.create({
      data: {
        categoryId: cat.id,
        pathId: null,
        order: null,
        slug: 'standalone',
        title: 'Standalone',
        status: CourseStatus.PUBLISHED,
      },
    });
    expect(c.pathId).toBeNull();
    expect(c.order).toBeNull();
    expect(c.categoryId).toBe(cat.id);
  });

  it('creates a path-attached course with order set', async () => {
    const cat = await makeCategory();
    const p = await makePath(cat.id);
    const c = await prisma.course.create({
      data: {
        categoryId: cat.id,
        pathId: p.id,
        order: 1,
        slug: 'attached',
        title: 'Attached',
      },
    });
    expect(c.pathId).toBe(p.id);
    expect(c.order).toBe(1);
  });

  it('fails without a categoryId', async () => {
    await expect(
      // @ts-expect-error intentionally omitting categoryId
      prisma.course.create({ data: { slug: 'bad', title: 'x' } }),
    ).rejects.toThrow();
  });

  it('enforces globally unique slug', async () => {
    const cat = await makeCategory();
    await prisma.course.create({
      data: { categoryId: cat.id, slug: 'dup', title: 'One' },
    });
    await expect(
      prisma.course.create({
        data: { categoryId: cat.id, slug: 'dup', title: 'Two' },
      }),
    ).rejects.toThrow();
  });

  it('detaches a course from its path (pathId -> null)', async () => {
    const cat = await makeCategory();
    const p = await makePath(cat.id);
    const c = await prisma.course.create({
      data: {
        categoryId: cat.id,
        pathId: p.id,
        order: 1,
        slug: 'det',
        title: 'D',
      },
    });
    const updated = await prisma.course.update({
      where: { id: c.id },
      data: { pathId: null, order: null },
    });
    expect(updated.pathId).toBeNull();
  });

  it('moves a course from one path to another', async () => {
    const cat = await makeCategory();
    const p1 = await makePath(cat.id, 'p-a');
    const p2 = await makePath(cat.id, 'p-b');
    const c = await prisma.course.create({
      data: {
        categoryId: cat.id,
        pathId: p1.id,
        order: 1,
        slug: 'mv',
        title: 'M',
      },
    });
    const updated = await prisma.course.update({
      where: { id: c.id },
      data: { pathId: p2.id },
    });
    expect(updated.pathId).toBe(p2.id);
  });

  it('round-trips new fields', async () => {
    const cat = await makeCategory();
    const c = await prisma.course.create({
      data: {
        categoryId: cat.id,
        slug: 'rt',
        title: 'RT',
        subtitle: 'sub',
        level: CourseLevel.ADVANCED,
        thumbnail: 'https://t',
        isNew: true,
        skills: ['x', 'y'],
      },
    });
    const found = await prisma.course.findUnique({ where: { id: c.id } });
    expect(found?.subtitle).toBe('sub');
    expect(found?.level).toBe(CourseLevel.ADVANCED);
    expect(found?.thumbnail).toBe('https://t');
    expect(found?.isNew).toBe(true);
    expect(found?.skills).toEqual(['x', 'y']);
  });
});
