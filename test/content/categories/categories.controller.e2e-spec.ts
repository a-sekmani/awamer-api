import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  CategoryStatus,
  CourseStatus,
  PathStatus,
  PrismaClient,
} from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../src/common/cache/redis.provider';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from '../test-app';

const prisma: PrismaClient = testPrisma;

describe('GET /api/v1/categories (public)', () => {
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

  async function seedFixture() {
    const catA = await prisma.category.create({
      data: {
        name: 'AI',
        slug: 'cat-ai',
        order: 0,
        status: CategoryStatus.ACTIVE,
      },
    });
    const catB = await prisma.category.create({
      data: {
        name: 'DevOps',
        slug: 'cat-devops',
        order: 1,
        status: CategoryStatus.ACTIVE,
      },
    });
    const hidden = await prisma.category.create({
      data: {
        name: 'Hidden',
        slug: 'cat-hidden',
        order: 2,
        status: CategoryStatus.HIDDEN,
      },
    });
    // 3 published paths in catA, 2 in catB.
    for (let i = 0; i < 3; i++) {
      await prisma.path.create({
        data: {
          categoryId: catA.id,
          title: `A path ${i}`,
          slug: `cat-a-path-${i}`,
          status: PathStatus.PUBLISHED,
        },
      });
    }
    for (let i = 0; i < 2; i++) {
      await prisma.path.create({
        data: {
          categoryId: catB.id,
          title: `B path ${i}`,
          slug: `cat-b-path-${i}`,
          status: PathStatus.PUBLISHED,
        },
      });
    }
    // 1 draft path in catA — must NOT count.
    await prisma.path.create({
      data: {
        categoryId: catA.id,
        title: 'Draft',
        slug: 'cat-a-draft',
        status: PathStatus.DRAFT,
      },
    });
    // 2 standalone published courses in catA.
    for (let i = 0; i < 2; i++) {
      await prisma.course.create({
        data: {
          categoryId: catA.id,
          title: `A course ${i}`,
          slug: `cat-a-course-${i}`,
          status: CourseStatus.PUBLISHED,
        },
      });
    }
    return { catA, catB, hidden };
  }

  it('returns ACTIVE categories ordered by order asc, with correct counts', async () => {
    await seedFixture();
    const res = await request(app.getHttpServer()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    const items = res.body.data as Array<{
      slug: string;
      pathCount: number;
      courseCount: number;
    }>;
    expect(items.map((i) => i.slug)).toEqual(['cat-ai', 'cat-devops']);
    expect(items[0]).toMatchObject({
      slug: 'cat-ai',
      pathCount: 3,
      courseCount: 2,
    });
    expect(items[1]).toMatchObject({
      slug: 'cat-devops',
      pathCount: 2,
      courseCount: 0,
    });
  });

  it('hidden categories are excluded; draft paths are not counted', async () => {
    await seedFixture();
    const res = await request(app.getHttpServer()).get('/api/v1/categories');
    const slugs = (res.body.data as Array<{ slug: string }>).map((i) => i.slug);
    expect(slugs).not.toContain('cat-hidden');
    const ai = (res.body.data as Array<any>).find((c) => c.slug === 'cat-ai');
    expect(ai.pathCount).toBe(3); // draft excluded
  });

  it('public access — no Authorization header required', async () => {
    await seedFixture();
    const res = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .unset('Authorization');
    expect(res.status).toBe(200);
  });

  it('second call is served from cache (Redis key present)', async () => {
    await seedFixture();
    await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
    const keys = await redis.keys('categories:all');
    expect(keys).toContain('categories:all');
    // Second call should still succeed and return the same payload.
    const second = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .expect(200);
    expect(second.body.data).toBeDefined();
  });

  it('empty database → returns []', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
