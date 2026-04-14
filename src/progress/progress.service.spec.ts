import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProgressStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertificatesService } from '../certificates/certificates.service';
import { ProgressService } from './progress.service';

function makeTx() {
  return {
    lessonProgress: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
    lesson: { findUnique: jest.fn(), count: jest.fn() },
    section: { count: jest.fn() },
    sectionProgress: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    courseProgress: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    pathProgress: { upsert: jest.fn(), findUnique: jest.fn() },
    course: { findUnique: jest.fn(), findMany: jest.fn() },
    pathEnrollment: { findFirst: jest.fn() },
    lastPosition: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
}

describe('ProgressService', () => {
  let service: ProgressService;
  let prisma: ReturnType<typeof makeTx> & { $transaction: jest.Mock };
  let tx: ReturnType<typeof makeTx>;
  let certificates: {
    checkCourseEligibility: jest.Mock;
    checkPathEligibility: jest.Mock;
  };

  const lessonRow = (pathId: string | null) => ({
    id: 'l1',
    sectionId: 's1',
    section: {
      id: 's1',
      courseId: 'c1',
      course: { id: 'c1', pathId },
    },
  });

  beforeEach(async () => {
    tx = makeTx();
    prisma = {
      ...makeTx(),
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
    };
    // Prisma service is used both directly (pre-tx fast-path, pre-tx lookups)
    // and as the holder of $transaction. The direct uses go through the
    // top-level `prisma.lessonProgress.findUnique`, `prisma.lesson.findUnique`,
    // and `prisma.certificate.findFirst` calls. Wire them separately:
    (prisma as unknown as Record<string, unknown>).certificate = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
    certificates = {
      checkCourseEligibility: jest.fn(),
      checkPathEligibility: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProgressService,
        { provide: PrismaService, useValue: prisma },
        { provide: CertificatesService, useValue: certificates },
      ],
    }).compile();
    service = moduleRef.get(ProgressService);
  });

  // ---------- Idempotency fast-path -----------------------------------------

  describe('idempotency fast-path', () => {
    it('returns current state and does NOT open a transaction when lesson already COMPLETED', async () => {
      prisma.lessonProgress.findUnique.mockResolvedValue({
        id: 'lp1',
        userId: 'u1',
        lessonId: 'l1',
        status: ProgressStatus.COMPLETED,
        completedAt: new Date(),
      });
      prisma.lesson.findUnique.mockResolvedValue(lessonRow(null));
      prisma.sectionProgress.findUnique.mockResolvedValue({ percentage: 100 });
      prisma.courseProgress.findUnique.mockResolvedValue({ percentage: 100 });
      const result = await service.completeLesson('u1', 'l1');
      expect(result.certificatesIssued).toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(certificates.checkCourseEligibility).not.toHaveBeenCalled();
    });
  });

  // ---------- Cascade runs inside a single transaction ----------------------

  describe('cascade transaction', () => {
    beforeEach(() => {
      prisma.lessonProgress.findUnique.mockResolvedValue(null);
      prisma.lesson.findUnique.mockResolvedValue(lessonRow('p1'));
      // Pre-existing certs snapshot for the "newly-issued" classification.
      (prisma as unknown as { certificate: { findFirst: jest.Mock } }).certificate.findFirst.mockResolvedValue(null);
      tx.lessonProgress.upsert.mockResolvedValue({
        id: 'lp',
        status: ProgressStatus.COMPLETED,
      });
      tx.lesson.count.mockResolvedValue(3);
      tx.lessonProgress.count.mockResolvedValue(3); // all complete
      tx.sectionProgress.upsert.mockResolvedValue({
        id: 'sp',
        status: ProgressStatus.COMPLETED,
      });
      tx.section.count.mockResolvedValue(2);
      tx.sectionProgress.count.mockResolvedValue(2);
      tx.courseProgress.upsert.mockResolvedValue({
        id: 'cp',
        status: ProgressStatus.COMPLETED,
      });
      tx.course.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      tx.courseProgress.findMany.mockResolvedValue([
        { percentage: 100, status: ProgressStatus.COMPLETED },
        { percentage: 100, status: ProgressStatus.COMPLETED },
      ]);
      tx.pathProgress.upsert.mockResolvedValue({
        id: 'pp',
        status: ProgressStatus.COMPLETED,
      });
      tx.pathEnrollment.findFirst.mockResolvedValue({ id: 'pe' });
      tx.lastPosition.findFirst.mockResolvedValue(null);
      tx.lastPosition.create.mockResolvedValue({ id: 'lpos' });
    });

    it('runs the entire cascade in a single $transaction', async () => {
      certificates.checkCourseEligibility.mockResolvedValue({
        id: 'new-course',
        type: 'COURSE',
      });
      certificates.checkPathEligibility.mockResolvedValue(null);
      await service.completeLesson('u1', 'l1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('classifies a returned course cert as newly-issued when none existed before', async () => {
      certificates.checkCourseEligibility.mockResolvedValue({
        id: 'new-course',
        type: 'COURSE',
      });
      certificates.checkPathEligibility.mockResolvedValue(null);
      const result = await service.completeLesson('u1', 'l1');
      expect(result.certificatesIssued).toHaveLength(1);
      expect(result.certificatesIssued[0].id).toBe('new-course');
    });

    it('skips the path check for standalone courses', async () => {
      prisma.lesson.findUnique.mockResolvedValue(lessonRow(null));
      certificates.checkCourseEligibility.mockResolvedValue(null);
      await service.completeLesson('u1', 'l1');
      expect(certificates.checkPathEligibility).not.toHaveBeenCalled();
    });

    it('routes LastPosition to courseId for standalone courses', async () => {
      prisma.lesson.findUnique.mockResolvedValue(lessonRow(null));
      certificates.checkCourseEligibility.mockResolvedValue(null);
      await service.completeLesson('u1', 'l1');
      expect(tx.lastPosition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ courseId: 'c1', pathId: null }),
        }),
      );
    });

    it('routes LastPosition to pathId when user has ACTIVE PathEnrollment', async () => {
      certificates.checkCourseEligibility.mockResolvedValue(null);
      certificates.checkPathEligibility.mockResolvedValue(null);
      await service.completeLesson('u1', 'l1');
      expect(tx.lastPosition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pathId: 'p1', courseId: null }),
        }),
      );
    });
  });

  // ---------- Forced-failure rollback (U1) ---------------------------------

  describe('forced-failure rollback (U1 — FR-012)', () => {
    it('surfaces the thrown error and does not populate certificatesIssued', async () => {
      prisma.lessonProgress.findUnique.mockResolvedValue(null);
      prisma.lesson.findUnique.mockResolvedValue(lessonRow(null));
      (prisma as unknown as { certificate: { findFirst: jest.Mock } }).certificate.findFirst.mockResolvedValue(null);
      tx.lessonProgress.upsert.mockResolvedValue({ id: 'lp' });
      tx.lesson.count.mockResolvedValue(1);
      tx.lessonProgress.count.mockResolvedValue(1);
      tx.sectionProgress.upsert.mockResolvedValue({ id: 'sp' });
      tx.section.count.mockResolvedValue(1);
      tx.sectionProgress.count.mockResolvedValue(1);
      tx.courseProgress.upsert.mockResolvedValue({ id: 'cp' });
      tx.lastPosition.findFirst.mockResolvedValue(null);
      tx.lastPosition.create.mockResolvedValue({ id: 'lpos' });

      // Certificate check throws mid-cascade — transaction callback rejects.
      certificates.checkCourseEligibility.mockRejectedValue(
        new Error('forced rollback'),
      );

      // Mock $transaction to re-throw from the callback (which is what
      // Prisma does in real life: a throw inside the callback aborts the tx).
      prisma.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
      );

      await expect(service.completeLesson('u1', 'l1')).rejects.toThrow(
        'forced rollback',
      );
    });
  });

  // ---------- NotFoundException on missing lesson ---------------------------

  it('throws NotFoundException when the lesson does not exist', async () => {
    prisma.lessonProgress.findUnique.mockResolvedValue(null);
    prisma.lesson.findUnique.mockResolvedValue(null);
    await expect(service.completeLesson('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
