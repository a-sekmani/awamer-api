import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CertificateType,
  EnrollmentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CertificatesService } from './certificates.service';

function makeTx() {
  return {
    certificate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    course: { findUnique: jest.fn(), findMany: jest.fn() },
    path: { findUnique: jest.fn() },
    pathEnrollment: { findFirst: jest.fn() },
    lessonProgress: { count: jest.fn() },
  };
}

describe('CertificatesService', () => {
  let service: CertificatesService;
  let analytics: { capture: jest.Mock };
  let prisma: {
    certificate: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let tx: ReturnType<typeof makeTx>;

  const baseCert = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'cert-1',
    userId: 'u1',
    type: CertificateType.COURSE,
    pathId: null,
    courseId: 'c1',
    certificateCode: 'abc123',
    certificateUrl: null,
    issuedAt: new Date('2026-04-14T12:00:00.000Z'),
    createdAt: new Date('2026-04-14T12:00:00.000Z'),
    updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    tx = makeTx();
    analytics = { capture: jest.fn() };
    prisma = {
      certificate: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CertificatesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compile();
    service = moduleRef.get(CertificatesService);
  });

  // ---------- checkCourseEligibility ----------------------------------------

  describe('checkCourseEligibility', () => {
    it('returns the existing cert without issuing when one already exists', async () => {
      const existing = baseCert();
      tx.certificate.findFirst.mockResolvedValue(existing);
      const result = await service.checkCourseEligibility(tx as any, 'u1', 'c1');
      expect(result).toBe(existing);
      expect(tx.certificate.create).not.toHaveBeenCalled();
      // FR-030: MUST NOT fire when returning a pre-existing cert.
      expect(analytics.capture).not.toHaveBeenCalled();
    });

    it('returns null when not all lessons are completed', async () => {
      tx.certificate.findFirst.mockResolvedValue(null);
      tx.course.findUnique.mockResolvedValue({
        id: 'c1',
        sections: [{ lessons: [{ id: 'l1' }, { id: 'l2' }] }],
      });
      tx.lessonProgress.count.mockResolvedValue(1); // only 1 of 2 complete
      const result = await service.checkCourseEligibility(tx as any, 'u1', 'c1');
      expect(result).toBeNull();
      expect(tx.certificate.create).not.toHaveBeenCalled();
      expect(analytics.capture).not.toHaveBeenCalled();
    });

    it('issues a new cert with type=COURSE, courseId set, pathId null when eligible', async () => {
      tx.certificate.findFirst.mockResolvedValue(null);
      tx.course.findUnique.mockResolvedValue({
        id: 'c1',
        sections: [{ lessons: [{ id: 'l1' }, { id: 'l2' }] }],
      });
      tx.lessonProgress.count.mockResolvedValue(2);
      tx.certificate.create.mockResolvedValue(
        baseCert({ id: 'new', type: CertificateType.COURSE }),
      );
      const result = await service.checkCourseEligibility(tx as any, 'u1', 'c1');
      expect(result!.id).toBe('new');
      expect(tx.certificate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          type: CertificateType.COURSE,
          courseId: 'c1',
          pathId: null,
        }),
      });
      // FR-030: MUST fire exactly once with the full payload on genuine issuance.
      expect(analytics.capture).toHaveBeenCalledTimes(1);
      expect(analytics.capture).toHaveBeenCalledWith(
        'u1',
        'certificate_issued',
        expect.objectContaining({
          certificateId: 'new',
          certificateType: CertificateType.COURSE,
          pathId: null,
          courseId: 'c1',
          certificateCode: 'abc123',
          issuedAt: '2026-04-14T12:00:00.000Z',
        }),
      );
    });
  });

  // ---------- checkPathEligibility ------------------------------------------

  describe('checkPathEligibility', () => {
    it('returns the existing cert without issuing when one already exists', async () => {
      const existing = baseCert({
        id: 'path-cert',
        type: CertificateType.PATH,
        pathId: 'p1',
        courseId: null,
      });
      tx.certificate.findFirst.mockResolvedValue(existing);
      const result = await service.checkPathEligibility(tx as any, 'u1', 'p1');
      expect(result).toBe(existing);
      expect(tx.certificate.create).not.toHaveBeenCalled();
      expect(analytics.capture).not.toHaveBeenCalled();
    });

    it('returns null when the user has no ACTIVE PathEnrollment', async () => {
      tx.certificate.findFirst.mockResolvedValue(null);
      tx.pathEnrollment.findFirst.mockResolvedValue(null);
      const result = await service.checkPathEligibility(tx as any, 'u1', 'p1');
      expect(result).toBeNull();
      expect(analytics.capture).not.toHaveBeenCalled();
    });

    it('returns null when not every course in the path has a cert', async () => {
      tx.certificate.findFirst.mockResolvedValue(null);
      tx.pathEnrollment.findFirst.mockResolvedValue({ id: 'pe1' });
      tx.path.findUnique.mockResolvedValue({
        id: 'p1',
        courses: [{ id: 'c1' }, { id: 'c2' }],
      });
      tx.certificate.count.mockResolvedValue(1); // only 1 of 2 certs
      const result = await service.checkPathEligibility(tx as any, 'u1', 'p1');
      expect(result).toBeNull();
    });

    it('issues a new cert with type=PATH, pathId set, courseId null when eligible', async () => {
      tx.certificate.findFirst.mockResolvedValue(null);
      tx.pathEnrollment.findFirst.mockResolvedValue({ id: 'pe1' });
      tx.path.findUnique.mockResolvedValue({
        id: 'p1',
        courses: [{ id: 'c1' }, { id: 'c2' }],
      });
      tx.certificate.count.mockResolvedValue(2);
      tx.certificate.create.mockResolvedValue(
        baseCert({
          id: 'new-path',
          type: CertificateType.PATH,
          pathId: 'p1',
          courseId: null,
        }),
      );
      const result = await service.checkPathEligibility(tx as any, 'u1', 'p1');
      expect(result!.id).toBe('new-path');
      expect(tx.certificate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          type: CertificateType.PATH,
          pathId: 'p1',
          courseId: null,
        }),
      });
      expect(analytics.capture).toHaveBeenCalledTimes(1);
      expect(analytics.capture).toHaveBeenCalledWith(
        'u1',
        'certificate_issued',
        expect.objectContaining({
          certificateId: 'new-path',
          certificateType: CertificateType.PATH,
          pathId: 'p1',
          courseId: null,
        }),
      );
    });
  });

  // ---------- issueCertificate retry behaviour ------------------------------

  describe('issueCertificate retry behaviour', () => {
    function makeP2002() {
      return new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      });
    }

    it('retries on P2002 and succeeds on the 3rd attempt, emitting exactly once', async () => {
      tx.certificate.findFirst.mockResolvedValue(null);
      tx.course.findUnique.mockResolvedValue({
        id: 'c1',
        sections: [{ lessons: [{ id: 'l1' }] }],
      });
      tx.lessonProgress.count.mockResolvedValue(1);
      tx.certificate.create
        .mockRejectedValueOnce(makeP2002())
        .mockRejectedValueOnce(makeP2002())
        .mockResolvedValueOnce(baseCert({ id: 'retry-success' }));
      const result = await service.checkCourseEligibility(tx as any, 'u1', 'c1');
      expect(result!.id).toBe('retry-success');
      expect(tx.certificate.create).toHaveBeenCalledTimes(3);
      // FR-030: emission fires exactly once, not on each retry attempt.
      expect(analytics.capture).toHaveBeenCalledTimes(1);
    });

    it('throws InternalServerErrorException after 3 P2002 collisions', async () => {
      tx.certificate.findFirst.mockResolvedValue(null);
      tx.course.findUnique.mockResolvedValue({
        id: 'c1',
        sections: [{ lessons: [{ id: 'l1' }] }],
      });
      tx.lessonProgress.count.mockResolvedValue(1);
      tx.certificate.create.mockRejectedValue(makeP2002());
      await expect(
        service.checkCourseEligibility(tx as any, 'u1', 'c1'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(analytics.capture).not.toHaveBeenCalled();
    });

    it('throws immediately on non-P2002 errors without retrying', async () => {
      tx.certificate.findFirst.mockResolvedValue(null);
      tx.course.findUnique.mockResolvedValue({
        id: 'c1',
        sections: [{ lessons: [{ id: 'l1' }] }],
      });
      tx.lessonProgress.count.mockResolvedValue(1);
      tx.certificate.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.checkCourseEligibility(tx as any, 'u1', 'c1'),
      ).rejects.toThrow('db down');
      expect(tx.certificate.create).toHaveBeenCalledTimes(1);
      expect(analytics.capture).not.toHaveBeenCalled();
    });
  });

  // ---------- listForUser ---------------------------------------------------

  describe('listForUser', () => {
    it('sorts by issuedAt DESC and includes path/course relation by type', async () => {
      prisma.certificate.findMany.mockResolvedValue([
        {
          ...baseCert({
            id: 'p',
            type: CertificateType.PATH,
            pathId: 'p1',
            courseId: null,
            issuedAt: new Date('2026-04-15'),
          }),
          path: { id: 'p1', title: 'Path', slug: 'p' },
          course: null,
        },
        {
          ...baseCert({ id: 'c', issuedAt: new Date('2026-04-14') }),
          path: null,
          course: { id: 'c1', title: 'Course', slug: 'c' },
        },
      ]);
      const result = await service.listForUser('u1');
      expect(prisma.certificate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { issuedAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(CertificateType.PATH);
      expect(result[0].path).toMatchObject({ title: 'Path' });
      expect(result[1].type).toBe(CertificateType.COURSE);
      expect(result[1].course).toMatchObject({ title: 'Course' });
    });
  });

  // ---------- verifyByCode --------------------------------------------------

  describe('verifyByCode', () => {
    it('throws NotFoundException for an unknown code', async () => {
      prisma.certificate.findUnique.mockResolvedValue(null);
      await expect(service.verifyByCode('unknown')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the minimal allow-listed shape with fullName, no email/enrollment/progress', async () => {
      prisma.certificate.findUnique.mockResolvedValue({
        ...baseCert({ id: 'c1', certificateCode: 'zzz' }),
        user: { name: 'أحمد السكماني' },
        path: null,
        course: { title: 'Git Basics', slug: 'git-basics' },
      });
      const result = await service.verifyByCode('zzz');
      expect(result).toEqual({
        valid: true,
        type: CertificateType.COURSE,
        issuedAt: '2026-04-14T12:00:00.000Z',
        holder: { fullName: 'أحمد السكماني' },
        subject: {
          type: CertificateType.COURSE,
          title: 'Git Basics',
          slug: 'git-basics',
        },
      });
      // Explicit checks: no sensitive fields leaked.
      expect(result as unknown as Record<string, unknown>).not.toHaveProperty(
        'email',
      );
      expect(result as unknown as Record<string, unknown>).not.toHaveProperty(
        'enrolledAt',
      );
      expect(result.holder as unknown as Record<string, unknown>).not.toHaveProperty(
        'email',
      );
    });
  });
});
