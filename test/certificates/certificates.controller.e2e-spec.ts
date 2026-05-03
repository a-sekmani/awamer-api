import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { PrismaClient, CertificateType } from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../src/common/cache/redis.provider';
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

async function seedCtx(suffix: string) {
  const user = await prisma.user.create({
    data: {
      name: `Ahmad ${suffix}`,
      email: `cert-${suffix}@awamer.test`,
      passwordHash: 'hash',
    },
  });
  const cat = await prisma.category.create({
    data: { name: 'C', slug: `cert-cat-${suffix}` },
  });
  const path = await prisma.path.create({
    data: {
      categoryId: cat.id,
      title: 'Test Path',
      slug: `cert-path-${suffix}`,
    },
  });
  const course = await prisma.course.create({
    data: {
      categoryId: cat.id,
      pathId: null,
      title: 'Git Basics',
      slug: `cert-course-${suffix}`,
    },
  });
  return { user, cat, path, course };
}

describe('CertificatesController (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await truncateAll();
    // Redis-backed throttler counters persist across tests; reset them so the
    // 30/60s rate limit on /certificates/verify/:code starts fresh each test.
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // =========================================================================
  // GET /certificates/me (US6)
  // =========================================================================
  describe('GET /api/v1/certificates/me (US6)', () => {
    it("returns all of the user's certificates sorted by issuedAt DESC", async () => {
      const { user, path, course } = await seedCtx('list');
      await prisma.certificate.create({
        data: {
          userId: user.id,
          type: CertificateType.COURSE,
          courseId: course.id,
          certificateCode: 'code-course',
          issuedAt: new Date('2026-04-10T00:00:00.000Z'),
        },
      });
      await prisma.certificate.create({
        data: {
          userId: user.id,
          type: CertificateType.PATH,
          pathId: path.id,
          certificateCode: 'code-path',
          issuedAt: new Date('2026-04-12T00:00:00.000Z'),
        },
      });
      const bearer = await signFor(app, user.id);
      const res = await request(app.getHttpServer())
        .get('/api/v1/certificates/me')
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
      expect(res.body.data.certificates).toHaveLength(2);
      expect(res.body.data.certificates[0].type).toBe('PATH');
      expect(res.body.data.certificates[1].type).toBe('COURSE');
      expect(res.body.data.certificates[0].path).toMatchObject({
        title: 'Test Path',
      });
      expect(res.body.data.certificates[1].course).toMatchObject({
        title: 'Git Basics',
      });
    });

    it('returns an empty array when the user has no certificates', async () => {
      const { user } = await seedCtx('empty');
      const bearer = await signFor(app, user.id);
      const res = await request(app.getHttpServer())
        .get('/api/v1/certificates/me')
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
      expect(res.body.data.certificates).toEqual([]);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/certificates/me',
      );
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // GET /certificates/verify/:code (US7) + C2 throttle
  // =========================================================================
  describe('GET /api/v1/certificates/verify/:code (US7)', () => {
    it('returns the allow-listed DTO without authentication', async () => {
      const { user, course } = await seedCtx('verify');
      await prisma.certificate.create({
        data: {
          userId: user.id,
          type: CertificateType.COURSE,
          courseId: course.id,
          certificateCode: 'verify-code-1',
        },
      });
      const res = await request(app.getHttpServer()).get(
        '/api/v1/certificates/verify/verify-code-1',
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        valid: true,
        type: 'COURSE',
        subject: {
          type: 'COURSE',
          title: 'Git Basics',
          slug: expect.any(String),
        },
      });
      expect(res.body.data.holder.fullName).toBe('Ahmad verify');
    });

    it('returns 404 for an unknown code', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/certificates/verify/no-such-code',
      );
      expect(res.status).toBe(404);
    });

    it('response MUST NOT contain email, enrollment date, or progress fields', async () => {
      const { user, course } = await seedCtx('minimal');
      await prisma.certificate.create({
        data: {
          userId: user.id,
          type: CertificateType.COURSE,
          courseId: course.id,
          certificateCode: 'verify-code-2',
        },
      });
      const res = await request(app.getHttpServer()).get(
        '/api/v1/certificates/verify/verify-code-2',
      );
      expect(res.status).toBe(200);
      const json = JSON.stringify(res.body);
      // FR-021 / SC-006: no sensitive data leaks.
      expect(json).not.toContain('@awamer.test');
      expect(json).not.toContain('enrolledAt');
      expect(json).not.toContain('percentComplete');
      expect(json).not.toContain('passwordHash');
      expect(res.body.data.holder).toEqual({ fullName: 'Ahmad minimal' });
      // Only the allow-listed top-level keys.
      expect(Object.keys(res.body.data).sort()).toEqual([
        'holder',
        'issuedAt',
        'subject',
        'type',
        'valid',
      ]);
    });

    // -------------------------------------------------------------------------
    // C2 — rate limiting (30/60s per-route throttle)
    // -------------------------------------------------------------------------
    // ThrottlerGuard keeps its state in an in-memory Map scoped to the Nest
    // app instance. The other tests in this file each consume 1 throttle slot
    // against the shared app; to test the per-route 30/60 limit cleanly we
    // build a dedicated app with fresh throttler state.
    describe('rate limiting (C2)', () => {
      let throttleApp: INestApplication;

      beforeAll(async () => {
        ({ app: throttleApp } = await createTestApp());
      });

      afterAll(async () => {
        await throttleApp.close();
      });

      it('enforces the 30-request per-minute limit on the verify endpoint', async () => {
        const url = '/api/v1/certificates/verify/throttle-test-code';
        for (let i = 0; i < 30; i++) {
          const res = await request(throttleApp.getHttpServer()).get(url);
          expect(res.status).toBe(404);
        }
        const blocked = await request(throttleApp.getHttpServer()).get(url);
        expect(blocked.status).toBe(429);
      });
    });
  });
});
