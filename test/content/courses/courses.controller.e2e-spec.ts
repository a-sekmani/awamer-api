import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  CategoryStatus,
  CourseLevel,
  CourseStatus,
  LessonType,
  PathStatus,
  PrismaClient,
  TestimonialStatus,
} from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../src/common/cache/redis.provider';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from '../test-app';

const prisma: PrismaClient = testPrisma;

describe('Courses public discovery (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await truncateAll();
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function seedListFixture() {
    const cat = await prisma.category.create({
      data: { name: 'D', slug: 'c-list-cat', status: CategoryStatus.ACTIVE },
    });
    const path = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'P',
        slug: 'c-list-path',
        status: PathStatus.PUBLISHED,
      },
    });
    // 1 attached published course
    const attached = await prisma.course.create({
      data: {
        categoryId: cat.id,
        pathId: path.id,
        title: 'Attached',
        slug: 'c-list-attached',
        status: CourseStatus.PUBLISHED,
        level: CourseLevel.BEGINNER,
        order: 0,
      },
    });
    // 2 standalone published courses
    const standalone1 = await prisma.course.create({
      data: {
        categoryId: cat.id,
        title: 'Standalone 1',
        slug: 'c-list-stand-1',
        status: CourseStatus.PUBLISHED,
        order: 1,
      },
    });
    await prisma.course.create({
      data: {
        categoryId: cat.id,
        title: 'Standalone 2',
        slug: 'c-list-stand-2',
        status: CourseStatus.PUBLISHED,
        order: 2,
      },
    });
    // 1 draft (excluded)
    await prisma.course.create({
      data: {
        categoryId: cat.id,
        title: 'Draft',
        slug: 'c-list-draft',
        status: CourseStatus.DRAFT,
      },
    });
    return { cat, path, attached, standalone1 };
  }

  async function seedDeterministicFixture() {
    const cat = await prisma.category.create({
      data: { name: 'C', slug: 'c-det-cat', status: CategoryStatus.ACTIVE },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.course.create({
        data: {
          categoryId: cat.id,
          title: `Tied ${i}`,
          slug: `c-det-${i}`,
          order: 0,
          status: CourseStatus.PUBLISHED,
        },
      });
    }
  }

  async function seedDetailFixture(
    opts: { isFree?: boolean; standalone?: boolean } = {},
  ) {
    const cat = await prisma.category.create({
      data: { name: 'X', slug: 'c-det-cat-2', status: CategoryStatus.ACTIVE },
    });
    let pathId: string | null = null;
    if (opts.standalone === false) {
      const p = await prisma.path.create({
        data: {
          categoryId: cat.id,
          title: 'Parent',
          slug: 'c-detail-parent',
          status: PathStatus.PUBLISHED,
        },
      });
      pathId = p.id;
    }
    const course = await prisma.course.create({
      data: {
        categoryId: cat.id,
        pathId,
        title: 'Full Course',
        slug: 'full-course',
        status: CourseStatus.PUBLISHED,
        level: CourseLevel.BEGINNER,
        isFree: opts.isFree ?? false,
        skills: ['git'],
      },
    });
    const section = await prisma.section.create({
      data: { courseId: course.id, title: 'S1', order: 0 },
    });
    await prisma.lesson.create({
      data: {
        sectionId: section.id,
        title: 'L1',
        type: LessonType.VIDEO,
        order: 0,
        estimatedMinutes: 8,
        isFree: false,
      },
    });
    await prisma.feature.create({
      data: {
        ownerType: 'COURSE',
        ownerId: course.id,
        icon: 'i',
        title: 'F1',
        description: 'd',
        order: 0,
      },
    });
    await prisma.faq.create({
      data: {
        ownerType: 'COURSE',
        ownerId: course.id,
        question: 'Q?',
        answer: 'A',
        order: 0,
      },
    });
    await prisma.testimonial.create({
      data: {
        ownerType: 'COURSE',
        ownerId: course.id,
        authorName: 'A',
        content: 'great',
        status: TestimonialStatus.APPROVED,
        order: 0,
      },
    });
    return { course };
  }

  // ============================================================
  // GET /api/v1/courses
  // ============================================================

  // unwrap() shortens the assertion path for paginated payloads. The global
  // ResponseTransformInterceptor double-wraps {data, meta} → {data: {data, meta}, message}.
  const unwrap = (res: request.Response) => res.body.data;

  describe('GET /api/v1/courses (list)', () => {
    it('returns published courses with pagination meta', async () => {
      await seedListFixture();
      const res = await request(app.getHttpServer()).get('/api/v1/courses');
      expect(res.status).toBe(200);
      expect(unwrap(res).data).toHaveLength(3);
      expect(unwrap(res).meta.total).toBe(3);
    });

    it('FR-016: zero results → exact empty meta', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/courses?categoryId=00000000-0000-4000-8000-000000000099',
      );
      expect(res.status).toBe(200);
      expect(unwrap(res).data).toEqual([]);
      expect(unwrap(res).meta).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it('?pathId restricts to courses in that path', async () => {
      const { path } = await seedListFixture();
      const res = await request(app.getHttpServer()).get(
        `/api/v1/courses?pathId=${path.id}`,
      );
      expect(res.status).toBe(200);
      expect(unwrap(res).data).toHaveLength(1);
      expect(unwrap(res).data[0].slug).toBe('c-list-attached');
    });

    it('?standalone=true returns only courses with pathId IS NULL', async () => {
      await seedListFixture();
      const res = await request(app.getHttpServer()).get(
        '/api/v1/courses?standalone=true',
      );
      expect(res.status).toBe(200);
      expect(unwrap(res).data).toHaveLength(2);
      expect(unwrap(res).data.every((c: any) => c.path === null)).toBe(true);
    });

    it('FR-013: ?pathId + ?standalone=true → 400', async () => {
      const { path } = await seedListFixture();
      const res = await request(app.getHttpServer()).get(
        `/api/v1/courses?pathId=${path.id}&standalone=true`,
      );
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cannot supply both');
    });

    it('public access — no Authorization required', async () => {
      await seedListFixture();
      const res = await request(app.getHttpServer())
        .get('/api/v1/courses')
        .unset('Authorization');
      expect(res.status).toBe(200);
    });

    it('FR-030a — pagination determinism with tied order', async () => {
      await seedDeterministicFixture();
      const p1 = await request(app.getHttpServer()).get(
        '/api/v1/courses?page=1&limit=2',
      );
      const p2 = await request(app.getHttpServer()).get(
        '/api/v1/courses?page=2&limit=2',
      );
      const p3 = await request(app.getHttpServer()).get(
        '/api/v1/courses?page=3&limit=2',
      );
      const ids1 = unwrap(p1).data.map((c: any) => c.id);
      const ids2 = unwrap(p2).data.map((c: any) => c.id);
      const ids3 = unwrap(p3).data.map((c: any) => c.id);
      expect(ids1.filter((i: string) => ids2.includes(i))).toEqual([]);
      expect(new Set([...ids1, ...ids2, ...ids3]).size).toBe(5);
      const p1again = await request(app.getHttpServer()).get(
        '/api/v1/courses?page=1&limit=2',
      );
      expect(unwrap(p1again).data.map((c: any) => c.id)).toEqual(ids1);
    });

    it('second call returns same data and creates Redis key', async () => {
      await seedListFixture();
      await request(app.getHttpServer()).get('/api/v1/courses');
      const keys = await redis.keys('courses:list:*');
      expect(keys.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // GET /api/v1/courses/:slug (detail)
  // ============================================================

  describe('GET /api/v1/courses/:slug (detail)', () => {
    it('returns full payload with parentPath=null for standalone', async () => {
      await seedDetailFixture({ standalone: true });
      const res = await request(app.getHttpServer()).get(
        '/api/v1/courses/full-course',
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        course: {
          slug: 'full-course',
          level: 'beginner',
          parentPath: null,
          certificate: { enabled: true, requiresAwamerPlus: true },
        },
      });
      expect(res.body.data.curriculum).toHaveLength(1);
      expect(res.body.data.features).toHaveLength(1);
    });

    it('parentPath populated for path-attached course', async () => {
      await seedDetailFixture({ standalone: false });
      const res = await request(app.getHttpServer()).get(
        '/api/v1/courses/full-course',
      );
      expect(res.status).toBe(200);
      expect(res.body.data.course.parentPath).toMatchObject({
        slug: 'c-detail-parent',
        title: 'Parent',
      });
    });

    it('isFree=true → all lessons isFree=true and certificate.requiresAwamerPlus=false', async () => {
      await seedDetailFixture({ isFree: true });
      const res = await request(app.getHttpServer()).get(
        '/api/v1/courses/full-course',
      );
      expect(res.status).toBe(200);
      expect(
        res.body.data.curriculum.every((s: any) =>
          s.lessons.every((l: any) => l.isFree),
        ),
      ).toBe(true);
      expect(res.body.data.course.certificate.requiresAwamerPlus).toBe(false);
    });

    it('404 on unknown slug', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/courses/nothing-here',
      );
      expect(res.status).toBe(404);
    });

    it('404 on draft slug', async () => {
      const cat = await prisma.category.create({
        data: { name: 'D', slug: 'c-draft-cat' },
      });
      await prisma.course.create({
        data: {
          categoryId: cat.id,
          title: 'D',
          slug: 'c-draft-slug',
          status: CourseStatus.DRAFT,
        },
      });
      const res = await request(app.getHttpServer()).get(
        '/api/v1/courses/c-draft-slug',
      );
      expect(res.status).toBe(404);
    });

    it('public access — no Authorization required', async () => {
      await seedDetailFixture();
      const res = await request(app.getHttpServer())
        .get('/api/v1/courses/full-course')
        .unset('Authorization');
      expect(res.status).toBe(200);
    });

    it('second call cached (Redis key present)', async () => {
      await seedDetailFixture();
      await request(app.getHttpServer()).get('/api/v1/courses/full-course');
      const keys = await redis.keys('courses:detail:*');
      expect(keys).toContain('courses:detail:full-course');
    });
  });
});
