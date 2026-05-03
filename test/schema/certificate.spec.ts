import { prisma, truncateAll } from './setup';
import { CertificateType } from '@prisma/client';

async function ctx() {
  const user = await prisma.user.create({
    data: { name: 'U', email: 'c@test.local', passwordHash: 'x' },
  });
  const cat = await prisma.category.create({
    data: { name: 'C', slug: 'cert-cat' },
  });
  const path = await prisma.path.create({
    data: { categoryId: cat.id, title: 'P', slug: 'cert-p' },
  });
  const course = await prisma.course.create({
    data: { categoryId: cat.id, slug: 'cert-c', title: 'C' },
  });
  return { user, path, course };
}

let codeSeq = 0;
const code = () => `CERT-${Date.now()}-${++codeSeq}`;

describe('Certificate schema', () => {
  beforeEach(async () => {
    await truncateAll();
    codeSeq = 0;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a PATH certificate', async () => {
    const { user, path } = await ctx();
    const c = await prisma.certificate.create({
      data: {
        userId: user.id,
        pathId: path.id,
        courseId: null,
        type: CertificateType.PATH,
        certificateCode: code(),
      },
    });
    expect(c.type).toBe(CertificateType.PATH);
    expect(c.courseId).toBeNull();
  });

  it('creates a COURSE certificate', async () => {
    const { user, course } = await ctx();
    const c = await prisma.certificate.create({
      data: {
        userId: user.id,
        pathId: null,
        courseId: course.id,
        type: CertificateType.COURSE,
        certificateCode: code(),
      },
    });
    expect(c.type).toBe(CertificateType.COURSE);
    expect(c.pathId).toBeNull();
  });

  it('allows a user to hold both types simultaneously', async () => {
    const { user, path, course } = await ctx();
    await prisma.certificate.create({
      data: {
        userId: user.id,
        pathId: path.id,
        type: CertificateType.PATH,
        certificateCode: code(),
      },
    });
    await prisma.certificate.create({
      data: {
        userId: user.id,
        courseId: course.id,
        type: CertificateType.COURSE,
        certificateCode: code(),
      },
    });
    expect(await prisma.certificate.count({ where: { userId: user.id } })).toBe(
      2,
    );
  });

  it('CHECK rejects both pathId and courseId set', async () => {
    const { user, path, course } = await ctx();
    await expect(
      prisma.certificate.create({
        data: {
          userId: user.id,
          pathId: path.id,
          courseId: course.id,
          type: CertificateType.PATH,
          certificateCode: code(),
        },
      }),
    ).rejects.toThrow();
  });

  it('CHECK rejects neither pathId nor courseId set', async () => {
    const { user } = await ctx();
    await expect(
      prisma.certificate.create({
        data: {
          userId: user.id,
          pathId: null,
          courseId: null,
          type: CertificateType.PATH,
          certificateCode: code(),
        },
      }),
    ).rejects.toThrow();
  });

  it('CHECK rejects type=PATH with courseId set (mismatch)', async () => {
    const { user, course } = await ctx();
    await expect(
      prisma.certificate.create({
        data: {
          userId: user.id,
          pathId: null,
          courseId: course.id,
          type: CertificateType.PATH,
          certificateCode: code(),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate PATH certificate for same (userId, pathId)', async () => {
    const { user, path } = await ctx();
    await prisma.certificate.create({
      data: {
        userId: user.id,
        pathId: path.id,
        type: CertificateType.PATH,
        certificateCode: code(),
      },
    });
    await expect(
      prisma.certificate.create({
        data: {
          userId: user.id,
          pathId: path.id,
          type: CertificateType.PATH,
          certificateCode: code(),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate COURSE certificate for same (userId, courseId)', async () => {
    const { user, course } = await ctx();
    await prisma.certificate.create({
      data: {
        userId: user.id,
        courseId: course.id,
        type: CertificateType.COURSE,
        certificateCode: code(),
      },
    });
    await expect(
      prisma.certificate.create({
        data: {
          userId: user.id,
          courseId: course.id,
          type: CertificateType.COURSE,
          certificateCode: code(),
        },
      }),
    ).rejects.toThrow();
  });
});
