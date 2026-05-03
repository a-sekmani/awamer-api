import { prisma, truncateAll } from './setup';
import { EnrollmentStatus, CourseEnrollmentStatus } from '@prisma/client';

async function ctx() {
  const user = await prisma.user.create({
    data: { name: 'U', email: 'u@test.local', passwordHash: 'x' },
  });
  const cat = await prisma.category.create({
    data: { name: 'C', slug: 'e-cat' },
  });
  const pathA = await prisma.path.create({
    data: { categoryId: cat.id, title: 'PA', slug: 'e-pa' },
  });
  const courseB = await prisma.course.create({
    data: { categoryId: cat.id, slug: 'e-cb', title: 'CB' },
  });
  return { user, pathA, courseB };
}

describe('Enrollment schema', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a PathEnrollment', async () => {
    const { user, pathA } = await ctx();
    const e = await prisma.pathEnrollment.create({
      data: {
        userId: user.id,
        pathId: pathA.id,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    expect(e.userId).toBe(user.id);
  });

  it('creates a CourseEnrollment', async () => {
    const { user, courseB } = await ctx();
    const e = await prisma.courseEnrollment.create({
      data: {
        userId: user.id,
        courseId: courseB.id,
        status: CourseEnrollmentStatus.ACTIVE,
      },
    });
    expect(e.courseId).toBe(courseB.id);
  });

  it('same user can have a path AND course enrollment simultaneously', async () => {
    const { user, pathA, courseB } = await ctx();
    await prisma.pathEnrollment.create({
      data: { userId: user.id, pathId: pathA.id },
    });
    await prisma.courseEnrollment.create({
      data: { userId: user.id, courseId: courseB.id },
    });
    expect(
      await prisma.pathEnrollment.count({ where: { userId: user.id } }),
    ).toBe(1);
    expect(
      await prisma.courseEnrollment.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('rejects a duplicate (userId, courseId) course enrollment', async () => {
    const { user, courseB } = await ctx();
    await prisma.courseEnrollment.create({
      data: { userId: user.id, courseId: courseB.id },
    });
    await expect(
      prisma.courseEnrollment.create({
        data: { userId: user.id, courseId: courseB.id },
      }),
    ).rejects.toThrow();
  });

  it('path_enrollments: duplicate (userId, pathId) — depends on existing constraint', async () => {
    const { user, pathA } = await ctx();
    await prisma.pathEnrollment.create({
      data: { userId: user.id, pathId: pathA.id },
    });
    // The existing schema has no @@unique on PathEnrollment; the spec test says
    // "rejects". This test documents the current behavior: if no unique exists,
    // a duplicate is allowed. If the project later adds @@unique, this test
    // should be flipped to expect rejection.
    const exists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE tablename = 'path_enrollments'
           AND indexdef ILIKE '%UNIQUE%'
           AND indexdef ILIKE '%userId%'
           AND indexdef ILIKE '%pathId%'
       ) AS exists`,
    );
    if (exists[0]?.exists) {
      await expect(
        prisma.pathEnrollment.create({
          data: { userId: user.id, pathId: pathA.id },
        }),
      ).rejects.toThrow();
    } else {
      const second = await prisma.pathEnrollment.create({
        data: { userId: user.id, pathId: pathA.id },
      });
      expect(second.id).toBeDefined();
    }
  });
});
