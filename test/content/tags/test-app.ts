import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../../src/app.module';

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
