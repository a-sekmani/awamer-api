import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Certificate,
  CertificateType,
  EnrollmentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  CertificateResponseDto,
  CertificateWithRelations,
} from './dto/certificate-response.dto';
import { CertificateVerificationDto } from './dto/certificate-verification.dto';

type IssueCertificateData = {
  userId: string;
  type: CertificateType;
  pathId: string | null;
  courseId: string | null;
};

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ---------- Eligibility checks ---------------------------------------------

  async checkCourseEligibility(
    tx: Prisma.TransactionClient,
    userId: string,
    courseId: string,
  ): Promise<Certificate | null> {
    const existing = await tx.certificate.findFirst({
      where: { userId, courseId, type: CertificateType.COURSE },
    });
    if (existing) return existing;

    const course = await tx.course.findUnique({
      where: { id: courseId },
      include: { sections: { include: { lessons: { select: { id: true } } } } },
    });
    if (!course) return null;

    const allLessonIds = course.sections.flatMap((s) =>
      s.lessons.map((l) => l.id),
    );
    if (allLessonIds.length === 0) return null;

    const completed = await tx.lessonProgress.count({
      where: {
        userId,
        lessonId: { in: allLessonIds },
        status: 'COMPLETED',
      },
    });
    if (completed !== allLessonIds.length) return null;

    if (!(await this.allCourseQuizzesPassed(tx, userId, courseId))) {
      return null;
    }

    return this.issueCertificate(tx, {
      userId,
      type: CertificateType.COURSE,
      pathId: null,
      courseId,
    });
  }

  async checkPathEligibility(
    tx: Prisma.TransactionClient,
    userId: string,
    pathId: string,
  ): Promise<Certificate | null> {
    const existing = await tx.certificate.findFirst({
      where: { userId, pathId, type: CertificateType.PATH },
    });
    if (existing) return existing;

    const enrollment = await tx.pathEnrollment.findFirst({
      where: { userId, pathId, status: EnrollmentStatus.ACTIVE },
      select: { id: true },
    });
    if (!enrollment) return null;

    const path = await tx.path.findUnique({
      where: { id: pathId },
      include: { courses: { select: { id: true } } },
    });
    if (!path || path.courses.length === 0) return null;

    const courseCertCount = await tx.certificate.count({
      where: {
        userId,
        type: CertificateType.COURSE,
        courseId: { in: path.courses.map((c) => c.id) },
      },
    });
    if (courseCertCount !== path.courses.length) return null;

    return this.issueCertificate(tx, {
      userId,
      type: CertificateType.PATH,
      pathId,
      courseId: null,
    });
  }

  // ---------- Private issuance + FR-030 emission -----------------------------

  private async issueCertificate(
    tx: Prisma.TransactionClient,
    data: IssueCertificateData,
  ): Promise<Certificate> {
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code = this.generateCode();
      try {
        const created = await tx.certificate.create({
          data: {
            userId: data.userId,
            type: data.type,
            pathId: data.pathId,
            courseId: data.courseId,
            certificateCode: code,
          },
        });

        // FR-030 — emit `certificate_issued` exactly at the point of genuine
        // new-issuance. Placement inside issueCertificate is a structural
        // idempotency guarantee: checkCourseEligibility and checkPathEligibility
        // short-circuit BEFORE reaching this line when an existing certificate
        // is found. AnalyticsService.capture is synchronous and returns void —
        // it cannot abort the Prisma transaction today. The FR-030 invariant
        // ("emission failure must not roll back issuance") is satisfied by
        // those properties now, and in the future will be the responsibility
        // of AnalyticsService itself when it gains a real PostHog client.
        this.analytics.capture(created.userId, 'certificate_issued', {
          certificateId: created.id,
          certificateType: created.type,
          pathId: created.pathId,
          courseId: created.courseId,
          certificateCode: created.certificateCode,
          issuedAt: created.issuedAt.toISOString(),
        });

        return created;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw new InternalServerErrorException(
      'Failed to generate unique certificate code',
      { cause: lastErr instanceof Error ? lastErr : undefined },
    );
  }

  private generateCode(): string {
    return randomUUID().replace(/-/g, '').slice(0, 12);
  }

  private async allCourseQuizzesPassed(
    _tx: Prisma.TransactionClient,
    _userId: string,
    _courseId: string,
  ): Promise<boolean> {
    // TODO(KAN-quizzes): replace this with a real check that every Quiz in the
    // course has at least one QuizAttempt with status = 'PASSED' for the
    // given user. The quiz subsystem has no submission flow yet, so no
    // attempts exist; treating this as satisfied lets the cascade reach
    // course-cert issuance. Per FR-015 this fallback is intentional and
    // satisfied *regardless of how many quizzes the course defines*.
    return true;
  }

  // ---------- Read/public endpoints ------------------------------------------

  async listForUser(userId: string): Promise<CertificateResponseDto[]> {
    const rows = await this.prisma.certificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
      include: {
        path: { select: { id: true, title: true, slug: true } },
        course: { select: { id: true, title: true, slug: true } },
      },
    });
    return rows.map((c) =>
      CertificateResponseDto.fromEntity(c as CertificateWithRelations),
    );
  }

  async verifyByCode(code: string): Promise<CertificateVerificationDto> {
    const cert = await this.prisma.certificate.findUnique({
      where: { certificateCode: code },
      include: {
        user: { select: { name: true } },
        path: { select: { title: true, slug: true } },
        course: { select: { title: true, slug: true } },
      },
    });
    if (!cert) {
      throw new NotFoundException('Certificate not found');
    }

    const subject =
      cert.type === CertificateType.PATH
        ? {
            type: CertificateType.PATH,
            title: cert.path!.title,
            slug: cert.path!.slug,
          }
        : {
            type: CertificateType.COURSE,
            title: cert.course!.title,
            slug: cert.course!.slug,
          };

    return {
      valid: true,
      type: cert.type,
      issuedAt: cert.issuedAt.toISOString(),
      holder: { fullName: cert.user.name },
      subject,
    };
  }
}
