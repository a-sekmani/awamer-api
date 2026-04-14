import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  CourseStatus,
  PathStatus,
  PrismaClient,
  TagStatus,
} from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from './test-app';

const prisma: PrismaClient = testPrisma;

async function seedBaseCategory() {
  return prisma.category.create({
    data: { name: 'C', slug: 'e2e-public-cat' },
  });
}

describe('GET /api/v1/tags (public)', () => {
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

  it('returns only ACTIVE tags sorted alphabetically', async () => {
    const cat = await seedBaseCategory();
    await prisma.tag.createMany({
      data: [
        { id: 'ta', name: 'Beta', slug: 'beta', status: TagStatus.ACTIVE },
        { id: 'tb', name: 'Alpha', slug: 'alpha', status: TagStatus.ACTIVE },
        { id: 'tc', name: 'Charlie', slug: 'charlie', status: TagStatus.ACTIVE },
        { id: 'th', name: 'Hidden', slug: 'hidden', status: TagStatus.HIDDEN },
      ],
    });
    // Associate the hidden tag to a published path so we can assert it's not
    // returned even though it has a live association.
    const p = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'P',
        slug: 'e2e-p',
        status: PathStatus.PUBLISHED,
      },
    });
    await prisma.pathTag.create({ data: { pathId: p.id, tagId: 'th' } });

    const res = await request(app.getHttpServer()).get('/api/v1/tags');
    expect(res.status).toBe(200);
    const items = res.body.data as Array<{ slug: string }>;
    expect(items.map((i) => i.slug)).toEqual(['alpha', 'beta', 'charlie']);
  });

  it('returns correct pathCount and courseCount based on seeded associations', async () => {
    const cat = await seedBaseCategory();
    const tag = await prisma.tag.create({
      data: { name: 'ML', slug: 'ml-count', status: TagStatus.ACTIVE },
    });
    const p1 = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'P1',
        slug: 'e2e-c-p1',
        status: PathStatus.PUBLISHED,
      },
    });
    const p2 = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'P2',
        slug: 'e2e-c-p2',
        status: PathStatus.PUBLISHED,
      },
    });
    const pDraft = await prisma.path.create({
      data: {
        categoryId: cat.id,
        title: 'P3',
        slug: 'e2e-c-p3',
        status: PathStatus.DRAFT,
      },
    });
    const c1 = await prisma.course.create({
      data: {
        categoryId: cat.id,
        slug: 'e2e-c-c1',
        title: 'C1',
        status: CourseStatus.PUBLISHED,
      },
    });
    await prisma.course.create({
      data: {
        categoryId: cat.id,
        slug: 'e2e-c-c2',
        title: 'C2',
        status: CourseStatus.DRAFT,
      },
    });

    await prisma.pathTag.create({ data: { pathId: p1.id, tagId: tag.id } });
    await prisma.pathTag.create({ data: { pathId: p2.id, tagId: tag.id } });
    await prisma.pathTag.create({ data: { pathId: pDraft.id, tagId: tag.id } }); // excluded (draft)
    await prisma.courseTag.create({ data: { courseId: c1.id, tagId: tag.id } });

    const res = await request(app.getHttpServer()).get('/api/v1/tags');
    expect(res.status).toBe(200);
    const row = (res.body.data as Array<{ id: string; pathCount: number; courseCount: number }>)
      .find((r) => r.id === tag.id);
    expect(row?.pathCount).toBe(2);
    expect(row?.courseCount).toBe(1);
  });

  it('does not require authentication', async () => {
    // No auth header — truncate then hit endpoint
    const res = await request(app.getHttpServer()).get('/api/v1/tags');
    expect(res.status).toBe(200);
  });

  it('sets Cache-Control: public, max-age=60', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/tags');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('returns an empty data array when no active tags exist', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/tags');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('round-trips Arabic tag names byte-identically', async () => {
    const name = 'ذكاء صناعي';
    await prisma.tag.create({
      data: { name, slug: 'ai-arabic', status: TagStatus.ACTIVE },
    });
    const res = await request(app.getHttpServer()).get('/api/v1/tags');
    const found = (res.body.data as Array<{ name: string }>).find(
      (r) => r.name === name,
    );
    expect(found).toBeDefined();
    expect(found!.name).toBe(name);
  });
});
