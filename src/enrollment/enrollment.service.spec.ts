import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CourseEnrollmentStatus,
  EnrollmentStatus,
  Prisma,
  ProgressStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnrollmentService } from './enrollment.service';

type TxProxy = {
  path: { findUnique: jest.Mock };
  course: { findUnique: jest.Mock };
  pathEnrollment: {
    findFirst: jest.Mock;
    findMany?: jest.Mock;
    create: jest.Mock;
  };
  courseEnrollment: {
    findFirst: jest.Mock;
    findUnique?: jest.Mock;
    findMany?: jest.Mock;
    create: jest.Mock;
  };
  pathProgress: {
    create: jest.Mock;
    findMany?: jest.Mock;
  };
  courseProgress: {
    create: jest.Mock;
    findMany?: jest.Mock;
    findUnique?: jest.Mock;
  };
  sectionProgress: { create: jest.Mock };
  lastPosition?: { findFirst: jest.Mock };
};

function makeTx(): TxProxy {
  return {
    path: { findUnique: jest.fn() },
    course: { findUnique: jest.fn() },
    pathEnrollment: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    courseEnrollment: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    pathProgress: { create: jest.fn() },
    courseProgress: { create: jest.fn() },
    sectionProgress: { create: jest.fn() },
  };
}

describe('EnrollmentService', () => {
  let service: EnrollmentService;
  let prisma: {
    $transaction: jest.Mock;
    path: { findUnique: jest.Mock };
    course: { findUnique: jest.Mock };
    pathEnrollment: { findMany: jest.Mock };
    courseEnrollment: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    pathProgress: { findMany: jest.Mock };
    courseProgress: { findMany: jest.Mock; findUnique: jest.Mock };
    lastPosition: { findFirst: jest.Mock };
  };
  let tx: TxProxy;

  beforeEach(async () => {
    tx = makeTx();
    prisma = {
      $transaction: jest.fn(async (cb: (tx: TxProxy) => Promise<unknown>) =>
        cb(tx),
      ),
      path: { findUnique: jest.fn() },
      course: { findUnique: jest.fn() },
      pathEnrollment: { findMany: jest.fn() },
      courseEnrollment: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      pathProgress: { findMany: jest.fn() },
      courseProgress: { findMany: jest.fn(), findUnique: jest.fn() },
      lastPosition: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrollmentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(EnrollmentService);
  });

  // ---------- enrollInCourse ------------------------------------------------

  describe('enrollInCourse', () => {
    const courseRow = (pathId: string | null) => ({
      id: 'c1',
      pathId,
      sections: [
        { id: 's1', lessons: [{ id: 'l1' }, { id: 'l2' }] },
        { id: 's2', lessons: [{ id: 'l3' }] },
      ],
    });

    it('creates CourseEnrollment + CourseProgress + per-section SectionProgress', async () => {
      tx.course.findUnique.mockResolvedValue(courseRow(null));
      tx.courseEnrollment.create.mockResolvedValue({
        id: 'ce1',
        userId: 'u1',
        courseId: 'c1',
        status: CourseEnrollmentStatus.ACTIVE,
      });
      await service.enrollInCourse('u1', 'c1');
      expect(tx.courseEnrollment.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          courseId: 'c1',
          status: CourseEnrollmentStatus.ACTIVE,
        },
      });
      expect(tx.courseProgress.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          courseId: 'c1',
          totalSections: 2,
          status: ProgressStatus.NOT_STARTED,
        }),
      });
      expect(tx.sectionProgress.create).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a path-attached course with BadRequestException including parentPathId', async () => {
      tx.course.findUnique.mockResolvedValue(courseRow('parent-path'));
      await expect(service.enrollInCourse('u1', 'c1')).rejects.toMatchObject({
        response: expect.objectContaining({ parentPathId: 'parent-path' }),
      });
      await expect(service.enrollInCourse('u1', 'c1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the course does not exist', async () => {
      tx.course.findUnique.mockResolvedValue(null);
      await expect(service.enrollInCourse('u1', 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('converts Prisma P2002 to ConflictException on duplicate', async () => {
      tx.course.findUnique.mockResolvedValue(courseRow(null));
      tx.courseEnrollment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(service.enrollInCourse('u1', 'c1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  // ---------- enrollInPath --------------------------------------------------

  describe('enrollInPath', () => {
    const pathRow = () => ({
      id: 'p1',
      courses: [
        { id: 'c1', sections: [{ id: 's1' }, { id: 's2' }] },
        { id: 'c2', sections: [{ id: 's3' }] },
      ],
    });

    it('creates PathEnrollment + PathProgress + per-course CourseProgress', async () => {
      tx.path.findUnique.mockResolvedValue(pathRow());
      tx.pathEnrollment.findFirst.mockResolvedValue(null);
      tx.pathEnrollment.create.mockResolvedValue({
        id: 'pe1',
        userId: 'u1',
        pathId: 'p1',
        status: EnrollmentStatus.ACTIVE,
      });
      await service.enrollInPath('u1', 'p1');
      expect(tx.pathProgress.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          pathId: 'p1',
          totalCourses: 2,
        }),
      });
      expect(tx.courseProgress.create).toHaveBeenCalledTimes(2);
      expect(tx.courseProgress.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseId: 'c1',
          totalSections: 2,
        }),
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException on duplicate', async () => {
      tx.path.findUnique.mockResolvedValue(pathRow());
      tx.pathEnrollment.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.enrollInPath('u1', 'p1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.pathEnrollment.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the path does not exist', async () => {
      tx.path.findUnique.mockResolvedValue(null);
      await expect(service.enrollInPath('u1', 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ---------- listAllForUser ------------------------------------------------

  describe('listAllForUser', () => {
    it('returns both arrays and excludes path-attached courses from courses', async () => {
      prisma.pathEnrollment.findMany.mockResolvedValue([
        {
          id: 'pe1',
          userId: 'u1',
          pathId: 'p1',
          status: 'ACTIVE',
          enrolledAt: new Date('2026-04-10'),
          path: {
            id: 'p1',
            title: 'T',
            slug: 'p',
            thumbnail: null,
          },
        },
      ]);
      prisma.courseEnrollment.findMany.mockResolvedValue([
        {
          id: 'ce1',
          userId: 'u1',
          courseId: 'c1',
          status: 'ACTIVE',
          enrolledAt: new Date('2026-04-11'),
          course: {
            id: 'c1',
            title: 'C',
            slug: 'c',
            thumbnail: null,
          },
        },
      ]);
      prisma.pathProgress.findMany.mockResolvedValue([]);
      prisma.courseProgress.findMany.mockResolvedValue([]);

      const result = await service.listAllForUser('u1');
      expect(result.paths).toHaveLength(1);
      expect(result.courses).toHaveLength(1);
      // Verify the WHERE on courseEnrollment.findMany filters path-attached courses
      expect(prisma.courseEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            course: { pathId: null },
          }),
        }),
      );
    });

    it('returns empty arrays when user has no enrollments', async () => {
      prisma.pathEnrollment.findMany.mockResolvedValue([]);
      prisma.courseEnrollment.findMany.mockResolvedValue([]);
      prisma.pathProgress.findMany.mockResolvedValue([]);
      prisma.courseProgress.findMany.mockResolvedValue([]);
      const result = await service.listAllForUser('u1');
      expect(result.paths).toEqual([]);
      expect(result.courses).toEqual([]);
    });
  });

  // ---------- getCourseEnrollment -------------------------------------------

  describe('getCourseEnrollment', () => {
    it('returns null when the user is not enrolled (caller maps to 404)', async () => {
      prisma.courseEnrollment.findUnique.mockResolvedValue(null);
      const result = await service.getCourseEnrollment('u1', 'c1');
      expect(result).toBeNull();
    });

    it('returns the detail with progress and lastPosition', async () => {
      prisma.courseEnrollment.findUnique.mockResolvedValue({
        id: 'ce1',
        userId: 'u1',
        courseId: 'c1',
        status: 'ACTIVE',
        enrolledAt: new Date('2026-04-10'),
        course: { id: 'c1', title: 'C', slug: 'c', thumbnail: null },
      });
      prisma.courseProgress.findUnique.mockResolvedValue({
        percentage: 50,
        status: 'IN_PROGRESS',
      });
      prisma.lastPosition.findFirst.mockResolvedValue({
        sectionId: 's1',
        lessonId: 'l1',
        accessedAt: new Date('2026-04-12'),
      });
      const result = await service.getCourseEnrollment('u1', 'c1');
      expect(result).not.toBeNull();
      expect(result!.lastPosition).toMatchObject({
        sectionId: 's1',
        lessonId: 'l1',
      });
      expect(result!.progress.percentComplete).toBe(50);
    });
  });

  // ---------- hasAccessToCourse ---------------------------------------------

  describe('hasAccessToCourse', () => {
    it('returns true for a standalone course with an ACTIVE CourseEnrollment', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 'c1', pathId: null });
      prisma.courseEnrollment.findFirst.mockResolvedValue({ id: 'ce1' });
      const result = await service.hasAccessToCourse('u1', 'c1');
      expect(result).toBe(true);
      expect(prisma.courseEnrollment.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          courseId: 'c1',
          status: CourseEnrollmentStatus.ACTIVE,
        },
        select: { id: true },
      });
    });

    it('returns true for a path-attached course with an ACTIVE PathEnrollment', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 'c1', pathId: 'p1' });
      // Reusing pathEnrollment.findMany slot won't work — the guard uses findFirst.
      // We need a `findFirst` on pathEnrollment for this code path:
      (
        prisma as unknown as { pathEnrollment: { findFirst: jest.Mock } }
      ).pathEnrollment = {
        findFirst: jest.fn().mockResolvedValue({ id: 'pe1' }),
      };
      const result = await service.hasAccessToCourse('u1', 'c1');
      expect(result).toBe(true);
    });

    it('returns false when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);
      expect(await service.hasAccessToCourse('u1', 'missing')).toBe(false);
    });

    it('returns false when an enrollment exists but its status is not ACTIVE', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 'c1', pathId: null });
      prisma.courseEnrollment.findFirst.mockResolvedValue(null);
      expect(await service.hasAccessToCourse('u1', 'c1')).toBe(false);
    });
  });
});
