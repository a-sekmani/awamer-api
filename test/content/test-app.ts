import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { REDIS_CLIENT } from '../../src/common/cache/redis.provider';

/**
 * Shared e2e bootstrap for KAN-26 public discovery suites.
 * Mirrors test/content/tags/test-app.ts (frozen — KAN-71) but lives one
 * directory up so categories/, paths/, and courses/ specs can reuse it
 * without duplicating module compilation.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
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

  // Clear any Redis state left by prior runs (FR-038, KAN-74 lesson).
  try {
    const redis = app.get<Redis>(REDIS_CLIENT);
    await redis.flushdb();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `Redis flushdb skipped in test bootstrap: ${(err as Error).message}`,
    );
  }

  return { app };
}
