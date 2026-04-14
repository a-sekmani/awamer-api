import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../schema/setup';
import { createTestApp } from '../content/tags/test-app';

const prisma: PrismaClient = testPrisma;

/**
 * Sign a learner JWT for an arbitrary user uuid. The test app's `JwtStrategy`
 * does not hit the database, so any uuid + a valid signature works — FK-bound
 * writes still require the matching `User` row to exist in the test DB, which
 * `seedUser` below handles.
 */
async function signFor(
  app: INestApplication,
  userId: string,
): Promise<string> {
  const jwt = app.get(JwtService);
  return (
    'Bearer ' +
    jwt.sign({
      sub: userId,
      email: `${userId}@awamer.test`,
      emailVerified: true,
      onboardingCompleted: true,
      roles: ['learner'],
    })
  );
}

async function seedUser(suffix: string) {
  return prisma.user.create({
    data: {
      name: `Learner ${suffix}`,
      email: `learner-${suffix}@awamer.test`,
      passwordHash: 'hash',
    },
  });
}

async function seedStandaloneCourse(suffix: string) {
  const cat = await prisma.category.create({
    data: { name: `Cat ${suffix}`, slug: `enr-cat-${suffix}` },
  });
  const course = await prisma.course.create({
    data: {
      categoryId: cat.id,
      pathId: null,
      title: `Standalone ${suffix}`,
      slug: `enr-standalone-${suffix}`,
      sections: {
        create: [
          {
            title: 'S1',
            order: 0,
            lessons: {
              create: [
                { title: 'L1', order: 0, type: 'TEXT' as const },
                { title: 'L2', order: 1, type: 'TEXT' as const },
              ],
            },
          },
          {
            title: 'S2',
            order: 1,
            lessons: { create: [{ title: 'L3', order: 0, type: 'TEXT' as const }] },
          },
        ],
      },
    },
    include: { sections: { include: { lessons: true } } },
  });
  return { course };
}

async function seedPathWithCourses(suffix: string) {
  const cat = await prisma.category.create({
    data: { name: `Cat ${suffix}`, slug: `enr-pcat-${suffix}` },
  });
  const path = await prisma.path.create({
    data: {
      categoryId: cat.id,
      title: `Path ${suffix}`,
      slug: `enr-path-${suffix}`,
    },
  });
  const courseA = await prisma.course.create({
    data: {
      categoryId: cat.id,
      pathId: path.id,
      title: 'Course A',
      slug: `enr-pc-a-${suffix}`,
      sections: {
        create: [
          {
            title: 'S1',
            order: 0,
            lessons: { create: [{ title: 'L1', order: 0, type: 'TEXT' as const }] },
          },
        ],
      },
    },
  });
  const courseB = await prisma.course.create({
    data: {
      categoryId: cat.id,
      pathId: path.id,
      title: 'Course B',
      slug: `enr-pc-b-${suffix}`,
      sections: {
        create: [
          {
            title: 'S1',
            order: 0,
            lessons: { create: [{ title: 'L1', order: 0, type: 'TEXT' as const }] },
          },
        ],
      },
    },
  });
  return { path, courses: [courseA, courseB] };
}

