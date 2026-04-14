import { PrismaClient } from '@prisma/client';

export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL_TEST;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL or DATABASE_URL_TEST must be set');
  }

  // Append _test to the database name segment — but only if not already suffixed.
  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '');
  if (dbName.endsWith('_test')) return base;
  url.pathname = `/${dbName}_test`;
  return url.toString();
}

const TEST_DATABASE_URL = resolveTestDatabaseUrl();
process.env.DATABASE_URL = TEST_DATABASE_URL;

export const prisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

// All tables except _prisma_migrations — TRUNCATE CASCADE between cases.
const TABLES = [
  'last_positions',
  'certificates',
  'path_progress',
  'course_progress',
  'section_progress',
  'lesson_progress',
  'quiz_attempts',
  'options',
  'questions',
  'quizzes',
  'project_submissions',
  'projects',
  'lesson_content_blocks',
  'lessons',
  'sections',
  'course_enrollments',
  'path_enrollments',
  'course_tags',
  'path_tags',
  'testimonials',
  'faqs',
  'features',
  'courses',
  'paths',
  'tags',
  'categories',
  'email_verifications',
  'rate_limited_requests',
  'onboarding_responses',
  'user_roles',
  'user_profiles',
  'payments',
  'subscriptions',
  'subscription_plans',
  'users',
];

export async function truncateAll(): Promise<void> {
  const quoted = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
}
