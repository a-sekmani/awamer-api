import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from '../tags/test-app';

const prisma: PrismaClient = testPrisma;

describe('Admin /api/v1/admin/.../testimonials', () => {
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

  const authed = (req: request.Test) =>
    req.set('Authorization', adminBearer);

  async function seedPath() {
    const cat = await prisma.category.create({
      data: { name: 'C', slug: 'mf-tst-cat' },
    });
    return prisma.path.create({
      data: { categoryId: cat.id, title: 'P', slug: 'mf-tst-p' },
    });
  }

  it('creates a testimonial with status PENDING even if caller tries to override', async () => {
    const path = await seedPath();
    // Extra `status` will be stripped by ValidationPipe(forbidNonWhitelisted);
    // server-side the service would force PENDING regardless.
    const res = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/testimonials`)
        .send({
          authorName: 'أحمد',
          content: 'شهادة عن التجربة',
          rating: 5,
        }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.authorName).toBe('أحمد');
    expect(typeof res.body.data.createdAt).toBe('string');
  });

  it('cycles status PENDING → APPROVED → HIDDEN → APPROVED', async () => {
    const path = await seedPath();
    const created = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/testimonials`)
        .send({ authorName: 'A', content: 'C' }),
    );
    const id = created.body.data.id as string;

    const approve = await authed(
      request(app.getHttpServer())
        .patch(`/api/v1/admin/testimonials/${id}/status`)
        .send({ status: 'APPROVED' }),
    );
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');

    const hide = await authed(
      request(app.getHttpServer())
        .patch(`/api/v1/admin/testimonials/${id}/status`)
        .send({ status: 'HIDDEN' }),
    );
    expect(hide.body.data.status).toBe('HIDDEN');

    const reapprove = await authed(
      request(app.getHttpServer())
        .patch(`/api/v1/admin/testimonials/${id}/status`)
        .send({ status: 'APPROVED' }),
    );
    expect(reapprove.body.data.status).toBe('APPROVED');
  });

  it('admin list returns testimonials in all statuses', async () => {
    const path = await seedPath();
    const a = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/testimonials`)
        .send({ authorName: 'A', content: 'C' }),
    );
    const b = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/testimonials`)
        .send({ authorName: 'B', content: 'C' }),
    );
    await authed(
      request(app.getHttpServer())
        .patch(`/api/v1/admin/testimonials/${a.body.data.id}/status`)
        .send({ status: 'APPROVED' }),
    );
    await authed(
      request(app.getHttpServer())
        .patch(`/api/v1/admin/testimonials/${b.body.data.id}/status`)
        .send({ status: 'HIDDEN' }),
    );

    const list = await authed(
      request(app.getHttpServer()).get(
        `/api/v1/admin/paths/${path.id}/testimonials`,
      ),
    );
    expect(list.status).toBe(200);
    const statuses = list.body.data.map((r: { status: string }) => r.status);
    expect(statuses).toEqual(expect.arrayContaining(['APPROVED', 'HIDDEN']));
  });

  it('rejects rating out of 1–5 range', async () => {
    const path = await seedPath();
    const res = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/testimonials`)
        .send({ authorName: 'A', content: 'C', rating: 6 }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects invalid avatar URL', async () => {
    const path = await seedPath();
    const res = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/testimonials`)
        .send({ authorName: 'A', content: 'C', avatarUrl: 'not-a-url' }),
    );
    expect(res.status).toBe(400);
  });

  it('reorders testimonials for a path', async () => {
    const path = await seedPath();
    const a = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/testimonials`)
        .send({ authorName: 'A', content: 'C' }),
    );
    const b = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/testimonials`)
        .send({ authorName: 'B', content: 'C' }),
    );
    const res = await authed(
      request(app.getHttpServer())
        .patch(`/api/v1/admin/paths/${path.id}/testimonials/reorder`)
        .send({ itemIds: [b.body.data.id, a.body.data.id] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(b.body.data.id);
  });

  it('rejects unauthenticated requests', async () => {
    const path = await seedPath();
    const res = await request(app.getHttpServer()).get(
      `/api/v1/admin/paths/${path.id}/testimonials`,
    );
    expect(res.status).toBe(401);
  });
});
