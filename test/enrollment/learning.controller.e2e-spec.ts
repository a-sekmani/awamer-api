import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import {
  CourseEnrollmentStatus,
  EnrollmentStatus,
  PrismaClient,
} from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../schema/setup';
import { createTestApp } from '../content/tags/test-app';

const prisma: PrismaClient = testPrisma;

async function signFor(app: INestApplication, userId: string): Promise<string> {
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
      email: `learn-${suffix}@awamer.test`,
      passwordHash: 'hash',
    },
  });
}

async function seedStandaloneLesson(suffix: string) {
  const cat = await prisma.category.create({
    data: { name: 'C', slug: `learn-cat-${suffix}` },
  });
  const course = await prisma.course.create({
    data: {
      categoryId: cat.id,
      pathId: null,
      title: 'Standalone',
      slug: `learn-c-${suffix}`,
      sections: {
        create: [
          {
            title: 'S1',
            order: 0,
            lessons: {
              create: [{ title: 'L1', order: 0, type: 'TEXT' as const }],
            },
          },
        ],
      },
    },
    include: { sections: { include: { lessons: true } } },
  });
  const lesson = course.sections[0].lessons[0];
  return { course, lesson };
}

async function seedPathLesson(suffix: string) {
  const cat = await prisma.category.create({
    data: { name: 'C', slug: `learn-pcat-${suffix}` },
  });
  const path = await prisma.path.create({
    data: {
      categoryId: cat.id,
      title: 'Path',
      slug: `learn-p-${suffix}`,
    },
  });
  const course = await prisma.course.create({
    data: {
      categoryId: cat.id,
      pathId: path.id,
      title: 'Path Course',
      slug: `learn-pc-${suffix}`,
      sections: {
        create: [
          {
            title: 'S1',
            order: 0,
            lessons: {
              create: [{ title: 'L1', order: 0, type: 'TEXT' as const }],
            },
          },
        ],
      },
    },
    include: { sections: { include: { lessons: true } } },
  });
  const lesson = course.sections[0].lessons[0];
  return { path, course, lesson };
}

describe('LearningController guard chain (e2e) — US8 + US9', () => {
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

  it('returns 401 when unauthenticated', async () => {
    const { lesson } = await seedStandaloneLesson('unauth');
    const res = await request(app.getHttpServer()).post(
      `/api/v1/learning/lessons/${lesson.id}/complete`,
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated but not enrolled', async () => {
    const user = await seedUser('nope');
    const { lesson } = await seedStandaloneLesson('nope');
    const bearer = await signFor(app, user.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lesson.id}/complete`)
      .set('Authorization', bearer);
    expect(res.status).toBe(403);
  });

  it('returns 200 when authenticated AND has an ACTIVE CourseEnrollment', async () => {
    const user = await seedUser('ok');
    const { course, lesson } = await seedStandaloneLesson('ok');
    await prisma.courseEnrollment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        status: CourseEnrollmentStatus.ACTIVE,
      },
    });
    const bearer = await signFor(app, user.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lesson.id}/complete`)
      .set('Authorization', bearer);
    expect(res.status).toBe(200);
    expect(res.body.data.lessonProgress.lessonId).toBe(lesson.id);
  });

  it('returns 200 when authenticated AND has an ACTIVE PathEnrollment for the parent path', async () => {
    const user = await seedUser('patho');
    const { path, lesson } = await seedPathLesson('patho');
    await prisma.pathEnrollment.create({
      data: {
        userId: user.id,
        pathId: path.id,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    const bearer = await signFor(app, user.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lesson.id}/complete`)
      .set('Authorization', bearer);
    expect(res.status).toBe(200);
  });

  it('returns 403 when the CourseEnrollment status is DROPPED', async () => {
    const user = await seedUser('drop');
    const { course, lesson } = await seedStandaloneLesson('drop');
    await prisma.courseEnrollment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        status: CourseEnrollmentStatus.DROPPED,
      },
    });
    const bearer = await signFor(app, user.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lesson.id}/complete`)
      .set('Authorization', bearer);
    expect(res.status).toBe(403);
  });

  it('returns 403 when the CourseEnrollment status is COMPLETED', async () => {
    const user = await seedUser('donec');
    const { course, lesson } = await seedStandaloneLesson('donec');
    await prisma.courseEnrollment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        status: CourseEnrollmentStatus.COMPLETED,
      },
    });
    const bearer = await signFor(app, user.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lesson.id}/complete`)
      .set('Authorization', bearer);
    expect(res.status).toBe(403);
  });

  it('returns 403 when the PathEnrollment status is PAUSED', async () => {
    const user = await seedUser('pause');
    const { path, lesson } = await seedPathLesson('pause');
    await prisma.pathEnrollment.create({
      data: {
        userId: user.id,
        pathId: path.id,
        status: EnrollmentStatus.PAUSED,
      },
    });
    const bearer = await signFor(app, user.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lesson.id}/complete`)
      .set('Authorization', bearer);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a standalone-course lesson when the learner only holds an unrelated path enrollment', async () => {
    const user = await seedUser('cross');
    const { lesson } = await seedStandaloneLesson('cross');
    const { path } = await seedPathLesson('cross2');
    await prisma.pathEnrollment.create({
      data: {
        userId: user.id,
        pathId: path.id,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    const bearer = await signFor(app, user.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lesson.id}/complete`)
      .set('Authorization', bearer);
    expect(res.status).toBe(403);
  });
});
