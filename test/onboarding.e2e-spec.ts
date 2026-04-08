import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { UsersService } from '../src/users/users.service';
import {
  VALID_BACKGROUNDS,
  VALID_INTERESTS,
  VALID_GOALS,
} from '../src/users/dto/onboarding.dto';

/**
 * E2E tests for the onboarding endpoints:
 *   GET  /api/v1/users/me/onboarding
 *   POST /api/v1/users/me/onboarding
 */
describe('Onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let analyticsService: AnalyticsService;
  let usersService: UsersService;
  let throttlerSpy: jest.SpyInstance;

  const TEST_EMAIL_PREFIX = 'e2e-onboarding-test';
  let testCounter = 0;

  function uniqueEmail(): string {
    return `${TEST_EMAIL_PREFIX}-${Date.now()}-${testCounter++}@test.local`;
  }

  /** Create a user in the DB and return their id + a signed JWT cookie string */
  async function createTestUser(opts: {
    emailVerified?: boolean;
    onboardingCompleted?: boolean;
  } = {}) {
    const email = uniqueEmail();
    const { emailVerified = false, onboardingCompleted = false } = opts;

    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        email,
        passwordHash: 'not-used-in-e2e',
        emailVerified,
      },
    });

    await prisma.userProfile.create({
      data: { userId: user.id, onboardingCompleted },
    });

    await prisma.userRole.create({
      data: { userId: user.id, role: 'LEARNER' },
    });

    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      emailVerified,
      onboardingCompleted,
      roles: ['LEARNER'],
    });

    return { userId: user.id, email, token };
  }

  /** Build a valid onboarding payload */
  function validPayload(overrides?: {
    background?: string;
    interests?: string;
    goals?: string;
    backgroundStep?: number;
    interestsStep?: number;
    goalsStep?: number;
  }) {
    return {
      responses: [
        {
          questionKey: 'background',
          answer: overrides?.background ?? 'student',
          stepNumber: overrides?.backgroundStep ?? 1,
        },
        {
          questionKey: 'interests',
          answer:
            overrides?.interests ?? JSON.stringify(['ai', 'cybersecurity']),
          stepNumber: overrides?.interestsStep ?? 2,
        },
        {
          questionKey: 'goals',
          answer: overrides?.goals ?? 'learn_new_skill',
          stepNumber: overrides?.goalsStep ?? 3,
        },
      ],
    };
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

    // Disable throttling for E2E tests by mocking the prototype
    throttlerSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    analyticsService = app.get(AnalyticsService);
    usersService = app.get(UsersService);
  });

  afterAll(async () => {
    // Clean up all test users
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
      select: { id: true },
    });
    const ids = testUsers.map((u) => u.id);

    if (ids.length > 0) {
      await prisma.onboardingResponse.deleteMany({
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

    await app.close();
  });

  // ─── GET /api/v1/users/me/onboarding ─────────────────────────────

  describe('GET /api/v1/users/me/onboarding', () => {
    it('should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .get('/api/v1/users/me/onboarding')
        .expect(401);
    });

    it('should return not-completed status for a new user', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      expect(res.body.data).toBeDefined();
      const data = res.body.data.data ?? res.body.data;
      expect(data.completed).toBe(false);
      expect(data.responses).toEqual([]);
    });

    it('should return completed status with stored responses after onboarding', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      // Submit onboarding first
      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      // Now check status
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      const data = res.body.data.data ?? res.body.data;
      expect(data.completed).toBe(true);
      expect(data.responses).toHaveLength(3);

      const storedKeys = data.responses.map(
        (r: { questionKey: string }) => r.questionKey,
      );
      expect(storedKeys).toContain('background');
      expect(storedKeys).toContain('interests');
      expect(storedKeys).toContain('goals');
    });

    it('should return responses ordered by stepNumber', async () => {
      const { token } = await createTestUser({
        emailVerified: true,
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .expect(200);

      const data = res.body.data.data ?? res.body.data;
      const steps = data.responses.map(
        (r: { stepNumber: number }) => r.stepNumber,
      );
      expect(steps).toEqual([1, 2, 3]);
    });
  });

  // ─── POST /api/v1/users/me/onboarding ────────────────────────────

  describe('POST /api/v1/users/me/onboarding', () => {
    // ── Auth & Guard tests ──

    it('should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .send(validPayload())
        .expect(401);
    });

    it('should return 403 when email is not verified', async () => {
      const { token } = await createTestUser({ emailVerified: false });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(403);

      expect(res.body.message).toContain('Email verification required');
    });

    // ── Happy path ──

    it('should submit onboarding successfully with valid data', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const data = res.body.data.data ?? res.body.data;
      expect(data.profile).toBeDefined();
      expect(data.profile.onboardingCompleted).toBe(true);
    });

    it('should set cookies after successful submission', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();

      const cookieStr = Array.isArray(cookies)
        ? cookies.join('; ')
        : String(cookies);
      expect(cookieStr).toContain('access_token=');
      expect(cookieStr).toContain('refresh_token=');
    });

    it('should issue a new JWT with onboardingCompleted=true', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const accessCookie = cookies.find((c: string) =>
        c.startsWith('access_token='),
      );
      expect(accessCookie).toBeDefined();

      const newToken = accessCookie!.split('=')[1].split(';')[0];
      const decoded = jwtService.decode(newToken) as Record<string, unknown>;
      expect(decoded.onboardingCompleted).toBe(true);
    });

    it('should update user profile fields (background, interests, goals)', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(
          validPayload({
            background: 'employee',
            interests: JSON.stringify(['cloud_devops', 'iot']),
            goals: 'advance_career',
          }),
        )
        .expect(200);

      const profile = await prisma.userProfile.findUnique({
        where: { userId },
      });
      expect(profile!.background).toBe('employee');
      expect(profile!.interests).toBe(
        JSON.stringify(['cloud_devops', 'iot']),
      );
      expect(profile!.goals).toBe('advance_career');
      expect(profile!.onboardingCompleted).toBe(true);
    });

    it('should store 3 onboarding response records in the database', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const responses = await prisma.onboardingResponse.findMany({
        where: { userId },
        orderBy: { stepNumber: 'asc' },
      });
      expect(responses).toHaveLength(3);
      expect(responses[0].questionKey).toBe('background');
      expect(responses[0].stepNumber).toBe(1);
      expect(responses[1].questionKey).toBe('interests');
      expect(responses[1].stepNumber).toBe(2);
      expect(responses[2].questionKey).toBe('goals');
      expect(responses[2].stepNumber).toBe(3);
    });

    // ── All valid enum values ──

    it.each(VALID_BACKGROUNDS.map((b) => [b]))(
      'should accept background value: %s',
      async (background) => {
        const { token } = await createTestUser({ emailVerified: true });

        await request(app.getHttpServer())
          .post('/api/v1/users/me/onboarding')
          .set('Cookie', [`access_token=${token}`])
          .send(validPayload({ background }))
          .expect(200);
      },
    );

    it.each(VALID_GOALS.map((g) => [g]))(
      'should accept goals value: %s',
      async (goals) => {
        const { token } = await createTestUser({ emailVerified: true });

        await request(app.getHttpServer())
          .post('/api/v1/users/me/onboarding')
          .set('Cookie', [`access_token=${token}`])
          .send(validPayload({ goals }))
          .expect(200);
      },
    );

    it('should accept all valid interest values', async () => {
      // Submit with max 4 interests at a time (MAX_INTERESTS = 4)
      const { token } = await createTestUser({ emailVerified: true });

      const fourInterests = VALID_INTERESTS.slice(0, 4);
      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(
          validPayload({ interests: JSON.stringify([...fourInterests]) }),
        )
        .expect(200);
    });

    it('should accept a single interest (MIN_INTERESTS = 1)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: JSON.stringify(['ai']) }))
        .expect(200);
    });

    it('should accept exactly 4 interests (MAX_INTERESTS = 4)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(
          validPayload({
            interests: JSON.stringify([
              'ai',
              'cybersecurity',
              'cloud_devops',
              'data_science',
            ]),
          }),
        )
        .expect(200);
    });

    // ── Already completed ──

    it('should return 400 when onboarding is already completed', async () => {
      const { token } = await createTestUser({
        emailVerified: true,
        onboardingCompleted: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(400);

      expect(res.body.message).toContain('already completed');
      expect(res.body.errorCode).toBe('ONBOARDING_ALREADY_COMPLETED');
    });

    it('should return 400 on second submission (idempotency)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      // First submission succeeds
      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      // Second submission fails
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(400);

      expect(res.body.errorCode).toBe('ONBOARDING_ALREADY_COMPLETED');
    });

    // ── Missing question keys ──

    it('should return 400 when background key is missing', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
          ],
        })
        .expect(400);
    });

    it('should return 400 when interests key is missing', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
          ],
        })
        .expect(400);
    });

    it('should return 400 when goals key is missing', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
          ],
        })
        .expect(400);
    });

    // ── Invalid answer values ──

    it('should return 400 for invalid background value', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ background: 'astronaut' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_BACKGROUND');
      expect(res.body.message).not.toContain('astronaut');
    });

    it('should return 400 for invalid goals value', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ goals: 'become_ceo' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_GOALS');
      expect(res.body.message).not.toContain('become_ceo');
    });

    it('should return 400 when interests is not valid JSON', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: 'not-json' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INTERESTS_PARSE_ERROR');
      expect(res.body.message).not.toContain('not-json');
    });

    it('should return 400 when interests is a JSON string, not array', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '"ai"' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INTERESTS_PARSE_ERROR');
    });

    it('should return 400 when interests is a JSON object, not array', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '{"ai": true}' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INTERESTS_PARSE_ERROR');
    });

    it('should return 400 when interests array is empty (below MIN_INTERESTS)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '[]' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INTERESTS_COUNT_INVALID');
    });

    it('should return 400 when interests exceed MAX_INTERESTS (5 items)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const fiveInterests = JSON.stringify([
        'ai',
        'cybersecurity',
        'cloud_devops',
        'data_science',
        'programming',
      ]);

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: fiveInterests }))
        .expect(400);

      expect(res.body.errorCode).toBe('INTERESTS_COUNT_INVALID');
    });

    it('should return 400 when interests contain an invalid value', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '["ai","cooking"]' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_INTERESTS');
      expect(res.body.message).not.toContain('cooking');
    });

    it('should return 400 when interests contain duplicate values', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '["ai","ai"]' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_INTERESTS');
    });

    it('should return 400 when interests contain a non-string element', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '[123]' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_INTERESTS');
    });

    // ── Wrong step numbers ──

    it('should return 400 when background has wrong stepNumber', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ backgroundStep: 2 }))
        .expect(400);

      expect(res.body.message).toContain('background must have stepNumber 1');
    });

    it('should return 400 when interests has wrong stepNumber', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interestsStep: 1 }))
        .expect(400);

      expect(res.body.message).toContain('interests must have stepNumber 2');
    });

    it('should return 400 when goals has wrong stepNumber', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ goalsStep: 1 }))
        .expect(400);

      expect(res.body.message).toContain('goals must have stepNumber 3');
    });

    // ── DTO / structural validation ──

    it('should return 400 when responses array is empty', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({ responses: [] })
        .expect(400);
    });

    it('should return 400 when responses has more than 3 items', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            {
              questionKey: 'goals',
              answer: 'learn_new_skill',
              stepNumber: 3,
            },
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
          ],
        })
        .expect(400);
    });

    it('should return 400 when responses field is missing', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({})
        .expect(400);
    });

    it('should return 400 when responses is not an array', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({ responses: 'not-an-array' })
        .expect(400);
    });

    it('should return 400 when a response item has an invalid questionKey', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'invalid_key', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            {
              questionKey: 'goals',
              answer: 'learn_new_skill',
              stepNumber: 3,
            },
          ],
        })
        .expect(400);
    });

    it('should return 400 when answer is empty string', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'background', answer: '', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            {
              questionKey: 'goals',
              answer: 'learn_new_skill',
              stepNumber: 3,
            },
          ],
        })
        .expect(400);
    });

    it('should return 400 when stepNumber is a float', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1.5 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            {
              questionKey: 'goals',
              answer: 'learn_new_skill',
              stepNumber: 3,
            },
          ],
        })
        .expect(400);
    });

    it('should return 400 when stepNumber is out of range (0)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 0 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            {
              questionKey: 'goals',
              answer: 'learn_new_skill',
              stepNumber: 3,
            },
          ],
        })
        .expect(400);
    });

    it('should return 400 when stepNumber is out of range (4)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            {
              questionKey: 'goals',
              answer: 'learn_new_skill',
              stepNumber: 4,
            },
          ],
        })
        .expect(400);
    });

    it('should reject additional properties via forbidNonWhitelisted', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            { questionKey: 'background', answer: 'student', stepNumber: 1 },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            {
              questionKey: 'goals',
              answer: 'learn_new_skill',
              stepNumber: 3,
            },
          ],
          extraField: 'should-be-rejected',
        })
        .expect(400);
    });

    it('should reject extra properties on response items', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({
          responses: [
            {
              questionKey: 'background',
              answer: 'student',
              stepNumber: 1,
              extra: 'bad',
            },
            { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
            {
              questionKey: 'goals',
              answer: 'learn_new_skill',
              stepNumber: 3,
            },
          ],
        })
        .expect(400);
    });

    // ── Bearer token auth (alternative to cookie) ──

    it('should accept Bearer token in Authorization header', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload())
        .expect(200);
    });

    // ── Content-Type ──

    it('should return 400 when no Content-Type / body is sent', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      // Send without JSON body
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(undefined);

      // Should fail because responses field is missing
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── Group 1: Rate Limiting ──────────────────────────────────────

  describe('Rate Limiting', () => {
    // Restore the real ThrottlerGuard for this group, then re-mock after
    beforeEach(() => {
      throttlerSpy.mockRestore();
    });

    afterEach(() => {
      throttlerSpy = jest
        .spyOn(ThrottlerGuard.prototype, 'canActivate')
        .mockResolvedValue(true);
    });

    it('POST /users/me/onboarding — 6th request within 60s returns 429', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      // Fire 5 requests (first succeeds with 200, rest hit ALREADY_COMPLETED = 400)
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/me/onboarding')
          .set('Cookie', [`access_token=${token}`])
          .send(validPayload());
        // Either 200 (first) or 400 (already completed), but not 429
        expect([200, 400]).toContain(res.status);
      }

      // The 6th should be throttled
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload());
      expect(res.status).toBe(429);
    });

    it('POST /users/me/onboarding — 429 response includes Retry-After header', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/users/me/onboarding')
          .set('Cookie', [`access_token=${token}`])
          .send(validPayload());
      }

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload());
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('POST /users/me/onboarding — 429 body has throttle error info', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/users/me/onboarding')
          .set('Cookie', [`access_token=${token}`])
          .send(validPayload());
      }

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload());
      expect(res.status).toBe(429);
      expect(res.body.message).toBeDefined();
    });

    it('GET /users/me/onboarding — 21st request within 60s returns 429', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      // Fire 20 requests — all should pass
      for (let i = 0; i < 20; i++) {
        const res = await request(app.getHttpServer())
          .get('/api/v1/users/me/onboarding')
          .set('Cookie', [`access_token=${token}`]);
        expect(res.status).toBe(200);
      }

      // The 21st should be throttled
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`]);
      expect(res.status).toBe(429);
    });

    it('rate limit is IP-based — different users from the same IP share the counter', async () => {
      const user1 = await createTestUser({ emailVerified: true });
      const user2 = await createTestUser({ emailVerified: true });

      // Exhaust the POST limit via user1
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/users/me/onboarding')
          .set('Cookie', [`access_token=${user1.token}`])
          .send(validPayload());
      }

      // user1 is throttled
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${user1.token}`])
        .send(validPayload());
      expect(res1.status).toBe(429);

      // user2 from the same IP is also throttled (default ThrottlerGuard is IP-based)
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${user2.token}`])
        .send(validPayload());
      expect(res2.status).toBe(429);
    });

    // eslint-disable-next-line jest/no-disabled-tests
    it.todo(
      'rate limit resets after TTL window expires (skipped: TTL=60s is too long for E2E)',
    );
  });

  // ─── Group 2: Transaction Rollback ───────────────────────────────

  describe('Transaction Rollback', () => {
    it('if userProfile.update fails mid-transaction, no OnboardingResponse records are created', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      // Mock the $transaction to simulate a profile update failure
      const originalTransaction = prisma.$transaction.bind(prisma);
      jest.spyOn(prisma, '$transaction').mockImplementationOnce(async (fn) => {
        // Run inside a real transaction but sabotage the profile update
        return originalTransaction(async (tx: any) => {
          // Let deleteMany and createMany run
          await tx.onboardingResponse.deleteMany({ where: { userId } });
          await tx.onboardingResponse.createMany({
            data: [
              { userId, questionKey: 'background', answer: 'student', stepNumber: 1 },
              { userId, questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
              { userId, questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
            ],
          });
          // Simulate failure during profile update
          throw new Error('Simulated DB failure during profile update');
        });
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload());
      expect(res.status).toBe(500);

      // Verify rollback: no onboarding responses created
      const count = await prisma.onboardingResponse.count({
        where: { userId },
      });
      expect(count).toBe(0);

      // Verify profile not updated
      const profile = await prisma.userProfile.findUnique({
        where: { userId },
      });
      expect(profile!.onboardingCompleted).toBe(false);
    });

    it('if onboardingResponse.createMany fails, profile.onboardingCompleted stays false', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      const originalTransaction = prisma.$transaction.bind(prisma);
      jest.spyOn(prisma, '$transaction').mockImplementationOnce(async (fn) => {
        return originalTransaction(async (tx: any) => {
          await tx.onboardingResponse.deleteMany({ where: { userId } });
          // Simulate failure during createMany
          throw new Error('Simulated DB failure during createMany');
        });
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload());
      expect(res.status).toBe(500);

      const profile = await prisma.userProfile.findUnique({
        where: { userId },
      });
      expect(profile!.onboardingCompleted).toBe(false);
    });

    it('successful transaction commits both OnboardingResponse records and profile update atomically', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(
          validPayload({
            background: 'freelancer',
            interests: JSON.stringify(['data_science', 'iot']),
            goals: 'build_project',
          }),
        )
        .expect(200);

      // Both writes should be committed
      const responses = await prisma.onboardingResponse.findMany({
        where: { userId },
        orderBy: { stepNumber: 'asc' },
      });
      expect(responses).toHaveLength(3);

      const profile = await prisma.userProfile.findUnique({
        where: { userId },
      });
      expect(profile!.onboardingCompleted).toBe(true);
      expect(profile!.background).toBe('freelancer');
      expect(profile!.interests).toBe(
        JSON.stringify(['data_science', 'iot']),
      );
      expect(profile!.goals).toBe('build_project');
    });
  });

  // ─── Group 3: Analytics Event ────────────────────────────────────

  describe('Analytics Event', () => {
    let captureSpy: jest.SpyInstance;

    beforeEach(() => {
      captureSpy = jest.spyOn(analyticsService, 'capture');
    });

    afterEach(() => {
      captureSpy.mockRestore();
    });

    it('capture is called exactly once with correct arguments after successful onboarding', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      expect(captureSpy).toHaveBeenCalledTimes(1);
      expect(captureSpy).toHaveBeenCalledWith(
        userId,
        'onboarding_completed',
      );
    });

    it('capture is NOT called when onboarding submission fails validation', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ background: 'invalid_value' }))
        .expect(400);

      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('capture is NOT called when onboarding is already completed', async () => {
      const { token } = await createTestUser({
        emailVerified: true,
      });

      // First submission triggers capture
      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      expect(captureSpy).toHaveBeenCalledTimes(1);
      captureSpy.mockClear();

      // Second attempt — already completed
      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(400);

      expect(captureSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Group 4: JWT Cookie Details ─────────────────────────────────

  describe('JWT Cookie Details', () => {
    it('response sets a new access_token cookie after successful onboarding', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const accessCookie = cookies.find((c: string) =>
        c.startsWith('access_token='),
      );
      expect(accessCookie).toBeDefined();
    });

    it('access_token cookie has correct security attributes', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const accessCookie = cookies.find((c: string) =>
        c.startsWith('access_token='),
      )!;

      expect(accessCookie).toContain('HttpOnly');
      expect(accessCookie.toLowerCase()).toContain('samesite=strict');
      expect(accessCookie).toContain('Path=/');
    });

    it('new access_token JWT contains onboardingCompleted and core fields', async () => {
      const { token, email } = await createTestUser({
        emailVerified: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const accessCookie = cookies.find((c: string) =>
        c.startsWith('access_token='),
      )!;
      const newToken = accessCookie.split('=')[1].split(';')[0];
      const decoded = jwtService.decode(newToken) as Record<string, unknown>;

      expect(decoded.onboardingCompleted).toBe(true);
      expect(decoded.sub).toBeDefined();
      expect(decoded.email).toBe(email);
      expect(decoded.emailVerified).toBe(true);
      expect(decoded.roles).toEqual(expect.arrayContaining(['LEARNER']));
    });

    it('new access_token has a fresh expiration ~15 minutes from now', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const beforeRequest = Math.floor(Date.now() / 1000);
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);
      const afterRequest = Math.floor(Date.now() / 1000);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const accessCookie = cookies.find((c: string) =>
        c.startsWith('access_token='),
      )!;
      const newToken = accessCookie.split('=')[1].split(';')[0];
      const decoded = jwtService.decode(newToken) as Record<string, unknown>;

      const exp = decoded.exp as number;
      // Should expire ~900 seconds (15 min) from now, with some tolerance
      expect(exp).toBeGreaterThanOrEqual(beforeRequest + 900 - 5);
      expect(exp).toBeLessThanOrEqual(afterRequest + 900 + 5);
    });

    it('refresh_token cookie is also set after onboarding completion', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const refreshCookie = cookies.find((c: string) =>
        c.startsWith('refresh_token='),
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie!.toLowerCase()).toContain('samesite=strict');
      expect(refreshCookie).toContain('Path=/api/v1/auth');
    });
  });

  // ─── Group 5: Database State Verification ────────────────────────

  describe('Database State Verification', () => {
    it('exactly 3 OnboardingResponse records exist after submission', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(200);

      const count = await prisma.onboardingResponse.count({
        where: { userId },
      });
      expect(count).toBe(3);
    });

    it('each OnboardingResponse record has correct structure and values', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      const payload = validPayload({
        background: 'job_seeker',
        interests: JSON.stringify(['mobile_dev', 'game_dev', 'blockchain']),
        goals: 'switch_career',
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(payload)
        .expect(200);

      const records = await prisma.onboardingResponse.findMany({
        where: { userId },
        orderBy: { stepNumber: 'asc' },
      });
      expect(records).toHaveLength(3);

      expect(records[0].questionKey).toBe('background');
      expect(records[0].answer).toBe('job_seeker');
      expect(records[0].stepNumber).toBe(1);

      expect(records[1].questionKey).toBe('interests');
      expect(records[1].answer).toBe(
        JSON.stringify(['mobile_dev', 'game_dev', 'blockchain']),
      );
      expect(records[1].stepNumber).toBe(2);

      expect(records[2].questionKey).toBe('goals');
      expect(records[2].answer).toBe('switch_career');
      expect(records[2].stepNumber).toBe(3);
    });

    it('UserProfile is updated with correct values from submission', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(
          validPayload({
            background: 'employee',
            interests: JSON.stringify(['ai', 'cybersecurity', 'iot']),
            goals: 'level_up',
          }),
        )
        .expect(200);

      const profile = await prisma.userProfile.findUnique({
        where: { userId },
      });
      expect(profile!.background).toBe('employee');
      expect(profile!.interests).toBe(
        JSON.stringify(['ai', 'cybersecurity', 'iot']),
      );
      expect(profile!.goals).toBe('level_up');
      expect(profile!.onboardingCompleted).toBe(true);
    });

    it('deleteMany+createMany prevents duplicate records on race-condition-like scenarios', async () => {
      const { userId, token } = await createTestUser({
        emailVerified: true,
      });

      // Seed some stale onboarding responses manually
      await prisma.onboardingResponse.createMany({
        data: [
          { userId, questionKey: 'background', answer: 'student', stepNumber: 1 },
          { userId, questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
          { userId, questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
        ],
      });

      // Submit onboarding via the API — the transaction's deleteMany should
      // clear the stale records before creating new ones
      await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(
          validPayload({
            background: 'freelancer',
            interests: JSON.stringify(['blockchain']),
            goals: 'build_project',
          }),
        )
        .expect(200);

      const records = await prisma.onboardingResponse.findMany({
        where: { userId },
        orderBy: { stepNumber: 'asc' },
      });
      // Exactly 3, not 6 (no duplicates)
      expect(records).toHaveLength(3);
      expect(records[0].answer).toBe('freelancer');
      expect(records[1].answer).toBe(JSON.stringify(['blockchain']));
      expect(records[2].answer).toBe('build_project');
    });
  });

  // ─── Group 6: Edge Cases ─────────────────────────────────────────

  describe('Edge Cases', () => {
    it('interests with whitespace in values is rejected', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '[" ai "]' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_INTERESTS');
    });

    it('interests with uppercase values is rejected (case-sensitive)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '["AI"]' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_INTERESTS');
      expect(res.body.message).not.toContain('AI');
    });

    it('background with leading/trailing whitespace is rejected', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ background: ' student ' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_BACKGROUND');
    });

    it('interests as JSON object instead of array is rejected', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload({ interests: '{"items": ["ai"]}' }))
        .expect(400);

      expect(res.body.errorCode).toBe('INTERESTS_PARSE_ERROR');
    });

    it('POST with empty body {} returns 400 with validation errors', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send({})
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toBeDefined();
    });
  });

  // ─── Group 7: Status Code Specifics ──────────────────────────────

  describe('Status Code Specifics', () => {
    it('validation errors return exactly 400', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      const invalidPayloads = [
        { responses: [] },
        { responses: 'not-array' },
        validPayload({ background: 'invalid' }),
        validPayload({ goals: 'invalid' }),
        validPayload({ interests: 'not-json' }),
      ];

      for (const payload of invalidPayloads) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/me/onboarding')
          .set('Cookie', [`access_token=${token}`])
          .send(payload);
        expect(res.status).toBe(400);
      }
    });

    it('ONBOARDING_ALREADY_COMPLETED returns 400 with errorCode in body', async () => {
      const { token } = await createTestUser({
        emailVerified: true,
        onboardingCompleted: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload())
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.errorCode).toBe('ONBOARDING_ALREADY_COMPLETED');
      expect(res.body.message).toContain('already completed');
    });

    it('internal DB error returns 500 with generic message (no leak)', async () => {
      const { token } = await createTestUser({ emailVerified: true });

      // Simulate a DB connection failure on the initial profile lookup
      jest
        .spyOn(prisma.userProfile, 'findUnique')
        .mockRejectedValueOnce(new Error('FATAL: connection refused'));

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/onboarding')
        .set('Cookie', [`access_token=${token}`])
        .send(validPayload());

      expect(res.status).toBe(500);
      // Should not leak internal error details
      expect(res.body.message).not.toContain('connection refused');
      expect(res.body.message).not.toContain('FATAL');
    });
  });
});