describe('EnrollmentController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // =========================================================================
  // US1 — POST /enrollments/courses/:courseId
  // =========================================================================
  describe('POST /enrollments/courses/:courseId (US1)', () => {
    it('enrolls a standalone course and creates the full progress tree', async () => {
      const user = await seedUser('a');
      const { course } = await seedStandaloneCourse('a');
      const bearer = await signFor(app, user.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/enrollments/courses/${course.id}`)
        .set('Authorization', bearer);

      expect(res.status).toBe(201);
      expect(res.body.data.courseId).toBe(course.id);
      expect(res.body.data.status).toBe('ACTIVE');

      const ce = await prisma.courseEnrollment.count({
        where: { userId: user.id, courseId: course.id },
      });
      const cp = await prisma.courseProgress.count({
        where: { userId: user.id, courseId: course.id },
      });
      const sp = await prisma.sectionProgress.count({
        where: { userId: user.id, section: { courseId: course.id } },
      });
      expect(ce).toBe(1);
      expect(cp).toBe(1);
      expect(sp).toBe(2);
    });

    it('returns 400 with parentPathId when the course belongs to a path', async () => {
      const user = await seedUser('b');
      const { path, courses } = await seedPathWithCourses('b');
      const bearer = await signFor(app, user.id);
      const courseId = courses[0].id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/enrollments/courses/${courseId}`)
        .set('Authorization', bearer);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('belongs to a path');
      expect(res.body.parentPathId).toBe(path.id);
    });

    it('returns 404 for a nonexistent course', async () => {
      const user = await seedUser('c');
      const bearer = await signFor(app, user.id);
      const res = await request(app.getHttpServer())
        .post('/api/v1/enrollments/courses/00000000-0000-0000-0000-000000000099')
        .set('Authorization', bearer);
      expect(res.status).toBe(404);
    });

    it('returns 409 on duplicate enrollment', async () => {
      const user = await seedUser('d');
      const { course } = await seedStandaloneCourse('d');
      const bearer = await signFor(app, user.id);
      await request(app.getHttpServer())
        .post(`/api/v1/enrollments/courses/${course.id}`)
        .set('Authorization', bearer)
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/enrollments/courses/${course.id}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(409);
    });

    it('returns 401 when unauthenticated', async () => {
      const { course } = await seedStandaloneCourse('e');
      const res = await request(app.getHttpServer()).post(
        `/api/v1/enrollments/courses/${course.id}`,
      );
      expect(res.status).toBe(401);
    });

    it('round-trips Arabic course titles', async () => {
      const user = await seedUser('ar');
      const cat = await prisma.category.create({
        data: { name: 'C', slug: 'enr-ar-cat' },
      });
      const course = await prisma.course.create({
        data: {
          categoryId: cat.id,
          title: 'مقدمة في الذكاء الاصطناعي',
          slug: 'enr-ar-course',
          sections: {
            create: [
              {
                title: 'القسم الأول',
                order: 0,
                lessons: { create: [{ title: 'الدرس', order: 0, type: 'TEXT' as const }] },
              },
            ],
          },
        },
      });
      const bearer = await signFor(app, user.id);
      await request(app.getHttpServer())
        .post(`/api/v1/enrollments/courses/${course.id}`)
        .set('Authorization', bearer)
        .expect(201);

      const list = await request(app.getHttpServer())
        .get('/api/v1/enrollments/me')
        .set('Authorization', bearer);
      expect(list.body.data.courses[0].course.title).toBe(
        'مقدمة في الذكاء الاصطناعي',
      );
    });
  });

  // =========================================================================
  // US2 — POST /enrollments/paths/:pathId
  // =========================================================================
  describe('POST /enrollments/paths/:pathId (US2)', () => {
    it('enrolls in a path and creates PathProgress + per-course CourseProgress', async () => {
      const user = await seedUser('p1');
      const { path } = await seedPathWithCourses('p1');
      const bearer = await signFor(app, user.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/enrollments/paths/${path.id}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(201);
      expect(res.body.data.pathId).toBe(path.id);
      expect(res.body.data.status).toBe('ACTIVE');

      const pe = await prisma.pathEnrollment.count({
        where: { userId: user.id, pathId: path.id },
      });
      const pp = await prisma.pathProgress.count({
        where: { userId: user.id, pathId: path.id },
      });
      const cp = await prisma.courseProgress.count({
        where: { userId: user.id, course: { pathId: path.id } },
      });
      expect(pe).toBe(1);
      expect(pp).toBe(1);
      expect(cp).toBe(2);
    });

    it('returns 409 on duplicate', async () => {
      const user = await seedUser('p2');
      const { path } = await seedPathWithCourses('p2');
      const bearer = await signFor(app, user.id);
      await request(app.getHttpServer())
        .post(`/api/v1/enrollments/paths/${path.id}`)
        .set('Authorization', bearer)
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/enrollments/paths/${path.id}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(409);
    });

    it('returns 404 for a nonexistent path', async () => {
      const user = await seedUser('p3');
      const bearer = await signFor(app, user.id);
      const res = await request(app.getHttpServer())
        .post('/api/v1/enrollments/paths/00000000-0000-0000-0000-000000000099')
        .set('Authorization', bearer);
      expect(res.status).toBe(404);
    });

    it('supports simultaneous path + standalone course enrollment for the same user', async () => {
      const user = await seedUser('both');
      const { path } = await seedPathWithCourses('both');
      const { course } = await seedStandaloneCourse('both');
      const bearer = await signFor(app, user.id);
      await request(app.getHttpServer())
        .post(`/api/v1/enrollments/paths/${path.id}`)
        .set('Authorization', bearer)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/enrollments/courses/${course.id}`)
        .set('Authorization', bearer)
        .expect(201);

      const list = await request(app.getHttpServer())
        .get('/api/v1/enrollments/me')
        .set('Authorization', bearer);
      expect(list.body.data.paths).toHaveLength(1);
      expect(list.body.data.courses).toHaveLength(1);
    });
  });

  // =========================================================================
  // US5 — GET /enrollments/me and /enrollments/me/courses/:courseId
  // =========================================================================
  describe('GET /enrollments/me (US5)', () => {
    it('returns empty arrays when user has no enrollments', async () => {
      const user = await seedUser('empty');
      const bearer = await signFor(app, user.id);
      const res = await request(app.getHttpServer())
        .get('/api/v1/enrollments/me')
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ paths: [], courses: [] });
    });

    it('does NOT include path-attached courses under courses', async () => {
      const user = await seedUser('list');
      const { path } = await seedPathWithCourses('list');
      const bearer = await signFor(app, user.id);
      await request(app.getHttpServer())
        .post(`/api/v1/enrollments/paths/${path.id}`)
        .set('Authorization', bearer);
      const res = await request(app.getHttpServer())
        .get('/api/v1/enrollments/me')
        .set('Authorization', bearer);
      expect(res.body.data.paths).toHaveLength(1);
      expect(res.body.data.courses).toHaveLength(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/enrollments/me');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /enrollments/me/courses/:courseId (US5)', () => {
    it('returns the detail with progress for an enrolled standalone course', async () => {
      const user = await seedUser('detail');
      const { course } = await seedStandaloneCourse('detail');
      const bearer = await signFor(app, user.id);
      await request(app.getHttpServer())
        .post(`/api/v1/enrollments/courses/${course.id}`)
        .set('Authorization', bearer);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/enrollments/me/courses/${course.id}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
      expect(res.body.data.courseId).toBe(course.id);
      expect(res.body.data.progress.percentComplete).toBe(0);
      expect(res.body.data.lastPosition).toBeNull();
    });

    it('returns 404 when the course exists but the user is not enrolled', async () => {
      const user = await seedUser('notenr');
      const { course } = await seedStandaloneCourse('notenr');
      const bearer = await signFor(app, user.id);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/enrollments/me/courses/${course.id}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(404);
    });

    it('returns 404 when the course does not exist (same response as non-enrolled)', async () => {
      const user = await seedUser('missing');
      const bearer = await signFor(app, user.id);
      const res = await request(app.getHttpServer())
        .get('/api/v1/enrollments/me/courses/00000000-0000-0000-0000-000000000099')
        .set('Authorization', bearer);
      expect(res.status).toBe(404);
    });
  });
});
