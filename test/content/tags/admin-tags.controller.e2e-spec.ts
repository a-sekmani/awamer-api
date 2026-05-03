import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient, TagStatus } from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from './test-app';

const prisma: PrismaClient = testPrisma;

describe('Admin /api/v1/admin/tags', () => {
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

  describe('GET /api/v1/admin/tags', () => {
    it('returns all tags including hidden, sorted alphabetically', async () => {
      await prisma.tag.createMany({
        data: [
          { name: 'Beta', slug: 'beta', status: TagStatus.ACTIVE },
          { name: 'Alpha', slug: 'alpha', status: TagStatus.HIDDEN },
          { name: 'Charlie', slug: 'charlie', status: TagStatus.ACTIVE },
        ],
      });
      const res = await authed(
        request(app.getHttpServer()).get('/api/v1/admin/tags'),
      );
      expect(res.status).toBe(200);
      const slugs = (
        res.body.data as Array<{ slug: string; status: string }>
      ).map((r) => r.slug);
      expect(slugs).toEqual(['alpha', 'beta', 'charlie']);
      const alpha = (
        res.body.data as Array<{
          slug: string;
          status: string;
          createdAt: string;
        }>
      ).find((r) => r.slug === 'alpha');
      expect(alpha?.status).toBe('HIDDEN');
      expect(typeof alpha?.createdAt).toBe('string');
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/tags');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/admin/tags', () => {
    it('creates a tag and returns it in subsequent GET', async () => {
      const post = await authed(
        request(app.getHttpServer())
          .post('/api/v1/admin/tags')
          .send({ name: 'New', slug: 'new-tag' }),
      );
      expect(post.status).toBe(201);
      expect(post.body.data.slug).toBe('new-tag');
      expect(post.body.data.pathCount).toBe(0);
      expect(post.body.data.courseCount).toBe(0);
      expect(post.body.data.status).toBe('ACTIVE');

      const get = await authed(
        request(app.getHttpServer()).get('/api/v1/admin/tags'),
      );
      const slugs = (get.body.data as Array<{ slug: string }>).map(
        (r) => r.slug,
      );
      expect(slugs).toContain('new-tag');
    });

    it('accepts Arabic names', async () => {
      const name = 'ذكاء صناعي';
      const res = await authed(
        request(app.getHttpServer())
          .post('/api/v1/admin/tags')
          .send({ name, slug: 'ai' }),
      );
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe(name);
    });

    it('returns 409 on duplicate slug', async () => {
      await prisma.tag.create({ data: { name: 'X', slug: 'dup' } });
      const res = await authed(
        request(app.getHttpServer())
          .post('/api/v1/admin/tags')
          .send({ name: 'Y', slug: 'dup' }),
      );
      expect(res.status).toBe(409);
    });

    it('returns 400 on invalid slug format (uppercase)', async () => {
      const res = await authed(
        request(app.getHttpServer())
          .post('/api/v1/admin/tags')
          .send({ name: 'X', slug: 'Bad-Slug' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 on invalid slug format (special chars)', async () => {
      const res = await authed(
        request(app.getHttpServer())
          .post('/api/v1/admin/tags')
          .send({ name: 'X', slug: 'bad_slug!' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 on whitespace-only name', async () => {
      const res = await authed(
        request(app.getHttpServer())
          .post('/api/v1/admin/tags')
          .send({ name: '   ', slug: 'whitespace' }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated POST', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/tags')
        .send({ name: 'X', slug: 'x' });
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/admin/tags/:id', () => {
    it('updates name and returns new shape', async () => {
      const tag = await prisma.tag.create({
        data: { name: 'Old', slug: 'old' },
      });
      const res = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/tags/${tag.id}`)
          .send({ name: 'New' }),
      );
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('New');
      expect(res.body.data.slug).toBe('old');
    });

    it('returns 404 on nonexistent id', async () => {
      const res = await authed(
        request(app.getHttpServer())
          .patch('/api/v1/admin/tags/00000000-0000-0000-0000-000000000000')
          .send({ name: 'X' }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 409 on slug collision', async () => {
      await prisma.tag.create({ data: { name: 'A', slug: 'alpha' } });
      const b = await prisma.tag.create({ data: { name: 'B', slug: 'beta' } });
      const res = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/tags/${b.id}`)
          .send({ slug: 'alpha' }),
      );
      expect(res.status).toBe(409);
    });

    it('supports ACTIVE ↔ HIDDEN status transitions', async () => {
      const tag = await prisma.tag.create({
        data: { name: 'T', slug: 't', status: TagStatus.ACTIVE },
      });
      const toHidden = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/tags/${tag.id}`)
          .send({ status: 'HIDDEN' }),
      );
      expect(toHidden.status).toBe(200);
      expect(toHidden.body.data.status).toBe('HIDDEN');

      const backToActive = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/tags/${tag.id}`)
          .send({ status: 'ACTIVE' }),
      );
      expect(backToActive.status).toBe(200);
      expect(backToActive.body.data.status).toBe('ACTIVE');
    });

    it('rejects unauthenticated PATCH', async () => {
      const tag = await prisma.tag.create({
        data: { name: 'U', slug: 'u-patch' },
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tags/${tag.id}`)
        .send({ name: 'X' });
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/admin/tags/:id', () => {
    it('returns 204 and cascades PathTag/CourseTag rows', async () => {
      const tag = await prisma.tag.create({
        data: { name: 'Del', slug: 'del' },
      });
      const cat = await prisma.category.create({
        data: { name: 'C', slug: 'del-cat' },
      });
      const p = await prisma.path.create({
        data: { categoryId: cat.id, title: 'P', slug: 'del-p' },
      });
      const c = await prisma.course.create({
        data: { categoryId: cat.id, slug: 'del-c', title: 'C' },
      });
      await prisma.pathTag.create({ data: { pathId: p.id, tagId: tag.id } });
      await prisma.courseTag.create({
        data: { courseId: c.id, tagId: tag.id },
      });

      const res = await authed(
        request(app.getHttpServer()).delete(`/api/v1/admin/tags/${tag.id}`),
      );
      expect(res.status).toBe(204);

      expect(await prisma.tag.count({ where: { id: tag.id } })).toBe(0);
      expect(await prisma.pathTag.count({ where: { tagId: tag.id } })).toBe(0);
      expect(await prisma.courseTag.count({ where: { tagId: tag.id } })).toBe(
        0,
      );
    });

    it('returns 404 on nonexistent id', async () => {
      const res = await authed(
        request(app.getHttpServer()).delete(
          '/api/v1/admin/tags/00000000-0000-0000-0000-000000000000',
        ),
      );
      expect(res.status).toBe(404);
    });

    it('rejects unauthenticated DELETE', async () => {
      const tag = await prisma.tag.create({
        data: { name: 'U', slug: 'u-del' },
      });
      const res = await request(app.getHttpServer()).delete(
        `/api/v1/admin/tags/${tag.id}`,
      );
      expect(res.status).toBe(401);
    });
  });
});
