import {
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  Certificate,
  CertificateType,
  CourseProgress,
  EnrollmentStatus,
  LastPosition,
  LessonProgress,
  PathProgress,
  Prisma,
  ProgressStatus,
  SectionProgress,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertificatesService } from '../certificates/certificates.service';

export type CompleteLessonResult = {
  lessonProgress: LessonProgress;
  sectionProgress: SectionProgress;
  courseProgress: CourseProgress;
  pathProgress: PathProgress | null;
  certificatesIssued: Certificate[];
};

/**
 * The lesson-completion cascade that drives progress recalculation and
 * auto-issuance of course- and path-level certificates.
 *
 * Serialization note (U2 resolution): `CompleteLessonResult` returns RAW
 * Prisma entities. Date fields become ISO strings via the global
 * `ClassSerializerInterceptor`. No response DTOs are created for the progress
 * rows; `CompleteLessonResult` is the only typed contract for this shape.
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CertificatesService))
    private readonly certificates: CertificatesService,
  ) {}

  async completeLesson(
    userId: string,
    lessonId: string,
  ): Promise<CompleteLessonResult> {
    // (1) Idempotency fast-path: if already COMPLETED, short-circuit BEFORE
    // opening a transaction. Returns current aggregate state and an empty
    // `certificatesIssued` list.
    const existing = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
    if (existing && existing.status === ProgressStatus.COMPLETED) {
      return this.loadCurrentState(userId, existing);
    }

    // (2) Resolve lesson → section → course (+ pathId) BEFORE the transaction.
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { section: { include: { course: true } } },
    });
    if (!lesson) {
      throw new NotFoundException(`Lesson '${lessonId}' not found`);
    }

    const { section } = lesson;
    const { course } = section;

    // (2b) Capture pre-existing certificates for the target scopes so the
    // cascade can correctly classify "newly issued by THIS call" vs. "already
    // existed". This runs BEFORE the transaction so there's no I/O cost
    // inside the hot path, and it's cheap (2 small queries).
    const [preCourseCert, prePathCert] = await Promise.all([
      this.prisma.certificate.findFirst({
        where: { userId, courseId: course.id, type: CertificateType.COURSE },
        select: { id: true },
      }),
      course.pathId
        ? this.prisma.certificate.findFirst({
            where: {
              userId,
              pathId: course.pathId,
              type: CertificateType.PATH,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    // (3) Run the full cascade in one transaction.
    return this.prisma.$transaction(async (tx) => {
      const lessonProgress = await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: {
          userId,
          lessonId,
          status: ProgressStatus.COMPLETED,
          completedAt: new Date(),
        },
        update: {
          status: ProgressStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      const sectionProgress = await this.recalculateSectionProgress(
        tx,
        userId,
        section.id,
      );
      const courseProgress = await this.recalculateCourseProgress(
        tx,
        userId,
        course.id,
      );
      const pathProgress = course.pathId
        ? await this.recalculatePathProgress(tx, userId, course.pathId)
        : null;

      await this.updateLastPosition(tx, userId, lesson);

      const courseCert = await this.certificates.checkCourseEligibility(
        tx,
        userId,
        course.id,
      );
      const pathCert = course.pathId
        ? await this.certificates.checkPathEligibility(
            tx,
            userId,
            course.pathId,
          )
        : null;

      // Classify: a cert is "newly issued by this call" iff its id is not in
      // the pre-existing set captured before the transaction opened.
      const certificatesIssued: Certificate[] = [];
      if (courseCert && courseCert.id !== preCourseCert?.id) {
        certificatesIssued.push(courseCert);
      }
      if (pathCert && pathCert.id !== prePathCert?.id) {
        certificatesIssued.push(pathCert);
      }

      return {
        lessonProgress,
        sectionProgress,
        courseProgress,
        pathProgress,
        certificatesIssued,
      };
    });
  }

  // ---------- Helpers (transactional) ----------------------------------------

  async recalculateSectionProgress(
    tx: Prisma.TransactionClient,
    userId: string,
    sectionId: string,
  ): Promise<SectionProgress> {
    const total = await tx.lesson.count({ where: { sectionId } });
    const completed = await tx.lessonProgress.count({
      where: {
        userId,
        lesson: { sectionId },
        status: ProgressStatus.COMPLETED,
      },
    });
    const percentage = total === 0 ? 0 : (completed / total) * 100;
    const status = this.deriveStatus(completed, total);
    return tx.sectionProgress.upsert({
      where: { userId_sectionId: { userId, sectionId } },
      create: {
        userId,
        sectionId,
        totalLessons: total,
        completedLessons: completed,
        percentage,
        status,
      },
      update: {
        totalLessons: total,
        completedLessons: completed,
        percentage,
        status,
      },
    });
  }

  async recalculateCourseProgress(
    tx: Prisma.TransactionClient,
    userId: string,
    courseId: string,
  ): Promise<CourseProgress> {
    const total = await tx.section.count({ where: { courseId } });
    const completed = await tx.sectionProgress.count({
      where: {
        userId,
        section: { courseId },
        status: ProgressStatus.COMPLETED,
      },
    });
    const percentage = total === 0 ? 0 : (completed / total) * 100;
    const status = this.deriveStatus(completed, total);
    return tx.courseProgress.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: {
        userId,
        courseId,
        totalSections: total,
        completedSections: completed,
        percentage,
        status,
      },
      update: {
        totalSections: total,
        completedSections: completed,
        percentage,
        status,
      },
    });
  }

  async recalculatePathProgress(
    tx: Prisma.TransactionClient,
    userId: string,
    pathId: string,
  ): Promise<PathProgress> {
    const courses = await tx.course.findMany({
      where: { pathId },
      select: { id: true },
    });
    const total = courses.length;
    if (total === 0) {
      return tx.pathProgress.upsert({
        where: { userId_pathId: { userId, pathId } },
        create: {
          userId,
          pathId,
          totalCourses: 0,
          completedCourses: 0,
          percentage: 0,
          status: ProgressStatus.NOT_STARTED,
        },
        update: {
          totalCourses: 0,
          completedCourses: 0,
          percentage: 0,
          status: ProgressStatus.NOT_STARTED,
        },
      });
    }
    const courseProgresses = await tx.courseProgress.findMany({
      where: { userId, courseId: { in: courses.map((c) => c.id) } },
    });
    const completed = courseProgresses.filter(
      (p) => p.status === ProgressStatus.COMPLETED,
    ).length;
    const percentage =
      courseProgresses.length === 0
        ? 0
        : courseProgresses.reduce((sum, p) => sum + p.percentage, 0) / total;
    const status = this.deriveStatus(completed, total);
    return tx.pathProgress.upsert({
      where: { userId_pathId: { userId, pathId } },
      create: {
        userId,
        pathId,
        totalCourses: total,
        completedCourses: completed,
        percentage,
        status,
      },
      update: {
        totalCourses: total,
        completedCourses: completed,
        percentage,
        status,
      },
    });
  }

  async updateLastPosition(
    tx: Prisma.TransactionClient,
    userId: string,
    lesson: {
      id: string;
      sectionId: string;
      section: { course: { id: string; pathId: string | null } };
    },
  ): Promise<LastPosition> {
    const { course } = lesson.section;

    // Scope routing: if the lesson's course has a parent path AND the user
    // holds an ACTIVE PathEnrollment for that path (already guaranteed by
    // EnrollmentGuard at the HTTP entry point; the service-level check is
    // defensive), use path scope; else use course scope.
    let usePathScope = false;
    if (course.pathId) {
      const pe = await tx.pathEnrollment.findFirst({
        where: {
          userId,
          pathId: course.pathId,
          status: EnrollmentStatus.ACTIVE,
        },
        select: { id: true },
      });
      usePathScope = pe !== null;
    }

    const scopeFilter = usePathScope
      ? { userId, pathId: course.pathId, courseId: null }
      : { userId, pathId: null, courseId: course.id };

    // Decision 4: partial unique indexes are invisible to Prisma → use
    // findFirst + create/update instead of upsert.
    const existing = await tx.lastPosition.findFirst({ where: scopeFilter });
    if (existing) {
      return tx.lastPosition.update({
        where: { id: existing.id },
        data: {
          sectionId: lesson.sectionId,
          lessonId: lesson.id,
          accessedAt: new Date(),
        },
      });
    }
    return tx.lastPosition.create({
      data: {
        userId,
        pathId: usePathScope ? course.pathId : null,
        courseId: usePathScope ? null : course.id,
        sectionId: lesson.sectionId,
        lessonId: lesson.id,
        accessedAt: new Date(),
      },
    });
  }

  // ---------- Small private helpers ------------------------------------------

  private deriveStatus(completed: number, total: number): ProgressStatus {
    if (total > 0 && completed === total) return ProgressStatus.COMPLETED;
    if (completed > 0) return ProgressStatus.IN_PROGRESS;
    return ProgressStatus.NOT_STARTED;
  }

  private async loadCurrentState(
    userId: string,
    existingLessonProgress: LessonProgress,
  ): Promise<CompleteLessonResult> {
    // Idempotent re-completion: load the full aggregate state with NO writes
    // and NO certificates newly issued.
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: existingLessonProgress.lessonId },
      include: { section: { include: { course: true } } },
    });
    if (!lesson) {
      throw new NotFoundException('Lesson no longer exists');
    }
    const { section } = lesson;
    const { course } = section;
    const [sectionProgress, courseProgress, pathProgress] = await Promise.all([
      this.prisma.sectionProgress.findUnique({
        where: { userId_sectionId: { userId, sectionId: section.id } },
      }),
      this.prisma.courseProgress.findUnique({
        where: { userId_courseId: { userId, courseId: course.id } },
      }),
      course.pathId
        ? this.prisma.pathProgress.findUnique({
            where: { userId_pathId: { userId, pathId: course.pathId } },
          })
        : Promise.resolve(null),
    ]);
    return {
      lessonProgress: existingLessonProgress,
      sectionProgress: sectionProgress!,
      courseProgress: courseProgress!,
      pathProgress: pathProgress ?? null,
      certificatesIssued: [],
    };
  }
}
