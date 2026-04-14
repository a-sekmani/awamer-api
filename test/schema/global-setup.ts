import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { resolveTestDatabaseUrl } from './setup';

export default async function globalSetup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = url;

  // Ensure the test database exists by connecting to the admin `postgres` DB.
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, '');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';

  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl.toString() } },
  });
  try {
    const rows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${dbName}') AS exists`,
    );
    if (!rows[0]?.exists) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  // Apply migrations against the test DB.
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
