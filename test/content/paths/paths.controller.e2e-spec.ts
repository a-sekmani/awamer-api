import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  CategoryStatus,
  CourseStatus,
  LessonType,
  PathStatus,
  PrismaClient,
  TagStatus,
  TestimonialStatus,
} from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../src/common/cache/redis.provider';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from '../test-app';

const prisma: PrismaClient = testPrisma;

describe('Paths public discovery (e2e)', () => {
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

  // ============================================================
  // Helpers
  // ============================================================

  async function seedListFixture() {
    const cat = await prisma.category.create({
      data: {
        name: 'AI',
        slug: 'p-list-cat-ai',
        status: CategoryStatus.ACTIVE,
      },
    });
    const tag = await prisma.tag.create({
      data: { name: 'Python', slug: 'p-list-py', status: TagStatus.ACTIVE },
    });
    // 3 published paths; one with the tag and a 'cyber' subtitle.
    const p1 = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'AI Fundamentals',
        slug: 'p-list-1',
        subtitle: 'Cyber security included',
        level: 'beginner',
        status: PathStatus.PUBLISHED,
        order: 0,
      },
    });
    await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'Advanced ML',
        slug: 'p-list-2',
        subtitle: 'Deep learning',
        level: 'advanced',
        status: PathStatus.PUBLISHED,
        order: 1,
      },
    });
    await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'Draft Path',
        slug: 'p-list-3',
        status: PathStatus.DRAFT,
      },
    });
    await prisma.pathTag.create({ data: { pathId: p1.id, tagId: tag.id } });
    return { cat, tag, p1 };
  }

  async function seedDeterministicFixture() {
    const cat = await prisma.category.create({
      data: { name: 'C', slug: 'p-det-cat', status: CategoryStatus.ACTIVE },
    });
    // 5 paths sharing order=0 (FR-030a determinism test).
    for (let i = 0; i < 5; i++) {
      await prisma.path.create({
        data: {
          categoryId: cat.id,
          title: `Tied Path ${i}`,
          slug: `p-det-${i}`,
          order: 0,
          status: PathStatus.PUBLISHED,
        },
      });
    }
  }

  async function seedDetailFixture(opts: { isFree?: boolean } = {}) {
    const cat = await prisma.category.create({
      data: { name: 'X', slug: 'p-det-cat-2', status: CategoryStatus.ACTIVE },
    });
    const path = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'Full Path',
        slug: 'full-path',
        subtitle: 'sub',
        description: 'desc',
        level: 'beginner',
        thumbnail: 'thumb.png',
        skills: ['python', 'math'],
        status: PathStatus.PUBLISHED,
        isFree: opts.isFree ?? false,
        promoVideoUrl: 'https://x/v.mp4',
        promoVideoThumbnail: 'thumb.jpg',
      },
    });
    const course = await prisma.course.create({
      data: {
        categoryId: cat.id,
        pathId: path.id,
        title: 'C1',
        slug: 'full-path-c1',
        status: CourseStatus.PUBLISHED,
        order: 0,
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
        estimatedMinutes: 10,
        isFree: false,
      },
    });
    // marketing: feature, faq, approved testimonial.
    await prisma.feature.create({
      data: {
        ownerType: 'PATH',
        ownerId: path.id,
        icon: 'star',
        title: 'F1',
        description: 'feature one',
        order: 0,
      },
    });
    await prisma.faq.create({
      data: {
        ownerType: 'PATH',
        ownerId: path.id,
        question: 'Q1?',
        answer: 'A1',
        order: 0,
      },
    });
    await prisma.testimonial.create({
      data: {
        ownerType: 'PATH',
        ownerId: path.id,
        authorName: 'Ahmad',
        content: 'great',
        status: TestimonialStatus.APPROVED,
        order: 0,
      },
    });
    return { path, course, section };
  }

  // ============================================================
  // GET /api/v1/paths (list)
  // ============================================================

  // The global ResponseTransformInterceptor wraps every response in
  // { data, message }, so paginated payloads end up as
  // { data: { data: [...], meta: {...} }, message }. unwrap() shortens the
  // assertion path. Mirrors the pattern used in test/onboarding.e2e-spec.ts.
  const unwrap = (res: request.Response) => res.body.data;

  describe('GET /api/v1/paths (list)', () => {
    it('returns published paths only with pagination meta', async () => {
      await seedListFixture();
      const res = await request(app.getHttpServer()).get('/api/v1/paths');
      expect(res.status).toBe(200);
      expect(unwrap(res).data).toHaveLength(2);
      expect(unwrap(res).meta).toEqual({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('FR-016: empty result → data:[], totalPages:0', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths?categoryId=00000000-0000-4000-8000-000000000099',
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

    it('?categoryId filter restricts to that category', async () => {
      const { cat } = await seedListFixture();
      const res = await request(app.getHttpServer()).get(
        `/api/v1/paths?categoryId=${cat.id}`,
      );
      expect(res.status).toBe(200);
      expect(unwrap(res).data).toHaveLength(2);
    });

    it('?tagId filter restricts to paths with that tag', async () => {
      const { tag } = await seedListFixture();
      const res = await request(app.getHttpServer()).get(
        `/api/v1/paths?tagId=${tag.id}`,
      );
      expect(res.status).toBe(200);
      expect(unwrap(res).data).toHaveLength(1);
      expect(unwrap(res).data[0].slug).toBe('p-list-1');
    });

    it('?level=beginner filter restricts by level', async () => {
      await seedListFixture();
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths?level=beginner',
      );
      expect(res.status).toBe(200);
      expect(unwrap(res).data.every((p: any) => p.level === 'beginner')).toBe(
        true,
      );
    });

    it('?search matches subtitle case-insensitively', async () => {
      await seedListFixture();
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths?search=cyber',
      );
      expect(res.status).toBe(200);
      const slugs = unwrap(res).data.map((p: any) => p.slug);
      expect(slugs).toContain('p-list-1');
    });

    it('400 on invalid UUID', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths?categoryId=not-a-uuid',
      );
      expect(res.status).toBe(400);
    });

    it('400 on invalid level enum', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths?level=expert',
      );
      expect(res.status).toBe(400);
    });

    it('public access — no Authorization required', async () => {
      await seedListFixture();
      const res = await request(app.getHttpServer())
        .get('/api/v1/paths')
        .unset('Authorization');
      expect(res.status).toBe(200);
    });

    it('FR-030a — pagination is deterministic across pages with tied order', async () => {
      await seedDeterministicFixture();
      const p1 = await request(app.getHttpServer()).get(
        '/api/v1/paths?page=1&limit=2',
      );
      const p2 = await request(app.getHttpServer()).get(
        '/api/v1/paths?page=2&limit=2',
      );
      const p3 = await request(app.getHttpServer()).get(
        '/api/v1/paths?page=3&limit=2',
      );
      const ids1 = unwrap(p1).data.map((p: any) => p.id);
      const ids2 = unwrap(p2).data.map((p: any) => p.id);
      const ids3 = unwrap(p3).data.map((p: any) => p.id);
      // No overlap.
      expect(ids1.filter((i: string) => ids2.includes(i))).toEqual([]);
      // All 5 covered.
      expect(new Set([...ids1, ...ids2, ...ids3]).size).toBe(5);
      // Re-request page 1 → identical ordering.
      const p1again = await request(app.getHttpServer()).get(
        '/api/v1/paths?page=1&limit=2',
      );
      expect(unwrap(p1again).data.map((p: any) => p.id)).toEqual(ids1);
    });

    it('second call within cache window returns same data (cache hit)', async () => {
      await seedListFixture();
      const first = await request(app.getHttpServer()).get('/api/v1/paths');
      const second = await request(app.getHttpServer()).get('/api/v1/paths');
      expect(second.body).toEqual(first.body);
      const keys = await redis.keys('paths:list:*');
      expect(keys.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // GET /api/v1/paths/:slug (detail)
  // ============================================================

  describe('GET /api/v1/paths/:slug (detail)', () => {
    it('returns the full SSR payload', async () => {
      await seedDetailFixture();
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths/full-path',
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        path: {
          slug: 'full-path',
          level: 'beginner',
          skills: ['python', 'math'],
          promoVideo: { url: 'https://x/v.mp4', thumbnail: 'thumb.jpg' },
          certificate: {
            enabled: true,
            requiresAwamerPlus: true,
          },
        },
        curriculum: expect.any(Array),
        features: expect.any(Array),
        faqs: expect.any(Array),
        testimonials: expect.any(Array),
      });
      expect(res.body.data.curriculum).toHaveLength(1);
      expect(res.body.data.features).toHaveLength(1);
      expect(res.body.data.faqs).toHaveLength(1);
      expect(res.body.data.testimonials).toHaveLength(1);
    });

    it('isFree=true → all nested lessons isFree=true and certificate.requiresAwamerPlus=false', async () => {
      await seedDetailFixture({ isFree: true });
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths/full-path',
      );
      expect(res.status).toBe(200);
      const allFree = res.body.data.curriculum.every((c: any) =>
        c.sections.every((s: any) => s.lessons.every((l: any) => l.isFree)),
      );
      expect(allFree).toBe(true);
      expect(res.body.data.path.certificate.requiresAwamerPlus).toBe(false);
    });

    it('404 on unknown slug', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths/nothing-here',
      );
      expect(res.status).toBe(404);
    });

    it('404 on draft slug (status != PUBLISHED)', async () => {
      const cat = await prisma.category.create({
        data: { name: 'D', slug: 'p-draft-cat' },
      });
      await prisma.path.create({
        data: {
          categoryId: cat.id,
          title: 'D',
          slug: 'p-draft-slug',
          status: PathStatus.DRAFT,
        },
      });
      const res = await request(app.getHttpServer()).get(
        '/api/v1/paths/p-draft-slug',
      );
      expect(res.status).toBe(404);
    });

    it('public access — no Authorization required', async () => {
      await seedDetailFixture();
      const res = await request(app.getHttpServer())
        .get('/api/v1/paths/full-path')
        .unset('Authorization');
      expect(res.status).toBe(200);
    });

    it('second call from cache (Redis key present)', async () => {
      await seedDetailFixture();
      await request(app.getHttpServer()).get('/api/v1/paths/full-path');
      const keys = await redis.keys('paths:detail:*');
      expect(keys).toContain('paths:detail:full-path');
    });
  });
});
