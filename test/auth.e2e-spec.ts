import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { REDIS_CLIENT } from '../src/common/cache/redis.provider';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * E2E tests for the auth endpoints:
 *   POST /api/v1/auth/register
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/logout
 *   POST /api/v1/auth/refresh
 *   POST /api/v1/auth/forgot-password
 *   GET  /api/v1/auth/verify-reset-token
 *   POST /api/v1/auth/reset-password
 *   POST /api/v1/auth/send-verification
 *   POST /api/v1/auth/verify-email
 *   POST /api/v1/auth/resend-verification
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let redis: Redis | undefined;

  const TEST_EMAIL_PREFIX = 'e2e-auth-test';
  let testCounter = 0;

  const STRONG_PASSWORD = 'Test@1234';
  const STRONG_PASSWORD_ALT = 'Alt@56789';

  function uniqueEmail(): string {
    return `${TEST_EMAIL_PREFIX}-${Date.now()}-${testCounter++}@test.local`;
  }

  /** Create a user directly in the DB and return id + signed JWT */
  async function createTestUser(opts: {
    emailVerified?: boolean;
    password?: string;
    status?: string;
  } = {}) {
    const email = uniqueEmail();
    const {
      emailVerified = false,
      password = STRONG_PASSWORD,
      status = 'ACTIVE',
    } = opts;

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        email,
        passwordHash,
        emailVerified,
        status: status as any,
      },
    });

    await prisma.userProfile.create({
      data: { userId: user.id, onboardingCompleted: false },
    });

    await prisma.userRole.create({
      data: { userId: user.id, role: 'LEARNER' },
    });

    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      emailVerified,
      onboardingCompleted: false,
      roles: ['LEARNER'],
    });

    return { userId: user.id, email, token, password };
  }

  /** Register a user via the API endpoint (full flow) */
  async function registerViaApi(overrides?: {
    email?: string;
    password?: string;
    name?: string;
    rememberMe?: boolean;
  }) {
    const email = overrides?.email ?? uniqueEmail();
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: overrides?.name ?? 'E2E User',
        email,
        password: overrides?.password ?? STRONG_PASSWORD,
        rememberMe: overrides?.rememberMe,
      });
    return { res, email };
  }

  /** Extract cookies from response */
  function getCookies(res: request.Response): string[] {
    return (res.headers['set-cookie'] as unknown as string[]) ?? [];
  }

  function findCookie(cookies: string[], name: string): string | undefined {
    return cookies.find((c) => c.startsWith(`${name}=`));
  }

  function extractCookieValue(cookie: string): string {
    return cookie.split('=')[1].split(';')[0];
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
    jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);
    try {
      redis = app.get<Redis>(REDIS_CLIENT);
    } catch {
      // CacheModule not loaded in this test env — leave redis undefined.
      redis = undefined;
    }
  });

  afterAll(async () => {
    // Clean up all test users and related data
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
      select: { id: true },
    });
    const ids = testUsers.map((u) => u.id);

    if (ids.length > 0) {
      await prisma.emailVerification.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.onboardingResponse.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.subscription.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.userProfile.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: ids } },
      });
    }

    // Clean up rate limit records created by tests
    await prisma.rateLimitedRequest.deleteMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
    });

    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/register
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/register', () => {
    // ── Happy path ──

    it('should register a new user and return 201', async () => {
      const { res } = await registerViaApi();
      expect(res.status).toBe(201);
    });

    it('should return user data without sensitive fields', async () => {
      const { res, email } = await registerViaApi();
      const data = res.body.data?.data ?? res.body.data;
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe(email);
      expect(data.user.id).toBeDefined();
      expect(data.user.name).toBeDefined();
      expect(data.user.passwordHash).toBeUndefined();
      expect(data.user.refreshToken).toBeUndefined();
    });

    it('should set access_token and refresh_token cookies', async () => {
      const { res } = await registerViaApi();
      const cookies = getCookies(res);
      expect(findCookie(cookies, 'access_token')).toBeDefined();
      expect(findCookie(cookies, 'refresh_token')).toBeDefined();
    });

    it('should set httpOnly and SameSite on cookies', async () => {
      const { res } = await registerViaApi();
      const cookies = getCookies(res);
      const accessCookie = findCookie(cookies, 'access_token')!;
      expect(accessCookie).toContain('HttpOnly');
      expect(accessCookie.toLowerCase()).toContain('samesite=strict');
    });

    it('should create user in database with correct defaults', async () => {
      const { email } = await registerViaApi();
      const user = await prisma.user.findUnique({
        where: { email },
        include: { profile: true, roles: true },
      });
      expect(user).not.toBeNull();
      expect(user!.emailVerified).toBe(false);
      expect(user!.locale).toBe('ar');
      expect(user!.status).toBe('ACTIVE');
      expect(user!.profile!.onboardingCompleted).toBe(false);
      expect(user!.roles[0].role).toBe('LEARNER');
    });

    it('should hash password (not store plaintext)', async () => {
      const { email } = await registerViaApi({ password: STRONG_PASSWORD });
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user!.passwordHash).not.toBe(STRONG_PASSWORD);
      const matches = await bcrypt.compare(STRONG_PASSWORD, user!.passwordHash);
      expect(matches).toBe(true);
    });

    it('should return requiresVerification: true for new users', async () => {
      const { res } = await registerViaApi();
      const data = res.body.data?.data ?? res.body.data;
      expect(data.user.requiresVerification).toBe(true);
      expect(data.user.emailVerified).toBe(false);
    });

    it('should normalize email to lowercase', async () => {
      const email = uniqueEmail().replace('@', '@').toUpperCase();
      const { res } = await registerViaApi({ email });
      const data = res.body.data?.data ?? res.body.data;
      expect(data.user.email).toBe(email.toLowerCase());
    });

    it('should accept optional country field', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'E2E User',
          email,
          password: STRONG_PASSWORD,
          country: 'SA',
        })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user!.country).toBe('SA');
    });

    // ── Duplicate email ──

    it('should return 409 when email is already registered', async () => {
      const { email } = await registerViaApi();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'Duplicate User',
          email,
          password: STRONG_PASSWORD,
        });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('EMAIL_ALREADY_EXISTS');
    });

    // ── Validation: name ──

    it('should return 400 when name is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(), password: STRONG_PASSWORD })
        .expect(400);
    });

    it('should return 400 when name is empty string', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: '', email: uniqueEmail(), password: STRONG_PASSWORD })
        .expect(400);
    });

    it('should return 400 when name exceeds 100 characters', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'a'.repeat(101),
          email: uniqueEmail(),
          password: STRONG_PASSWORD,
        })
        .expect(400);
    });

    // ── Validation: email ──

    it('should return 400 when email is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'Test', password: STRONG_PASSWORD })
        .expect(400);
    });

    it('should return 400 for invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'Test', email: 'not-an-email', password: STRONG_PASSWORD })
        .expect(400);
    });

    it('should return 400 when email exceeds 255 characters', async () => {
      const longEmail = 'a'.repeat(246) + '@test.com';
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'Test', email: longEmail, password: STRONG_PASSWORD })
        .expect(400);
    });

    // ── Validation: password ──

    it('should return 400 when password is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'Test', email: uniqueEmail() })
        .expect(400);
    });

    it('should return 400 when password is shorter than 8 characters', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'Test', email: uniqueEmail(), password: 'Ab1@' })
        .expect(400);
    });

    it('should return 400 when password exceeds 128 characters', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'Test',
          email: uniqueEmail(),
          password: 'Ab1@' + 'x'.repeat(125),
        })
        .expect(400);
    });

    it('should return 400 when password has no uppercase letter', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'Test',
          email: uniqueEmail(),
          password: 'test@1234',
        })
        .expect(400);
    });

    it('should return 400 when password has no lowercase letter', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'Test',
          email: uniqueEmail(),
          password: 'TEST@1234',
        })
        .expect(400);
    });

    it('should return 400 when password has no digit', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'Test',
          email: uniqueEmail(),
          password: 'Test@abcd',
        })
        .expect(400);
    });

    it('should return 400 when password has no special character', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'Test',
          email: uniqueEmail(),
          password: 'Test1234a',
        })
        .expect(400);
    });

    // ── Extra fields ──

    it('should reject unknown fields (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'Test',
          email: uniqueEmail(),
          password: STRONG_PASSWORD,
          hackerField: 'evil',
        })
        .expect(400);
    });

    // ── Empty body ──

    it('should return 400 when body is empty', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/login
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/login', () => {
    // ── Happy path ──

    it('should login with valid credentials and return 200', async () => {
      const { email, password } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const data = res.body.data?.data ?? res.body.data;
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe(email);
    });

    it('should set access_token and refresh_token cookies on login', async () => {
      const { email, password } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const cookies = getCookies(res);
      expect(findCookie(cookies, 'access_token')).toBeDefined();
      expect(findCookie(cookies, 'refresh_token')).toBeDefined();
    });

    it('should not expose passwordHash in response', async () => {
      const { email, password } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const data = res.body.data?.data ?? res.body.data;
      expect(data.user.passwordHash).toBeUndefined();
    });

    it('should update lastLoginAt in database', async () => {
      const { email, password, userId } = await createTestUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.lastLoginAt).not.toBeNull();
    });

    it('should normalize email to lowercase on login', async () => {
      const { email, password } = await createTestUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: email.toUpperCase(), password })
        .expect(200);
    });

    it('should return emailVerified and requiresVerification flags', async () => {
      const { email, password } = await createTestUser({
        emailVerified: false,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const data = res.body.data?.data ?? res.body.data;
      expect(data.user.emailVerified).toBe(false);
      expect(data.user.requiresVerification).toBe(true);
    });

    it('should return emailVerified=true for verified users', async () => {
      const { email, password } = await createTestUser({
        emailVerified: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const data = res.body.data?.data ?? res.body.data;
      expect(data.user.emailVerified).toBe(true);
      expect(data.user.requiresVerification).toBe(false);
    });

    // ── Invalid credentials ──

    it('should return 401 for wrong password', async () => {
      const { email } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Wrong@1234' })
        .expect(401);

      expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
    });

    it('should return 401 for non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.local', password: STRONG_PASSWORD })
        .expect(401);

      expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
    });

    it('should return 401 for inactive user', async () => {
      const { email, password } = await createTestUser({
        status: 'INACTIVE',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(401);

      expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
    });

    // ── Account lockout ──

    it('should increment failedLoginAttempts on wrong password', async () => {
      const { email, userId } = await createTestUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Wrong@1234' })
        .expect(401);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.failedLoginAttempts).toBe(1);
    });

    it('should reset failedLoginAttempts on successful login', async () => {
      const { email, password, userId } = await createTestUser();

      // Fail once
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Wrong@1234' })
        .expect(401);

      // Succeed
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.failedLoginAttempts).toBe(0);
      expect(user!.lockedUntil).toBeNull();
    });

    it('should lock account after 10 failed attempts', async () => {
      const { email, userId } = await createTestUser();

      // Set failedLoginAttempts to 9 directly
      await prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: 9 },
      });

      // The 10th failure should trigger lockout
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Wrong@1234' })
        .expect(401);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.failedLoginAttempts).toBe(10);
      expect(user!.lockedUntil).not.toBeNull();
      expect(user!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should reject login for locked account even with correct password', async () => {
      const { email, password, userId } = await createTestUser();

      // Lock the account
      await prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 10,
          lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(401);

      expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
    });

    it('should allow login after lockout expires', async () => {
      const { email, password, userId } = await createTestUser();

      // Set lockout to the past
      await prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 10,
          lockedUntil: new Date(Date.now() - 1000),
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
    });

    // ── Validation ──

    it('should return 400 when email is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ password: STRONG_PASSWORD })
        .expect(400);
    });

    it('should return 400 for invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-email', password: STRONG_PASSWORD })
        .expect(400);
    });

    it('should return 400 when password is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail() })
        .expect(400);
    });

    it('should return 400 on empty body', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/logout
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/logout', () => {
    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(401);
    });

    it('should logout successfully and return 200', async () => {
      const { token } = await createTestUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);
    });

    it('should clear refresh token in database', async () => {
      const { token, userId } = await createTestUser();

      // Set a refresh token first
      await prisma.user.update({
        where: { id: userId },
        data: { refreshToken: 'some-hash' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.refreshToken).toBeNull();
    });

    it('should clear cookies in the response', async () => {
      const { token } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      const cookies = getCookies(res);
      const cookieStr = cookies.join('; ');
      // Cleared cookies have expired dates or empty values
      expect(cookieStr).toContain('access_token=');
      expect(cookieStr).toContain('refresh_token=');
    });

    it('should return data: null and success message', async () => {
      const { token } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      // ResponseTransformInterceptor wraps controller output:
      // controller returns { data: null, message: 'Logout successful' }
      // interceptor wraps to { data: { data: null, message: 'Logout successful' }, message: 'Success' }
      const controllerOutput = res.body.data?.data ?? res.body.data;
      // controllerOutput is { data: null, message: 'Logout successful' } or null
      // Check that the innermost data is null
      if (controllerOutput && typeof controllerOutput === 'object' && 'data' in controllerOutput) {
        expect(controllerOutput.data).toBeNull();
      } else {
        expect(controllerOutput).toBeNull();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/refresh
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/refresh', () => {
    it('should return 401 without refresh_token cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .expect(401);

      expect(res.body.errorCode).toBe('INVALID_SESSION');
    });

    it('should return 401 with invalid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['refresh_token=invalid-jwt-token'])
        .expect(401);

      expect(res.body.errorCode).toBe('INVALID_SESSION');
    });

    it('should refresh tokens with a valid refresh token', async () => {
      // Register via API to get a real refresh token pair
      const { res: regRes, email } = await registerViaApi();
      const regCookies = getCookies(regRes);
      const refreshCookie = findCookie(regCookies, 'refresh_token');
      expect(refreshCookie).toBeDefined();

      const refreshToken = extractCookieValue(refreshCookie!);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(200);

      const cookies = getCookies(res);
      expect(findCookie(cookies, 'access_token')).toBeDefined();
      expect(findCookie(cookies, 'refresh_token')).toBeDefined();
    });

    it('should rotate the refresh token (issues new cookies)', async () => {
      const { res: regRes } = await registerViaApi();
      const regCookies = getCookies(regRes);
      const oldRefreshToken = extractCookieValue(
        findCookie(regCookies, 'refresh_token')!,
      );

      // Refresh — should succeed and issue new tokens
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${oldRefreshToken}`])
        .expect(200);

      const newCookies = getCookies(res1);
      const newRefreshToken = extractCookieValue(
        findCookie(newCookies, 'refresh_token')!,
      );
      const newAccessToken = extractCookieValue(
        findCookie(newCookies, 'access_token')!,
      );

      // New tokens should be issued
      expect(newRefreshToken).toBeDefined();
      expect(newAccessToken).toBeDefined();

      // The new refresh token should also work
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${newRefreshToken}`])
        .expect(200);

      expect(getCookies(res2).length).toBeGreaterThan(0);
    });

    it('should return 401 if user has no stored refresh token', async () => {
      const { userId } = await createTestUser();

      // Generate a valid JWT for the refresh secret
      const refreshSecret = configService.get<string>('JWT_REFRESH_SECRET');
      const refreshToken = jwtService.sign(
        { sub: userId, email: 'test@test.com', emailVerified: false, onboardingCompleted: false, roles: ['LEARNER'] },
        { secret: refreshSecret, expiresIn: '7d' },
      );

      // User has no refreshToken in DB (null by default)
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`]);
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/forgot-password
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/forgot-password', () => {
    // The forgot-password endpoint has its own internal rate limiting
    // (60s cooldown per email, 5/hour, 10/day per IP). Clear all
    // FORGOT_PASSWORD records before each test to avoid cross-test interference.
    // Also clear Redis so the Redis-backed @nestjs/throttler counter resets —
    // otherwise throttle counts from earlier suites/tests would leak in.
    beforeEach(async () => {
      await prisma.rateLimitedRequest.deleteMany({
        where: { type: 'FORGOT_PASSWORD' },
      });
      if (redis) {
        await redis.flushdb();
      }
    });

    it('should return 200 for existing email (no enumeration)', async () => {
      const { email } = await createTestUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
    });

    it('should return 200 for non-existent email (no enumeration)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nobody-exists@test.local' })
        .expect(200);
    });

    it('should store a hashed reset token in database', async () => {
      const { email, userId } = await createTestUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.passwordResetToken).not.toBeNull();
      expect(user!.passwordResetExpires).not.toBeNull();
      expect(user!.passwordResetExpires!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return consistent message regardless of email existence', async () => {
      // Use fresh users/emails with no prior rate-limit records
      const { email: realEmail } = await createTestUser();
      const fakeEmail = uniqueEmail(); // non-existent

      // Clear any rate-limit records for these emails
      await prisma.rateLimitedRequest.deleteMany({
        where: { email: { in: [realEmail, fakeEmail] } },
      });

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: realEmail });

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: fakeEmail });

      // Both should have the same structure
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    // ── Validation ──

    it('should return 400 when email is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({})
        .expect(400);
    });

    it('should return 400 for invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'not-email' })
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  GET /api/v1/auth/verify-reset-token
  // ═══════════════════════════════════════════════════════════════════

  describe('GET /api/v1/auth/verify-reset-token', () => {
    it('should return 400 for an invalid/missing token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/verify-reset-token')
        .query({ token: 'invalid-token' })
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_RESET_TOKEN');
    });

    it('should return 200 with valid: true for a valid token', async () => {
      const { userId } = await createTestUser();

      // Create a valid reset token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      await prisma.user.update({
        where: { id: userId },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/verify-reset-token')
        .query({ token: rawToken })
        .expect(200);

      const data = res.body.data?.data ?? res.body.data;
      expect(data.valid).toBe(true);
    });

    it('should return 400 for an expired token', async () => {
      const { userId } = await createTestUser();

      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      await prisma.user.update({
        where: { id: userId },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() - 1000), // expired
        },
      });

      await request(app.getHttpServer())
        .get('/api/v1/auth/verify-reset-token')
        .query({ token: rawToken })
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/reset-password
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/reset-password', () => {
    /** Helper: seed a valid reset token for a user */
    async function seedResetToken(userId: string) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');
      await prisma.user.update({
        where: { id: userId },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      return rawToken;
    }

    it('should reset password with a valid token', async () => {
      const { userId } = await createTestUser();
      const rawToken = await seedResetToken(userId);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: STRONG_PASSWORD_ALT })
        .expect(200);

      // Verify password was updated
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const matches = await bcrypt.compare(
        STRONG_PASSWORD_ALT,
        user!.passwordHash,
      );
      expect(matches).toBe(true);
    });

    it('should clear reset token and refresh token after reset', async () => {
      const { userId } = await createTestUser();
      const rawToken = await seedResetToken(userId);

      // Set a refresh token to verify it gets cleared
      await prisma.user.update({
        where: { id: userId },
        data: { refreshToken: 'some-hash' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: STRONG_PASSWORD_ALT })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.passwordResetToken).toBeNull();
      expect(user!.passwordResetExpires).toBeNull();
      expect(user!.refreshToken).toBeNull();
    });

    it('should allow login with the new password', async () => {
      const { email, userId } = await createTestUser();
      const rawToken = await seedResetToken(userId);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: STRONG_PASSWORD_ALT })
        .expect(200);

      // Login with new password
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD_ALT })
        .expect(200);
    });

    it('should reject login with the old password after reset', async () => {
      const { email, userId, password } = await createTestUser();
      const rawToken = await seedResetToken(userId);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: STRONG_PASSWORD_ALT })
        .expect(200);

      // Old password should fail
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(401);
    });

    it('should return 400 for an invalid token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'invalid-token', password: STRONG_PASSWORD_ALT })
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_RESET_TOKEN');
    });

    it('should return 400 for an expired token', async () => {
      const { userId } = await createTestUser();
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      await prisma.user.update({
        where: { id: userId },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() - 1000),
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: STRONG_PASSWORD_ALT })
        .expect(400);
    });

    it('should return 400 when token is a used/consumed token', async () => {
      const { userId } = await createTestUser();
      const rawToken = await seedResetToken(userId);

      // First reset succeeds
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: STRONG_PASSWORD_ALT })
        .expect(200);

      // Second reset with same token fails
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: 'Another@123' })
        .expect(400);
    });

    // ── Validation ──

    it('should return 400 when token is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ password: STRONG_PASSWORD_ALT })
        .expect(400);
    });

    it('should return 400 when password is weak', async () => {
      const { userId } = await createTestUser();
      const rawToken = await seedResetToken(userId);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: 'weak' })
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/send-verification
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/send-verification', () => {
    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification')
        .expect(401);
    });

    it('should send verification code to unverified user', async () => {
      const { token } = await createTestUser({ emailVerified: false });

      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);
    });

    it('should create an EmailVerification record in database', async () => {
      const { token, userId } = await createTestUser({
        emailVerified: false,
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      const verifications = await prisma.emailVerification.findMany({
        where: { userId, used: false },
      });
      expect(verifications.length).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 for already-verified user', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification')
        .set('Cookie', [`access_token=${token}`])
        .expect(400);
    });

    it('should invalidate previous codes when sending a new one', async () => {
      const { token, userId, email } = await createTestUser({
        emailVerified: false,
      });

      // Send first code
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      // Clear internal rate limit records so the second request isn't blocked
      await prisma.rateLimitedRequest.deleteMany({
        where: { email },
      });

      // Send second code
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      // Only one unused code should exist
      const unusedCodes = await prisma.emailVerification.findMany({
        where: { userId, used: false },
      });
      expect(unusedCodes).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/verify-email
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/verify-email', () => {
    /** Helper: create user + seed verification code, return code */
    async function createUserWithVerificationCode() {
      const { userId, email, token } = await createTestUser({
        emailVerified: false,
      });

      const code = '123456';
      const hashedCode = crypto
        .createHash('sha256')
        .update(code)
        .digest('hex');

      await prisma.emailVerification.create({
        data: {
          userId,
          code: hashedCode,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      return { userId, email, token, code };
    }

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ code: '123456' })
        .expect(401);
    });

    it('should verify email with a valid code', async () => {
      const { token, code } = await createUserWithVerificationCode();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code })
        .expect(200);

      const data = res.body.data?.data ?? res.body.data;
      expect(data.emailVerified).toBe(true);
    });

    it('should update user.emailVerified in database', async () => {
      const { token, code, userId } =
        await createUserWithVerificationCode();

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.emailVerified).toBe(true);
    });

    it('should set new cookies with updated emailVerified JWT', async () => {
      const { token, code } = await createUserWithVerificationCode();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code })
        .expect(200);

      const cookies = getCookies(res);
      const accessCookie = findCookie(cookies, 'access_token')!;
      const newToken = extractCookieValue(accessCookie);
      const decoded = jwtService.decode(newToken) as Record<string, unknown>;
      expect(decoded.emailVerified).toBe(true);
    });

    it('should return 400 for incorrect code', async () => {
      const { token } = await createUserWithVerificationCode();

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code: '000000' })
        .expect(400);
    });

    it('should increment attempts on wrong code', async () => {
      const { token, userId } = await createUserWithVerificationCode();

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code: '000000' })
        .expect(400);

      const verif = await prisma.emailVerification.findFirst({
        where: { userId, used: false },
      });
      expect(verif!.attempts).toBe(1);
    });

    it('should invalidate code after 5 failed attempts', async () => {
      const { token, userId, code } =
        await createUserWithVerificationCode();

      // Simulate 5 previous failed attempts (reaching the max)
      await prisma.emailVerification.updateMany({
        where: { userId, used: false },
        data: { attempts: 5 },
      });

      // Next attempt should see attempts >= MAX and return "invalidated"
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code: '000000' })
        .expect(400);

      expect(res.body.message).toContain('invalidated');

      // Even the correct code should now fail (code marked as used)
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code })
        .expect(400);
    });

    it('should return 400 for expired code', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: false,
      });

      const code = '654321';
      const hashedCode = crypto
        .createHash('sha256')
        .update(code)
        .digest('hex');

      await prisma.emailVerification.create({
        data: {
          userId,
          code: hashedCode,
          expiresAt: new Date(Date.now() - 1000), // expired
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code })
        .expect(400);
    });

    it('should return 400 for already-verified user', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({ code: '123456' })
        .expect(400);
    });

    // ── DTO validation ──

    it('should return 400 when code is missing', async () => {
      const { token } = await createTestUser({ emailVerified: false });

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${token}`])
        .send({})
        .expect(400);
    });

    it('should return 400 when code is not exactly 6 digits', async () => {
      const { token } = await createTestUser({ emailVerified: false });

      const invalidCodes = ['12345', '1234567', 'abcdef', '12 34 56'];
      for (const code of invalidCodes) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/verify-email')
          .set('Cookie', [`access_token=${token}`])
          .send({ code })
          .expect(400);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  POST /api/v1/auth/resend-verification
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/resend-verification', () => {
    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .expect(401);
    });

    it('should resend verification code for unverified user', async () => {
      const { token } = await createTestUser({ emailVerified: false });

      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);
    });

    it('should return 400 for already-verified user', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .set('Cookie', [`access_token=${token}`])
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Cross-cutting: JWT payload & cookie security
  // ═══════════════════════════════════════════════════════════════════

  describe('JWT & Cookie Security', () => {
    it('JWT payload from register contains required fields', async () => {
      const { res } = await registerViaApi();
      const cookies = getCookies(res);
      const accessCookie = findCookie(cookies, 'access_token')!;
      const token = extractCookieValue(accessCookie);
      const decoded = jwtService.decode(token) as Record<string, unknown>;

      expect(decoded.sub).toBeDefined();
      expect(decoded.email).toBeDefined();
      expect(decoded.emailVerified).toBe(false);
      expect(decoded.onboardingCompleted).toBe(false);
      expect(decoded.roles).toEqual(expect.arrayContaining(['LEARNER']));
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });

    it('JWT payload from login contains required fields', async () => {
      const { email, password } = await createTestUser({
        emailVerified: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      const cookies = getCookies(res);
      const accessCookie = findCookie(cookies, 'access_token')!;
      const token = extractCookieValue(accessCookie);
      const decoded = jwtService.decode(token) as Record<string, unknown>;

      expect(decoded.sub).toBeDefined();
      expect(decoded.email).toBe(email);
      expect(decoded.emailVerified).toBe(true);
      expect(decoded.roles).toBeDefined();
    });

    it('access_token cookie has correct attributes', async () => {
      const { res } = await registerViaApi();
      const cookies = getCookies(res);
      const accessCookie = findCookie(cookies, 'access_token')!;

      expect(accessCookie).toContain('HttpOnly');
      expect(accessCookie.toLowerCase()).toContain('samesite=strict');
      expect(accessCookie).toContain('Path=/');
    });

    it('refresh_token cookie has restricted path /api/v1/auth', async () => {
      const { res } = await registerViaApi();
      const cookies = getCookies(res);
      const refreshCookie = findCookie(cookies, 'refresh_token')!;

      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('Path=/api/v1/auth');
    });

    it('access_token expires in ~15 minutes', async () => {
      const before = Math.floor(Date.now() / 1000);
      const { res } = await registerViaApi();
      const after = Math.floor(Date.now() / 1000);

      const cookies = getCookies(res);
      const token = extractCookieValue(findCookie(cookies, 'access_token')!);
      const decoded = jwtService.decode(token) as Record<string, unknown>;
      const exp = decoded.exp as number;

      expect(exp).toBeGreaterThanOrEqual(before + 895);
      expect(exp).toBeLessThanOrEqual(after + 905);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Full auth flows (integration)
  // ═══════════════════════════════════════════════════════════════════

  describe('Full Auth Flows', () => {
    it('register → login → logout → login again', async () => {
      const email = uniqueEmail();
      const password = STRONG_PASSWORD;

      // Register
      const regRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'Flow User', email, password })
        .expect(201);

      const regCookies = getCookies(regRes);
      const accessToken = extractCookieValue(
        findCookie(regCookies, 'access_token')!,
      );

      // Logout
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [`access_token=${accessToken}`])
        .expect(200);

      // Login again
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
    });

    it('register → send-verification → verify-email', async () => {
      const email = uniqueEmail();

      // Register
      const regRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'Verify User', email, password: STRONG_PASSWORD })
        .expect(201);

      const cookies = getCookies(regRes);
      const accessToken = extractCookieValue(
        findCookie(cookies, 'access_token')!,
      );
      const decoded = jwtService.decode(accessToken) as Record<
        string,
        unknown
      >;
      const userId = decoded.sub as string;

      // Send verification code
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification')
        .set('Cookie', [`access_token=${accessToken}`])
        .expect(200);

      // Get the code from DB
      const verif = await prisma.emailVerification.findFirst({
        where: { userId, used: false },
        orderBy: { createdAt: 'desc' },
      });
      expect(verif).not.toBeNull();

      // We can't easily reverse the SHA256, but we can seed a known code
      const knownCode = '999888';
      const hashedCode = crypto
        .createHash('sha256')
        .update(knownCode)
        .digest('hex');
      await prisma.emailVerification.update({
        where: { id: verif!.id },
        data: { code: hashedCode },
      });

      // Verify email
      const verifyRes = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Cookie', [`access_token=${accessToken}`])
        .send({ code: knownCode })
        .expect(200);

      const data = verifyRes.body.data?.data ?? verifyRes.body.data;
      expect(data.emailVerified).toBe(true);

      // Confirm in DB
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(user!.emailVerified).toBe(true);
    });

    it('forgot-password → verify-reset-token → reset-password → login', async () => {
      const { email, userId } = await createTestUser();

      // Clear any prior rate-limit records for this email
      await prisma.rateLimitedRequest.deleteMany({
        where: { email },
      });

      // Forgot password
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);

      // Get the token from DB (it's SHA256 hashed, so we need to seed)
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');
      await prisma.user.update({
        where: { id: userId },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      // Verify token
      await request(app.getHttpServer())
        .get('/api/v1/auth/verify-reset-token')
        .query({ token: rawToken })
        .expect(200);

      // Reset password
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, password: STRONG_PASSWORD_ALT })
        .expect(200);

      // Login with new password
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD_ALT })
        .expect(200);
    });

    it('register → refresh → access protected endpoint', async () => {
      const { res: regRes } = await registerViaApi();
      const regCookies = getCookies(regRes);
      const refreshToken = extractCookieValue(
        findCookie(regCookies, 'refresh_token')!,
      );

      // Refresh
      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(200);

      const newCookies = getCookies(refreshRes);
      const newAccessToken = extractCookieValue(
        findCookie(newCookies, 'access_token')!,
      );

      // Access protected endpoint with new token (GET /users/me does not
      // require email verification, so it's a clean check that the token works)
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', [`access_token=${newAccessToken}`])
        .expect(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Edge cases & security
  // ═══════════════════════════════════════════════════════════════════

  describe('Edge Cases & Security', () => {
    it('should not accept expired access_token for protected endpoints', async () => {
      const { userId, email } = await createTestUser();

      // Sign a token that expired 1 hour ago
      const expiredToken = jwtService.sign(
        {
          sub: userId,
          email,
          emailVerified: false,
          onboardingCompleted: false,
          roles: ['LEARNER'],
        },
        { expiresIn: '-1h' },
      );

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [`access_token=${expiredToken}`])
        .expect(401);
    });

    it('should not accept a tampered JWT', async () => {
      const { token } = await createTestUser();
      const tampered = token.slice(0, -5) + 'XXXXX';

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [`access_token=${tampered}`])
        .expect(401);
    });

    it('should accept JWT from Authorization Bearer header', async () => {
      const { token } = await createTestUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('public endpoints should not require JWT', async () => {
      // These public endpoints should be accessible without an access_token JWT.
      // They may return 400 (validation) or 200, but not 401 (unauthorized).
      // Note: /refresh is public (no JWT guard) but returns 401 when no
      // refresh_token cookie is present — that's service-level auth, not guard-level.
      const publicEndpoints = [
        { method: 'post', path: '/api/v1/auth/login' },
        { method: 'post', path: '/api/v1/auth/forgot-password' },
        { method: 'get', path: '/api/v1/auth/verify-reset-token' },
        { method: 'post', path: '/api/v1/auth/reset-password' },
      ];

      for (const ep of publicEndpoints) {
        const res = await (request(app.getHttpServer()) as any)[ep.method](
          ep.path,
        ).send({});
        // Should NOT be 401 (may be 400 for validation, but not unauthorized)
        expect(res.status).not.toBe(401);
      }
    });

    it('protected endpoints should return 401 without JWT', async () => {
      const protectedEndpoints = [
        '/api/v1/auth/logout',
        '/api/v1/auth/send-verification',
        '/api/v1/auth/verify-email',
        '/api/v1/auth/resend-verification',
      ];

      for (const path of protectedEndpoints) {
        await request(app.getHttpServer())
          .post(path)
          .send({})
          .expect(401);
      }
    });

    it('response should never contain passwordHash', async () => {
      // Register
      const { res: regRes, email } = await registerViaApi();
      expect(JSON.stringify(regRes.body)).not.toContain('passwordHash');

      // Login
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD });
      expect(JSON.stringify(loginRes.body)).not.toContain('passwordHash');
    });

    it('500 errors should not leak internal details', async () => {
      // Mock a DB failure during login
      jest
        .spyOn(prisma.user, 'findUnique')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail(), password: STRONG_PASSWORD });

      expect(res.status).toBe(500);
      expect(res.body.message).not.toContain('ECONNREFUSED');
    });
  });
});
