import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from './../src/app.module';

/**
 * App-level smoke tests. The original boilerplate tested `GET /` →
 * "Hello World!", but the project has no such endpoint and uses the
 * `api/v1` global prefix, so the boilerplate could never pass. This file
 * now bootstraps the app the same way `main.ts` does (global prefix,
 * cookie-parser, ValidationPipe) and exercises the public health route.
 */
describe('App (e2e)', () => {
  let app: INestApplication;
  let throttlerSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror main.ts setup so the test app behaves like production
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

    // ThrottlerGuard is registered globally as APP_GUARD, so override at
    // the prototype level (the same trick onboarding/auth e2e specs use).
    throttlerSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
  });

  afterAll(async () => {
    throttlerSpy?.mockRestore();
    await app.close();
  });

  it('GET /api/v1/health returns 200 with status ok', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    // The global ResponseTransformInterceptor wraps payloads in
    // `{ data, message: 'Success' }`. The HealthController returns
    // `{ status: 'ok' }` which becomes the wrapper's `data`.
    expect(res.body).toBeDefined();
    expect(res.body.data).toEqual({ status: 'ok' });
  });

  it('GET / (no prefix) returns 404 — confirms global prefix is active', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  it('GET /api/v1/users/me without a token returns 401 — confirms JwtAuthGuard is wired globally', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
  });
});
