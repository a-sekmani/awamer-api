import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { AppModule } from '../../../src/app.module';
import { REDIS_CLIENT } from '../../../src/common/cache/redis.provider';

/**
 * Build an end-to-end test app against the `awamer_test` database using the
 * real auth stack. `JwtStrategy.validate()` does not hit the database, so a
 * JWT signed with the test `JWT_SECRET` is enough to authenticate as any
 * user shape we choose. `RolesGuard` in `src/common/guards/roles.guard.ts` is
 * currently a stub that always allows — so any authenticated user passes the
 * admin role check, which matches the "admin guard is a placeholder" branch
 * from KAN-71 §7.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  adminBearer: string;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();

  // Clear Redis state left over from previous test runs. In the test environment
  // REDIS_URL points at the local docker-compose Redis; flushdb() only wipes the
  // current logical DB (DB 0), not the whole server. Safe because this bootstrap
  // is only ever used by e2e specs, never by production code.
  try {
    const redis = app.get<Redis>(REDIS_CLIENT);
    await redis.flushdb();
  } catch (error) {
    // CacheModule may not be loaded in some test setups — that's fine.

    console.warn(
      `Redis flushdb skipped in test bootstrap: ${(error as Error).message}`,
    );
  }

  const jwt = app.get(JwtService);
  const token = jwt.sign({
    sub: '00000000-0000-0000-0000-000000000001',
    email: 'admin@awamer.test',
    emailVerified: true,
    onboardingCompleted: true,
    roles: ['admin'],
  });

  return { app, adminBearer: `Bearer ${token}` };
}
