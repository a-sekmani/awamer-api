import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  Module,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as cookieParser from 'cookie-parser';
import type Redis from 'ioredis';
import * as request from 'supertest';
import { AdminModule } from '../../src/admin/admin.module';
import { AdminEndpoint } from '../../src/admin/common/decorators/admin-endpoint.decorator';
import { CategoriesAdminModule } from '../../src/admin/categories/categories-admin.module';
import { AdminHealthController } from '../../src/admin/controllers/admin-health.controller';
import { AuditLogInterceptor } from '../../src/admin/interceptors/audit-log.interceptor';
import { AppModule } from '../../src/app.module';
import { AuthModule } from '../../src/auth/auth.module';
import { REDIS_CLIENT } from '../../src/common/cache/redis.provider';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * KAN-100 — sub-module foundation regression test.
 *
 * Exercises the cross-module configuration that KAN-78 never tested: a
 * minimal in-test sub-module decorated with `@AdminEndpoint()`, registered
 * under `AdminModule.imports`, with `RolesGuard` + `AuditLogInterceptor`
 * registered locally in its own `providers` (the canonical pattern). The
 * test asserts the sub-module boots and serves under the same foundation
 * invariants the directly-mounted `AdminHealthController` does.
 */

@Controller('admin/__foundation-test')
@AdminEndpoint()
class FoundationTestController {
  @Get()
  list(): { items: unknown[] } {
    return { items: [] };
  }

  @Post()
  create(@Body() dto: { name: string }): { ok: true; name: string } {
    return { ok: true, name: dto.name };
  }
}

@Module({
  controllers: [FoundationTestController],
  providers: [RolesGuard, AuditLogInterceptor],
})
class FoundationTestSubModule {}

/**
 * Mirror `AdminModule` but add `FoundationTestSubModule` to its `imports`.
 * Used with `Test.createTestingModule().overrideModule(AdminModule)` so
 * the test exercises the same wiring path real per-entity sub-modules use.
 */
@Module({
  imports: [AuthModule, CategoriesAdminModule, FoundationTestSubModule],
  controllers: [AdminHealthController],
  providers: [RolesGuard, AuditLogInterceptor],
  exports: [RolesGuard, AuditLogInterceptor],
})
class TestAdminModule {}

describe('Admin Foundation sub-module pattern (e2e — KAN-100)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let redis: Redis | undefined;

  const TEST_EMAIL_PREFIX = 'e2e-foundation-sub';
  let testCounter = 0;

  function uniqueEmail(): string {
    return `${TEST_EMAIL_PREFIX}-${Date.now()}-${testCounter++}@test.local`;
  }

  async function createTestUser(role: Role) {
    const email = uniqueEmail();
    const passwordHash = await bcrypt.hash('Test@1234', 12);
    const user = await prisma.user.create({
      data: {
        name: 'Foundation Sub-Module E2E',
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(AdminModule)
      .useModule(TestAdminModule)
      .compile();

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

  // -----------------------------------------------------------------
  // (1) Boot — the test sub-module compiles into the AdminModule
  //     override and yields a working HTTP server.
  // -----------------------------------------------------------------
  it('(1) test app boots without DI errors (sub-module-local providers resolve @AdminEndpoint)', () => {
    expect(app).toBeDefined();
    expect(app.getHttpServer()).toBeDefined();
  });

  // -----------------------------------------------------------------
  // (2) Anonymous → 401, no stack/cause/exception names leaked.
  // -----------------------------------------------------------------
  it('(2) anonymous GET → 401 with no stack/cause/exception names leaked', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/__foundation-test')
      .expect(401);

    expect(res.body.statusCode).toBe(401);
    expect(res.body.stack).toBeUndefined();
    expect(res.body.cause).toBeUndefined();
    expect(res.body.name).toBeUndefined();
  });

  // -----------------------------------------------------------------
  // (3) Learner JWT → 403 INSUFFICIENT_ROLE (RolesGuard activated locally).
  // -----------------------------------------------------------------
  it('(3) learner GET → 403 INSUFFICIENT_ROLE', async () => {
    const learner = await createTestUser(Role.LEARNER);

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/__foundation-test')
      .set('Cookie', [`access_token=${learner.token}`])
      .expect(403);

    expect(res.body.statusCode).toBe(403);
    expect(res.body.errorCode).toBe('INSUFFICIENT_ROLE');
  });

  // -----------------------------------------------------------------
  // (4) Admin GET → 200 with platform envelope.
  // -----------------------------------------------------------------
  it('(4) admin GET → 200 with { data: { items: [] }, message: "Success" }', async () => {
    const admin = await createTestUser(Role.ADMIN);

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/__foundation-test')
      .set('Cookie', [`access_token=${admin.token}`])
      .expect(200);

    expect(res.body).toEqual({ data: { items: [] }, message: 'Success' });
  });

  // -----------------------------------------------------------------
  // (5) + (6) — audit log assertions.
  // -----------------------------------------------------------------
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

    it('(5) admin POST → 201 + envelope, exactly one success-flavored audit entry', async () => {
      const admin = await createTestUser(Role.ADMIN);

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/__foundation-test')
        .set('Cookie', [`access_token=${admin.token}`])
        .send({ name: 'test' })
        .expect(201);

      expect(res.body).toEqual({
        data: { ok: true, name: 'test' },
        message: 'Success',
      });

      const entries = adminAuditCalls();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        method: 'POST',
        route: '/api/v1/admin/__foundation-test',
        outcome: 'success',
      });
    });

    it('(6) admin GET → 200, ZERO audit entries (method gate excludes GET)', async () => {
      const admin = await createTestUser(Role.ADMIN);

      await request(app.getHttpServer())
        .get('/api/v1/admin/__foundation-test')
        .set('Cookie', [`access_token=${admin.token}`])
        .expect(200);

      expect(adminAuditCalls()).toHaveLength(0);
    });
  });
});
