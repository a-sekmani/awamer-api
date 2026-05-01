import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { REDIS_CLIENT } from '../src/common/cache/redis.provider';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * E2E tests for the Admin Foundation (KAN-78):
 *   GET  /api/v1/admin/__ping  — admin only, returns { ok: true }
 *
 * Covers User Stories 1, 2, 3 from specs/014-admin-foundation/spec.md:
 *   - US1: admin JWT → 200 with envelope { data: { ok: true }, message: 'Success' }
 *   - US2: learner JWT → 403 with errorCode INSUFFICIENT_ROLE
 *   - US3: no JWT / invalid / expired → 401
 */
describe('Admin Foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let redis: Redis | undefined;

  const TEST_EMAIL_PREFIX = 'e2e-admin-test';
  let testCounter = 0;

  function uniqueEmail(): string {
    return `${TEST_EMAIL_PREFIX}-${Date.now()}-${testCounter++}@test.local`;
  }

  /**
   * Create a user directly in the DB with the given role and return a signed JWT.
   * Mirrors the pattern in test/auth.e2e-spec.ts.
   */
  async function createTestUser(role: Role) {
    const email = uniqueEmail();
    const passwordHash = await bcrypt.hash('Test@1234', 12);

    const user = await prisma.user.create({
      data: {
        name: 'Admin E2E User',
        email,
        passwordHash,
        emailVerified: true,
        status: 'ACTIVE' as any,
      },
    });

    await prisma.userProfile.create({
      data: { userId: user.id, onboardingCompleted: true },
    });

    await prisma.userRole.create({
      data: { userId: user.id, role },
    });

    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      emailVerified: true,
      onboardingCompleted: true,
      roles: [role],
    });

    return { userId: user.id, email, token };
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

    // Disable throttling for E2E tests
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    try {
      redis = app.get<Redis>(REDIS_CLIENT);
    } catch {
      redis = undefined;
    }
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

    if (redis) {
      try {
        await redis.quit();
      } catch {
        // ignore
      }
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ------------------------------------------------------------------
  // User Story 1 — admin reaches admin route
  // ------------------------------------------------------------------
  describe('admin happy path (US1)', () => {
    it('GET /api/v1/admin/__ping with admin JWT returns 200 + envelope { data: { ok: true }, message: "Success" }', async () => {
      const admin = await createTestUser(Role.ADMIN);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/__ping')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);

      expect(res.body).toEqual({ data: { ok: true }, message: 'Success' });
    });
  });

  // ------------------------------------------------------------------
  // User Story 2 — non-admin authenticated user blocked with 403
  // ------------------------------------------------------------------
  describe('forbidden path (US2)', () => {
    it('GET /api/v1/admin/__ping with learner JWT returns 403 + INSUFFICIENT_ROLE', async () => {
      const learner = await createTestUser(Role.LEARNER);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/__ping')
        .set('Cookie', [`access_token=${learner.token}`])
        .expect(403);

      expect(res.body.statusCode).toBe(403);
      expect(res.body.errorCode).toBe('INSUFFICIENT_ROLE');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
    });

    it('403 response body contains no stack trace or internal exception class names', async () => {
      const learner = await createTestUser(Role.LEARNER);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/__ping')
        .set('Cookie', [`access_token=${learner.token}`])
        .expect(403);

      expect(res.body.stack).toBeUndefined();
      expect(res.body.cause).toBeUndefined();
      expect(res.body.name).toBeUndefined();
      // Human-readable message must not contain internal class identifiers
      expect(res.body.message).not.toMatch(/Exception|ForbiddenException|RolesGuard/);
    });
  });

  // ------------------------------------------------------------------
  // User Story 3 — anonymous / invalid / expired JWT blocked with 401
  // ------------------------------------------------------------------
  describe('unauthenticated path (US3)', () => {
    it('GET /api/v1/admin/__ping with no token returns 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/__ping')
        .expect(401);

      expect(res.body.statusCode).toBe(401);
      expect(res.body.stack).toBeUndefined();
      expect(res.body.cause).toBeUndefined();
    });

    it('GET /api/v1/admin/__ping with malformed bearer token returns 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/__ping')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);

      expect(res.body.statusCode).toBe(401);
      expect(res.body.stack).toBeUndefined();
    });

    it('GET /api/v1/admin/__ping with expired JWT returns 401', async () => {
      const admin = await createTestUser(Role.ADMIN);

      // Sign a JWT that is already expired by giving it a negative TTL.
      const expiredToken = jwtService.sign(
        {
          sub: admin.userId,
          email: admin.email,
          emailVerified: true,
          onboardingCompleted: true,
          roles: [Role.ADMIN],
        },
        { expiresIn: '-1s' },
      );

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/__ping')
        .set('Cookie', [`access_token=${expiredToken}`])
        .expect(401);

      expect(res.body.statusCode).toBe(401);
      expect(res.body.stack).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // User Story 5 — audit log captures every admin mutation
  // ------------------------------------------------------------------
  describe('audit log (US5)', () => {
    let logSpy: jest.SpyInstance;

    function adminAuditCalls(): unknown[] {
      // Logger.log is called many times across the app boot + request lifecycle.
      // Filter to entries that look like our structured admin audit payloads.
      return logSpy.mock.calls
        .map((call) => call[0])
        .filter(
          (payload) =>
            payload &&
            typeof payload === 'object' &&
            'outcome' in (payload as object) &&
            'route' in (payload as object) &&
            'userEmail' in (payload as object),
        );
    }

    beforeEach(() => {
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('POST /api/v1/admin/__ping (admin) emits exactly one structured audit entry with all required fields', async () => {
      const admin = await createTestUser(Role.ADMIN);

      await request(app.getHttpServer())
        .post('/api/v1/admin/__ping')
        .set('Cookie', [`access_token=${admin.token}`])
        .set('User-Agent', 'admin-e2e/1.0')
        .expect(201);

      const entries = adminAuditCalls();
      expect(entries).toHaveLength(1);
      // NestJS's setGlobalPrefix('api/v1') makes Express resolve the matched
      // route as `/api/v1/admin/__ping` — this is the real pattern the
      // interceptor records. The contract guarantees the matched PATTERN
      // (not the raw URL with parameter values), and the prefix IS part of
      // the pattern; it carries useful API-version info.
      expect(entries[0]).toMatchObject({
        userId: admin.userId,
        userEmail: admin.email,
        roles: [Role.ADMIN],
        action: 'POST /api/v1/admin/__ping',
        route: '/api/v1/admin/__ping',
        method: 'POST',
        userAgent: 'admin-e2e/1.0',
        outcome: 'success',
      });
      // The crucial guarantee: no UUIDs / raw IDs appear in the route.
      expect(entries[0]).toMatchObject({
        route: expect.not.stringMatching(/[0-9a-f]{8}-[0-9a-f]{4}-/),
      });
      const ts = (entries[0] as { timestamp: string }).timestamp;
      expect(typeof ts).toBe('string');
      expect(() => new Date(ts).toISOString()).not.toThrow();
    });

    it('GET /api/v1/admin/__ping (admin) emits ZERO audit entries', async () => {
      const admin = await createTestUser(Role.ADMIN);

      await request(app.getHttpServer())
        .get('/api/v1/admin/__ping')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);

      expect(adminAuditCalls()).toHaveLength(0);
    });

    it('POST mutation succeeds even when the audit logger throws synthetically', async () => {
      const admin = await createTestUser(Role.ADMIN);

      // Make any AdminAudit log emission throw — but the request should still succeed.
      logSpy.mockImplementation(() => {
        throw new Error('synthetic logger failure');
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/__ping')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(201);

      expect(res.body).toEqual({ data: { ok: true }, message: 'Success' });
    });
  });
});
