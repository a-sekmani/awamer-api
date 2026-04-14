import { prisma, truncateAll } from './setup';
import { LessonType } from '@prisma/client';

async function ctx() {
  const user = await prisma.user.create({
    data: { name: 'U', email: 'lp@test.local', passwordHash: 'x' },
  });
  const cat = await prisma.category.create({ data: { name: 'C', slug: 'lp-cat' } });
  const path = await prisma.path.create({
    data: { categoryId: cat.id, title: 'P', slug: 'lp-p' },
  });
  const courseInPath = await prisma.course.create({
    data: {
      categoryId: cat.id,
      pathId: path.id,
      order: 1,
      slug: 'lp-ci',
      title: 'CI',
    },
  });
  const standalone = await prisma.course.create({
    data: { categoryId: cat.id, slug: 'lp-sc', title: 'SC' },
  });
  const section1 = await prisma.section.create({
    data: { courseId: courseInPath.id, title: 'S1', order: 1 },
  });
  const section2 = await prisma.section.create({
    data: { courseId: standalone.id, title: 'S2', order: 1 },
  });
  const lesson1 = await prisma.lesson.create({
    data: { sectionId: section1.id, title: 'L1', type: LessonType.TEXT, order: 1 },
  });
  const lesson2 = await prisma.lesson.create({
    data: { sectionId: section2.id, title: 'L2', type: LessonType.TEXT, order: 1 },
  });
  return { user, path, standalone, section1, section2, lesson1, lesson2 };
}

describe('LastPosition schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a LastPosition scoped to a path', async () => {
    const { user, path, section1, lesson1 } = await ctx();
    const lp = await prisma.lastPosition.create({
      data: {
        userId: user.id,
        pathId: path.id,
        courseId: null,
        sectionId: section1.id,
        lessonId: lesson1.id,
      },
    });
    expect(lp.pathId).toBe(path.id);
    expect(lp.courseId).toBeNull();
  });

  it('creates a LastPosition scoped to a standalone course', async () => {
    const { user, standalone, section2, lesson2 } = await ctx();
    const lp = await prisma.lastPosition.create({
      data: {
        userId: user.id,
        pathId: null,
        courseId: standalone.id,
        sectionId: section2.id,
        lessonId: lesson2.id,
      },
    });
    expect(lp.courseId).toBe(standalone.id);
    expect(lp.pathId).toBeNull();
  });

  it('CHECK rejects both pathId and courseId set', async () => {
    const { user, path, standalone, section1, lesson1 } = await ctx();
    await expect(
      prisma.lastPosition.create({
        data: {
          userId: user.id,
          pathId: path.id,
          courseId: standalone.id,
          sectionId: section1.id,
          lessonId: lesson1.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('CHECK rejects neither pathId nor courseId set', async () => {
    const { user, section1, lesson1 } = await ctx();
    await expect(
      prisma.lastPosition.create({
        data: {
          userId: user.id,
          pathId: null,
          courseId: null,
          sectionId: section1.id,
          lessonId: lesson1.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('partial unique: one LastPosition per (user, path)', async () => {
    const { user, path, section1, lesson1 } = await ctx();
    await prisma.lastPosition.create({
      data: {
        userId: user.id,
        pathId: path.id,
        sectionId: section1.id,
        lessonId: lesson1.id,
      },
    });
    await expect(
      prisma.lastPosition.create({
        data: {
          userId: user.id,
          pathId: path.id,
          sectionId: section1.id,
          lessonId: lesson1.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('partial unique: one LastPosition per (user, standalone course)', async () => {
    const { user, standalone, section2, lesson2 } = await ctx();
    await prisma.lastPosition.create({
      data: {
        userId: user.id,
        courseId: standalone.id,
        sectionId: section2.id,
        lessonId: lesson2.id,
      },
    });
    await expect(
      prisma.lastPosition.create({
        data: {
          userId: user.id,
          courseId: standalone.id,
          sectionId: section2.id,
          lessonId: lesson2.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('updates lessonId via update on existing LastPosition', async () => {
    const { user, path, section1, lesson1 } = await ctx();
    const newLesson = await prisma.lesson.create({
      data: { sectionId: section1.id, title: 'L1b', type: LessonType.TEXT, order: 2 },
    });
    const lp = await prisma.lastPosition.create({
      data: {
        userId: user.id,
        pathId: path.id,
        sectionId: section1.id,
        lessonId: lesson1.id,
      },
    });
    const updated = await prisma.lastPosition.update({
      where: { id: lp.id },
      data: { lessonId: newLesson.id },
    });
    expect(updated.lessonId).toBe(newLesson.id);
  });
});
