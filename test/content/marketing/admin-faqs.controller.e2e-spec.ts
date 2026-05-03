import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from '../tags/test-app';

const prisma: PrismaClient = testPrisma;

describe('Admin /api/v1/admin/.../faqs', () => {
  let app: INestApplication;
  let adminBearer: string;

  beforeAll(async () => {
    ({ app, adminBearer } = await createTestApp());
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const authed = (req: request.Test) => req.set('Authorization', adminBearer);

  async function seedPath() {
    const cat = await prisma.category.create({
      data: { name: 'C', slug: 'mf-faq-cat' },
    });
    return prisma.path.create({
      data: { categoryId: cat.id, title: 'P', slug: 'mf-faq-p' },
    });
  }

  async function seedCourse() {
    const cat = await prisma.category.create({
      data: { name: 'C', slug: 'mf-faq-cat-c' },
    });
    return prisma.course.create({
      data: { categoryId: cat.id, title: 'C', slug: 'mf-faq-c' },
    });
  }

  it('creates, lists, updates, reorders, deletes against a path', async () => {
    const path = await seedPath();

    const a = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/faqs`)
        .send({ question: 'س١', answer: 'ج١' }),
    );
    const b = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/faqs`)
        .send({ question: 'س٢', answer: 'ج٢' }),
    );
    expect(a.body.data.order).toBe(0);
    expect(b.body.data.order).toBe(1);

    const patch = await authed(
      request(app.getHttpServer())
        .patch(`/api/v1/admin/faqs/${a.body.data.id}`)
        .send({ answer: 'جواب محدَّث' }),
    );
    expect(patch.status).toBe(200);
    expect(patch.body.data.answer).toBe('جواب محدَّث');

    const reorder = await authed(
      request(app.getHttpServer())
        .patch(`/api/v1/admin/paths/${path.id}/faqs/reorder`)
        .send({ itemIds: [b.body.data.id, a.body.data.id] }),
    );
    expect(reorder.status).toBe(200);
    expect(reorder.body.data.map((r: { id: string }) => r.id)).toEqual([
      b.body.data.id,
      a.body.data.id,
    ]);

    const del = await authed(
      request(app.getHttpServer()).delete(
        `/api/v1/admin/faqs/${a.body.data.id}`,
      ),
    );
    expect(del.status).toBe(204);

    const list = await authed(
      request(app.getHttpServer()).get(`/api/v1/admin/paths/${path.id}/faqs`),
    );
    expect(list.body.data).toHaveLength(1);
  });

  it('creates an faq under a course', async () => {
    const course = await seedCourse();
    const res = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/courses/${course.id}/faqs`)
        .send({ question: 'Q', answer: 'A' }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.ownerType).toBe('COURSE');
  });

  it('returns 404 on missing owner', async () => {
    const res = await authed(
      request(app.getHttpServer()).get(
        '/api/v1/admin/paths/00000000-0000-0000-0000-000000000001/faqs',
      ),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 on missing faq update', async () => {
    const res = await authed(
      request(app.getHttpServer())
        .patch('/api/v1/admin/faqs/00000000-0000-0000-0000-000000000002')
        .send({ answer: 'x' }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects whitespace-only question', async () => {
    const path = await seedPath();
    const res = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/faqs`)
        .send({ question: '   ', answer: 'A' }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const path = await seedPath();
    const res = await request(app.getHttpServer()).get(
      `/api/v1/admin/paths/${path.id}/faqs`,
    );
    expect(res.status).toBe(401);
  });
});
