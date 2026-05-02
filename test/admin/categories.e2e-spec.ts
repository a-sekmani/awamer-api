import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CategoryStatus, PathStatus, CourseStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as cookieParser from 'cookie-parser';
import type Redis from 'ioredis';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CacheKeys } from '../../src/common/cache/cache-keys';
import { REDIS_CLIENT } from '../../src/common/cache/redis.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import { prisma as testPrisma, truncateAll } from '../schema/setup';

/**
 * E2E for KAN-82 — Categories admin CRUD.
 *
 * Covers US1 (create+list), US3 (delete FK protection), US4 (foundation
 * invariants), US5 (cache freshness), US6 (PATCH partial update), US7 (detail).
 * US2 is verified by the existing test/content/categories e2e suite.
 */
describe('Admin Categories (e2e — KAN-82)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let redis: Redis;

  const TEST_EMAIL_PREFIX = 'e2e-cat-admin';
  let testCounter = 0;

  function uniqueEmail(): string {
    return `${TEST_EMAIL_PREFIX}-${Date.now()}-${testCounter++}@test.local`;
  }

  async function createTestUser(role: Role) {
    const email = uniqueEmail();
    const passwordHash = await bcrypt.hash('Test@1234', 12);
    const user = await prisma.user.create({
      data: {
        name: 'Cat Admin E2E',
        email,
        passwordHash,
        emailVerified: true,
        status: 'ACTIVE' as never,
      },
    });
    await prisma.userProfile.create({
      data: { userId: user.id, onboardingCompleted: true },
    });
    await prisma.userRole.create({ data: { userId: user.id, role } });
    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      emailVerified: true,
      onboardingCompleted: true,
      roles: [role],
    });
    return { userId: user.id, email, token };
  }

  async function seedCategory(overrides: Record<string, unknown> = {}) {
    return prisma.category.create({
      data: {
        name: `Cat ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        slug: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        order: 0,
        status: CategoryStatus.ACTIVE,
        ...overrides,
      },
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await truncateAll();
    await redis.flushdb();
  });

  afterAll(async () => {
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
      select: { id: true },
    });
    const ids = testUsers.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.userProfile.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    try {
      await redis.quit();
    } catch {
      // ignore
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ===========================================================================
  // US1 — Admin creates and lists categories (P1, MVP)
  // ===========================================================================
  describe('US1 — create + list (10 scenarios incl. 2 DTO smoke)', () => {
    it('(1) POST creates a category', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'AI', slug: 'ai-cat-create' })
        .expect(201);
      expect(res.body.data).toMatchObject({
        name: 'AI',
        slug: 'ai-cat-create',
        order: 0,
        status: 'ACTIVE',
        pathCount: 0,
        courseCount: 0,
      });
      expect(typeof res.body.data.id).toBe('string');
      expect(res.body.message).toBe('Success');
    });

    it('(2) created category appears in GET list', async () => {
      const admin = await createTestUser(Role.ADMIN);
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'Cybersecurity', slug: 'cyber' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);
      expect(res.body.data.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Cybersecurity', slug: 'cyber' }),
        ]),
      );
    });

    it('(3) pagination meta fields are populated', async () => {
      const admin = await createTestUser(Role.ADMIN);
      // seed 3 categories
      for (let i = 0; i < 3; i++) {
        await seedCategory({ name: `P-${i}`, slug: `p-${i}` });
      }
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories?page=1&limit=2')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);
      expect(res.body.data.meta).toEqual({
        total: 3,
        page: 1,
        limit: 2,
        totalPages: 2,
      });
    });

    it('(4) search narrows results case-insensitively against name and slug', async () => {
      const admin = await createTestUser(Role.ADMIN);
      await seedCategory({ name: 'Cybersecurity', slug: 'cyber' });
      await seedCategory({ name: 'Cloud', slug: 'cloud' });
      await seedCategory({ name: 'AI', slug: 'ai' });
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories?search=cy')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);
      const names = res.body.data.data.map((c: { name: string }) => c.name);
      expect(names).toContain('Cybersecurity');
      expect(names).not.toContain('Cloud');
      expect(names).not.toContain('AI');
    });

    it('(5) no status filter → returns ACTIVE+HIDDEN both', async () => {
      const admin = await createTestUser(Role.ADMIN);
      await seedCategory({
        name: 'A',
        slug: 'a-active',
        status: CategoryStatus.ACTIVE,
      });
      await seedCategory({
        name: 'B',
        slug: 'b-hidden',
        status: CategoryStatus.HIDDEN,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);
      const slugs = res.body.data.data.map((c: { slug: string }) => c.slug);
      expect(slugs).toEqual(expect.arrayContaining(['a-active', 'b-hidden']));
    });

    it('(6) ?status=ACTIVE filters to ACTIVE only', async () => {
      const admin = await createTestUser(Role.ADMIN);
      await seedCategory({
        name: 'A',
        slug: 'a-active',
        status: CategoryStatus.ACTIVE,
      });
      await seedCategory({
        name: 'B',
        slug: 'b-hidden',
        status: CategoryStatus.HIDDEN,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories?status=ACTIVE')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);
      const slugs = res.body.data.data.map((c: { slug: string }) => c.slug);
      expect(slugs).toContain('a-active');
      expect(slugs).not.toContain('b-hidden');
    });

    it('(7) ?status=HIDDEN filters to HIDDEN only', async () => {
      const admin = await createTestUser(Role.ADMIN);
      await seedCategory({
        name: 'A',
        slug: 'a-active',
        status: CategoryStatus.ACTIVE,
      });
      await seedCategory({
        name: 'B',
        slug: 'b-hidden',
        status: CategoryStatus.HIDDEN,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories?status=HIDDEN')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);
      const slugs = res.body.data.data.map((c: { slug: string }) => c.slug);
      expect(slugs).toContain('b-hidden');
      expect(slugs).not.toContain('a-active');
    });

    it('(8) ?status=invalid → 400 VALIDATION_FAILED', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories?status=invalid')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('(9) POST whitespace-only name → 400 VALIDATION_FAILED', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: '   ', slug: 'ai-ws' })
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('(10) POST malformed slug → 400 VALIDATION_FAILED', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'AI', slug: 'Bad Slug' })
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });
  });

  // ===========================================================================
  // US3 — DELETE FK protection (P1)
  // ===========================================================================
  describe('US3 — delete FK protection', () => {
    it('(a) referenced by 2 paths and 5 courses → 409 CATEGORY_IN_USE with exact counts', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const cat = await seedCategory({ name: 'WithRefs', slug: 'with-refs' });
      // 2 paths
      for (let i = 0; i < 2; i++) {
        await prisma.path.create({
          data: {
            categoryId: cat.id,
            slug: `path-${i}`,
            title: `P${i}`,
            status: PathStatus.DRAFT,
          },
        });
      }
      // 5 courses (categoryId-only, no path)
      for (let i = 0; i < 5; i++) {
        await prisma.course.create({
          data: {
            categoryId: cat.id,
            slug: `course-${i}`,
            title: `C${i}`,
            status: CourseStatus.DRAFT,
          },
        });
      }

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(409);

      expect(res.body.errorCode).toBe('CATEGORY_IN_USE');
      expect(res.body.errors).toEqual({ pathCount: 2, courseCount: 5 });

      const stillThere = await prisma.category.findUnique({
        where: { id: cat.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it('(b) zero refs → 200 + { ok: true }, row removed', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const cat = await seedCategory({ name: 'NoRefs', slug: 'no-refs' });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);

      expect(res.body).toEqual({ data: { ok: true }, message: 'Success' });
      const gone = await prisma.category.findUnique({ where: { id: cat.id } });
      expect(gone).toBeNull();
    });

    it('(c) non-existent UUID → 404 CATEGORY_NOT_FOUND', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const res = await request(app.getHttpServer())
        .delete('/api/v1/admin/categories/00000000-0000-0000-0000-000000000000')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(404);
      expect(res.body.errorCode).toBe('CATEGORY_NOT_FOUND');
    });

    it('(d) referenced only by paths (no courses) → 409 with errors.courseCount: 0', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const cat = await seedCategory({ name: 'PathsOnly', slug: 'paths-only' });
      await prisma.path.create({
        data: {
          categoryId: cat.id,
          slug: 'path-only-1',
          title: 'PO',
          status: PathStatus.DRAFT,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(409);

      expect(res.body.errorCode).toBe('CATEGORY_IN_USE');
      expect(res.body.errors).toEqual({ pathCount: 1, courseCount: 0 });
    });
  });

  // ===========================================================================
  // US4 — Foundation invariants (P1)
  // ===========================================================================
  describe('US4 — auth + role + audit invariants', () => {
    it('(1) anonymous → 401 on every endpoint', async () => {
      const cat = await seedCategory();
      await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/v1/admin/categories/${cat.id}`)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .send({ name: 'X', slug: 'x' })
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .send({ name: 'Y' })
        .expect(401);
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/categories/${cat.id}`)
        .expect(401);
    });

    it('(2) learner JWT → 403 + INSUFFICIENT_ROLE', async () => {
      const learner = await createTestUser(Role.LEARNER);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${learner.token}`])
        .expect(403);
      expect(res.body.errorCode).toBe('INSUFFICIENT_ROLE');
    });

    describe('audit log emission', () => {
      let logSpy: jest.SpyInstance;

      function adminAuditCalls(): Array<Record<string, unknown>> {
        return logSpy.mock.calls
          .map((call) => call[0])
          .filter(
            (payload): payload is Record<string, unknown> =>
              !!payload &&
              typeof payload === 'object' &&
              'outcome' in (payload as object) &&
              'route' in (payload as object) &&
              'userEmail' in (payload as object),
          );
      }

      beforeEach(() => {
        logSpy = jest
          .spyOn(Logger.prototype, 'log')
          .mockImplementation(() => undefined);
      });
      afterEach(() => logSpy.mockRestore());

      it('(3) successful POST emits exactly one success-flavored audit entry', async () => {
        const admin = await createTestUser(Role.ADMIN);
        await request(app.getHttpServer())
          .post('/api/v1/admin/categories')
          .set('Cookie', [`access_token=${admin.token}`])
          .send({ name: 'AuditMe', slug: 'audit-me' })
          .expect(201);

        const entries = adminAuditCalls();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          userId: admin.userId,
          userEmail: admin.email,
          roles: [Role.ADMIN],
          method: 'POST',
          action: 'POST /api/v1/admin/categories',
          outcome: 'success',
        });
      });

      it('(4) GET emits zero audit entries', async () => {
        const admin = await createTestUser(Role.ADMIN);
        await request(app.getHttpServer())
          .get('/api/v1/admin/categories')
          .set('Cookie', [`access_token=${admin.token}`])
          .expect(200);
        expect(adminAuditCalls()).toHaveLength(0);
      });

      it('(5) DELETE rejected with 409 emits one error-flavored audit entry', async () => {
        const admin = await createTestUser(Role.ADMIN);
        const cat = await seedCategory({
          name: 'AuditFail',
          slug: 'audit-fail',
        });
        await prisma.path.create({
          data: {
            categoryId: cat.id,
            slug: 'p-block',
            title: 'PB',
            status: PathStatus.DRAFT,
          },
        });

        await request(app.getHttpServer())
          .delete(`/api/v1/admin/categories/${cat.id}`)
          .set('Cookie', [`access_token=${admin.token}`])
          .expect(409);

        const entries = adminAuditCalls();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          method: 'DELETE',
          outcome: 'error',
          statusCode: 409,
        });
      });
    });
  });

  // ===========================================================================
  // US5 — Cache freshness (P2)
  // ===========================================================================
  describe('US5 — cache freshness', () => {
    it('successful POST evicts the public categories:all cache key; failing POST does not re-create it', async () => {
      const admin = await createTestUser(Role.ADMIN);
      // Prime cache via the public endpoint
      await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
      const primed = await redis.get(CacheKeys.categories.all());
      expect(primed).not.toBeNull();

      // Successful POST → key gone
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'CacheTest', slug: 'cache-test' })
        .expect(201);
      expect(await redis.get(CacheKeys.categories.all())).toBeNull();

      // Failing POST (duplicate slug) → key still null (was already evicted)
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'CacheTest 2', slug: 'cache-test' })
        .expect(409);
      expect(await redis.get(CacheKeys.categories.all())).toBeNull();
    });
  });

  // ===========================================================================
  // US6 — PATCH partial update (P2)
  // ===========================================================================
  describe('US6 — partial update', () => {
    it('PATCH single field preserves other fields', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const cat = await seedCategory({ name: 'Old', slug: 'old', order: 5 });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'اسم جديد' })
        .expect(200);
      expect(res.body.data.name).toBe('اسم جديد');
      expect(res.body.data.slug).toBe('old');
      expect(res.body.data.order).toBe(5);
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('PATCH name conflict against another row → 409 CATEGORY_NAME_EXISTS', async () => {
      const admin = await createTestUser(Role.ADMIN);
      await seedCategory({ name: 'Taken', slug: 'taken' });
      const cat = await seedCategory({ name: 'Mine', slug: 'mine' });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'Taken' })
        .expect(409);
      expect(res.body.errorCode).toBe('CATEGORY_NAME_EXISTS');
    });

    it('PATCH name+slug both colliding (different rows) → name wins', async () => {
      const admin = await createTestUser(Role.ADMIN);
      await seedCategory({ name: 'NameTaken', slug: 'whatever' });
      await seedCategory({ name: 'X', slug: 'slug-taken' });
      const cat = await seedCategory({ name: 'Mine', slug: 'mine' });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'NameTaken', slug: 'slug-taken' })
        .expect(409);
      expect(res.body.errorCode).toBe('CATEGORY_NAME_EXISTS');
    });

    it('PATCH invalid status (uppercase typo) → 400 VALIDATION_FAILED', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const cat = await seedCategory();
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ status: 'INVALID_VALUE' })
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('PATCH unknown UUID → 404 CATEGORY_NOT_FOUND', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const res = await request(app.getHttpServer())
        .patch('/api/v1/admin/categories/00000000-0000-0000-0000-000000000000')
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'X' })
        .expect(404);
      expect(res.body.errorCode).toBe('CATEGORY_NOT_FOUND');
    });

    it('PATCH empty body is a no-op success', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const cat = await seedCategory({ name: 'Same', slug: 'same' });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .send({})
        .expect(200);
      expect(res.body.data.name).toBe('Same');
    });
  });

  // ===========================================================================
  // US7 — Detail view (P2)
  // ===========================================================================
  describe('US7 — detail', () => {
    it('GET /:id returns 200 with computed pathCount and courseCount', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const cat = await seedCategory({ name: 'Detail', slug: 'detail-cat' });
      // 2 paths + 3 courses
      for (let i = 0; i < 2; i++) {
        await prisma.path.create({
          data: {
            categoryId: cat.id,
            slug: `dp-${i}`,
            title: `DP${i}`,
            status: PathStatus.DRAFT,
          },
        });
      }
      for (let i = 0; i < 3; i++) {
        await prisma.course.create({
          data: {
            categoryId: cat.id,
            slug: `dc-${i}`,
            title: `DC${i}`,
            status: CourseStatus.DRAFT,
          },
        });
      }

      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/categories/${cat.id}`)
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);
      expect(res.body.data).toMatchObject({
        id: cat.id,
        name: 'Detail',
        slug: 'detail-cat',
        pathCount: 2,
        courseCount: 3,
      });
    });

    it('GET unknown UUID → 404 CATEGORY_NOT_FOUND', async () => {
      const admin = await createTestUser(Role.ADMIN);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/categories/00000000-0000-0000-0000-000000000000')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(404);
      expect(res.body.errorCode).toBe('CATEGORY_NOT_FOUND');
    });

    it('GET non-UUID id → 400 (ParseUUIDPipe rejects)', async () => {
      const admin = await createTestUser(Role.ADMIN);
      await request(app.getHttpServer())
        .get('/api/v1/admin/categories/not-a-uuid')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(400);
    });
  });
});
// also verify e2e harness compiles by referencing testPrisma
void testPrisma;
