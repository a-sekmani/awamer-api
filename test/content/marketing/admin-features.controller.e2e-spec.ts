import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient, MarketingOwnerType } from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from '../tags/test-app';

const prisma: PrismaClient = testPrisma;

describe('Admin /api/v1/admin/.../features', () => {
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

  function authed(req: request.Test): request.Test {
    return req.set('Authorization', adminBearer);
  }

  async function seedPath() {
    const cat = await prisma.category.create({
      data: { name: 'Cat', slug: 'mf-cat' },
    });
    const path = await prisma.path.create({
      data: { categoryId: cat.id, title: 'P', slug: 'mf-p' },
    });
    return { cat, path };
  }

  async function seedCourse() {
    const cat = await prisma.category.create({
      data: { name: 'Cat', slug: 'mf-cat-c' },
    });
    const course = await prisma.course.create({
      data: { categoryId: cat.id, title: 'C', slug: 'mf-c' },
    });
    return { cat, course };
  }

  describe('full CRUD cycle against a path', () => {
    it('creates, lists, updates, reorders, deletes', async () => {
      const { path } = await seedPath();

      const c1 = await authed(
        request(app.getHttpServer())
          .post(`/api/v1/admin/paths/${path.id}/features`)
          .send({ icon: 'i1', title: 'ميزة أولى', description: 'وصف' }),
      );
      expect(c1.status).toBe(201);
      expect(c1.body.data.order).toBe(0);
      expect(c1.body.data.title).toBe('ميزة أولى');

      const c2 = await authed(
        request(app.getHttpServer())
          .post(`/api/v1/admin/paths/${path.id}/features`)
          .send({ icon: 'i2', title: 'ميزة ثانية', description: 'وصف 2' }),
      );
      expect(c2.body.data.order).toBe(1);

      const c3 = await authed(
        request(app.getHttpServer())
          .post(`/api/v1/admin/paths/${path.id}/features`)
          .send({ icon: 'i3', title: 'ميزة ثالثة', description: 'وصف 3' }),
      );
      expect(c3.body.data.order).toBe(2);

      const list = await authed(
        request(app.getHttpServer()).get(
          `/api/v1/admin/paths/${path.id}/features`,
        ),
      );
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(3);

      const patch = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/features/${c2.body.data.id}`)
          .send({ title: 'محدَّث' }),
      );
      expect(patch.status).toBe(200);
      expect(patch.body.data.title).toBe('محدَّث');

      const reorder = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/paths/${path.id}/features/reorder`)
          .send({
            itemIds: [c3.body.data.id, c1.body.data.id, c2.body.data.id],
          }),
      );
      expect(reorder.status).toBe(200);
      expect(reorder.body.data.map((r: { id: string }) => r.id)).toEqual([
        c3.body.data.id,
        c1.body.data.id,
        c2.body.data.id,
      ]);

      const del = await authed(
        request(app.getHttpServer()).delete(
          `/api/v1/admin/features/${c1.body.data.id}`,
        ),
      );
      expect(del.status).toBe(204);

      const after = await authed(
        request(app.getHttpServer()).get(
          `/api/v1/admin/paths/${path.id}/features`,
        ),
      );
      expect(after.body.data).toHaveLength(2);
    });
  });

  describe('full CRUD cycle against a course', () => {
    it('creates and lists', async () => {
      const { course } = await seedCourse();
      const c1 = await authed(
        request(app.getHttpServer())
          .post(`/api/v1/admin/courses/${course.id}/features`)
          .send({ icon: 'i', title: 'T', description: 'D' }),
      );
      expect(c1.status).toBe(201);
      expect(c1.body.data.ownerType).toBe(MarketingOwnerType.COURSE);

      const list = await authed(
        request(app.getHttpServer()).get(
          `/api/v1/admin/courses/${course.id}/features`,
        ),
      );
      expect(list.body.data).toHaveLength(1);
    });
  });

  describe('reorder error handling', () => {
    it('returns 400 when the list has a foreign id', async () => {
      const { path } = await seedPath();
      const c1 = await authed(
        request(app.getHttpServer())
          .post(`/api/v1/admin/paths/${path.id}/features`)
          .send({ icon: 'i', title: 'T', description: 'D' }),
      );
      const res = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/paths/${path.id}/features/reorder`)
          .send({
            itemIds: [
              c1.body.data.id,
              '00000000-0000-0000-0000-000000000099',
            ],
          }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when the list is missing an id', async () => {
      const { path } = await seedPath();
      await authed(
        request(app.getHttpServer())
          .post(`/api/v1/admin/paths/${path.id}/features`)
          .send({ icon: 'i', title: 'T', description: 'D' }),
      );
      const c2 = await authed(
        request(app.getHttpServer())
          .post(`/api/v1/admin/paths/${path.id}/features`)
          .send({ icon: 'i', title: 'T2', description: 'D' }),
      );
      const res = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/paths/${path.id}/features/reorder`)
          .send({ itemIds: [c2.body.data.id] }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('not-found handling', () => {
    it('returns 404 when the owner path does not exist', async () => {
      const res = await authed(
        request(app.getHttpServer())
          .post(
            '/api/v1/admin/paths/00000000-0000-0000-0000-000000000001/features',
          )
          .send({ icon: 'i', title: 'T', description: 'D' }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when the feature does not exist', async () => {
      const res = await authed(
        request(app.getHttpServer())
          .patch('/api/v1/admin/features/00000000-0000-0000-0000-000000000002')
          .send({ title: 'x' }),
      );
      expect(res.status).toBe(404);
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const { path } = await seedPath();
    const res = await request(app.getHttpServer()).get(
      `/api/v1/admin/paths/${path.id}/features`,
    );
    expect(res.status).toBe(401);
  });

  it('round-trips Arabic text byte-for-byte', async () => {
    const { path } = await seedPath();
    const arabic = 'ميزة تحتوي على أحرف عربية ومصطلحات تقنية';
    const post = await authed(
      request(app.getHttpServer())
        .post(`/api/v1/admin/paths/${path.id}/features`)
        .send({ icon: 'star', title: arabic, description: arabic }),
    );
    expect(post.status).toBe(201);
    expect(post.body.data.title).toBe(arabic);

    const get = await authed(
      request(app.getHttpServer()).get(
        `/api/v1/admin/paths/${path.id}/features`,
      ),
    );
    expect(get.body.data[0].title).toBe(arabic);
  });
});
