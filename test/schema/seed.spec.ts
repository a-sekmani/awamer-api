import { execSync } from 'child_process';
import { prisma, truncateAll } from './setup';
import { TestimonialStatus, CertificateType } from '@prisma/client';

function runSeed(): void {
  execSync('npx prisma db seed', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
  });
}

const PATH_ID = 'seed-path-1';
const STANDALONE_COURSE_ID = 'seed-course-standalone-1';

describe('Seed script', () => {
  beforeAll(async () => {
    await truncateAll();
    runSeed();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('populates path with all relations', async () => {
    const p = await prisma.path.findUnique({
      where: { id: PATH_ID },
      include: {
        courses: true,
        tags: true,
        category: true,
      },
    });
    expect(p).toBeTruthy();
    expect(p?.subtitle).toBeTruthy();
    expect(p?.promoVideoUrl).toBeTruthy();
    expect(p?.isNew).toBe(true);
    expect(Array.isArray(p?.skills)).toBe(true);
    expect((p?.skills as string[]).length).toBeGreaterThanOrEqual(4);
    expect(p?.tags.length).toBeGreaterThanOrEqual(3);
    expect(p?.courses.length).toBeGreaterThanOrEqual(2);

    const features = await prisma.feature.findMany({ where: { ownerId: PATH_ID } });
    const faqs = await prisma.faq.findMany({ where: { ownerId: PATH_ID } });
    const testimonials = await prisma.testimonial.findMany({ where: { ownerId: PATH_ID } });
    expect(features.length).toBeGreaterThanOrEqual(3);
    expect(faqs.length).toBeGreaterThanOrEqual(3);
    expect(testimonials.length).toBeGreaterThanOrEqual(3);
  });

  it('APPROVED filter excludes pending/hidden testimonials on path', async () => {
    const approved = await prisma.testimonial.findMany({
      where: { ownerId: PATH_ID, status: TestimonialStatus.APPROVED },
    });
    const pending = await prisma.testimonial.findMany({
      where: { ownerId: PATH_ID, status: TestimonialStatus.PENDING },
    });
    const hidden = await prisma.testimonial.findMany({
      where: { ownerId: PATH_ID, status: TestimonialStatus.HIDDEN },
    });
    expect(pending.length).toBe(1);
    expect(hidden.length).toBe(1);
    expect(approved.length).toBeGreaterThanOrEqual(1);
  });

  it('standalone course exists with pathId=null and marketing content', async () => {
    const c = await prisma.course.findUnique({ where: { id: STANDALONE_COURSE_ID } });
    expect(c).toBeTruthy();
    expect(c?.pathId).toBeNull();
    expect(c?.order).toBeNull();
    const features = await prisma.feature.findMany({
      where: { ownerId: STANDALONE_COURSE_ID },
    });
    const faqs = await prisma.faq.findMany({ where: { ownerId: STANDALONE_COURSE_ID } });
    const testimonials = await prisma.testimonial.findMany({
      where: { ownerId: STANDALONE_COURSE_ID },
    });
    expect(features.length).toBeGreaterThanOrEqual(2);
    expect(faqs.length).toBeGreaterThanOrEqual(2);
    expect(testimonials.length).toBeGreaterThanOrEqual(2);
  });

  it('at least one course-level certificate exists', async () => {
    const certs = await prisma.certificate.findMany({
      where: { type: CertificateType.COURSE },
    });
    expect(certs.length).toBeGreaterThanOrEqual(1);
    expect(certs[0].courseId).not.toBeNull();
    expect(certs[0].pathId).toBeNull();
  });

  it('is idempotent (running seed twice yields identical row counts)', async () => {
    const countsBefore = {
      categories: await prisma.category.count(),
      tags: await prisma.tag.count(),
      paths: await prisma.path.count(),
      courses: await prisma.course.count(),
      sections: await prisma.section.count(),
      lessons: await prisma.lesson.count(),
      features: await prisma.feature.count(),
      faqs: await prisma.faq.count(),
      testimonials: await prisma.testimonial.count(),
      pathTags: await prisma.pathTag.count(),
      courseTags: await prisma.courseTag.count(),
      users: await prisma.user.count(),
      pathEnrollments: await prisma.pathEnrollment.count(),
      courseEnrollments: await prisma.courseEnrollment.count(),
      certificates: await prisma.certificate.count(),
      lastPositions: await prisma.lastPosition.count(),
    };
    runSeed();
    const countsAfter = {
      categories: await prisma.category.count(),
      tags: await prisma.tag.count(),
      paths: await prisma.path.count(),
      courses: await prisma.course.count(),
      sections: await prisma.section.count(),
      lessons: await prisma.lesson.count(),
      features: await prisma.feature.count(),
      faqs: await prisma.faq.count(),
      testimonials: await prisma.testimonial.count(),
      pathTags: await prisma.pathTag.count(),
      courseTags: await prisma.courseTag.count(),
      users: await prisma.user.count(),
      pathEnrollments: await prisma.pathEnrollment.count(),
      courseEnrollments: await prisma.courseEnrollment.count(),
      certificates: await prisma.certificate.count(),
      lastPositions: await prisma.lastPosition.count(),
    };
    expect(countsAfter).toEqual(countsBefore);
  });
});
