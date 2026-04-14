import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseEnrollment,
  CourseEnrollmentStatus,
  EnrollmentStatus,
  PathEnrollment,
  Prisma,
  ProgressStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PathEnrollmentResponseDto } from './dto/path-enrollment-response.dto';
import { CourseEnrollmentResponseDto } from './dto/course-enrollment-response.dto';
import { EnrollmentListResponseDto } from './dto/enrollment-list-response.dto';
import { CourseEnrollmentDetailResponseDto } from './dto/course-enrollment-detail-response.dto';

@Injectable()
export class EnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Path enrollment -------------------------------------------------

  async enrollInPath(userId: string, pathId: string): Promise<PathEnrollment> {
    return this.prisma.$transaction(async (tx) => {
      const path = await tx.path.findUnique({
        where: { id: pathId },
        include: {
          courses: {
            select: { id: true, sections: { select: { id: true } } },
          },
        },
      });
      if (!path) {
        throw new NotFoundException(`Path '${pathId}' does not exist`);
      }

      const existing = await tx.pathEnrollment.findFirst({
        where: { userId, pathId },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(`Already enrolled in path '${pathId}'`);
      }

      const enrollment = await tx.pathEnrollment.create({
        data: { userId, pathId, status: EnrollmentStatus.ACTIVE },
      });

      await tx.pathProgress.create({
        data: {
          userId,
          pathId,
          totalCourses: path.courses.length,
          completedCourses: 0,
          percentage: 0,
          status: ProgressStatus.NOT_STARTED,
        },
      });

      for (const course of path.courses) {
        await tx.courseProgress.create({
          data: {
            userId,
            courseId: course.id,
            totalSections: course.sections.length,
            completedSections: 0,
            percentage: 0,
            status: ProgressStatus.NOT_STARTED,
          },
        });
      }

      return enrollment;
    });
  }

  // ---------- Course enrollment -----------------------------------------------

  async enrollInCourse(
    userId: string,
    courseId: string,
  ): Promise<CourseEnrollment> {
    return this.prisma.$transaction(async (tx) => {
      const course = await tx.course.findUnique({
        where: { id: courseId },
        include: {
          sections: { select: { id: true, lessons: { select: { id: true } } } },
        },
      });
      if (!course) {
        throw new NotFoundException(`Course '${courseId}' does not exist`);
      }
      if (course.pathId !== null) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Course '${courseId}' belongs to a path. Enroll in the parent path instead.`,
          parentPathId: course.pathId,
          error: 'Bad Request',
        });
      }

      try {
        const enrollment = await tx.courseEnrollment.create({
          data: {
            userId,
            courseId,
            status: CourseEnrollmentStatus.ACTIVE,
          },
        });

        await tx.courseProgress.create({
          data: {
            userId,
            courseId,
            totalSections: course.sections.length,
            completedSections: 0,
            percentage: 0,
            status: ProgressStatus.NOT_STARTED,
          },
        });

        for (const section of course.sections) {
          await tx.sectionProgress.create({
            data: {
              userId,
              sectionId: section.id,
              totalLessons: section.lessons.length,
              completedLessons: 0,
              percentage: 0,
              status: ProgressStatus.NOT_STARTED,
            },
          });
        }

        return enrollment;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            `Already enrolled in course '${courseId}'`,
          );
        }
        throw err;
      }
    });
  }

  // ---------- Reads -----------------------------------------------------------

  async listAllForUser(userId: string): Promise<EnrollmentListResponseDto> {
    const [pathEnrollments, courseEnrollments] = await Promise.all([
      this.prisma.pathEnrollment.findMany({
        where: { userId },
        include: { path: true },
        orderBy: { enrolledAt: 'desc' },
      }),
      this.prisma.courseEnrollment.findMany({
        where: { userId, course: { pathId: null } },
        include: { course: true },
        orderBy: { enrolledAt: 'desc' },
      }),
    ]);

    const pathProgresses = await this.prisma.pathProgress.findMany({
      where: {
        userId,
        pathId: { in: pathEnrollments.map((e) => e.pathId) },
      },
    });
    const pathProgressByPathId = new Map(
      pathProgresses.map((p) => [p.pathId, p]),
    );

    const courseProgresses = await this.prisma.courseProgress.findMany({
      where: {
        userId,
        courseId: { in: courseEnrollments.map((e) => e.courseId) },
      },
    });
    const courseProgressByCourseId = new Map(
      courseProgresses.map((p) => [p.courseId, p]),
    );

    return {
      paths: pathEnrollments.map((e) =>
        PathEnrollmentResponseDto.fromEntity(
          e,
          pathProgressByPathId.get(e.pathId) ?? null,
        ),
      ),
      courses: courseEnrollments.map((e) =>
        CourseEnrollmentResponseDto.fromEntity(
          e,
          courseProgressByCourseId.get(e.courseId) ?? null,
        ),
      ),
    };
  }

  async getCourseEnrollment(
    userId: string,
    courseId: string,
  ): Promise<CourseEnrollmentDetailResponseDto | null> {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      include: { course: true },
    });
    if (!enrollment) return null;

    const [progress, lastPosition] = await Promise.all([
      this.prisma.courseProgress.findUnique({
        where: { userId_courseId: { userId, courseId } },
      }),
      this.prisma.lastPosition.findFirst({
        where: { userId, courseId },
      }),
    ]);

    return CourseEnrollmentDetailResponseDto.fromDetail(
      enrollment,
      progress,
      lastPosition,
    );
  }

  // ---------- Guard support ---------------------------------------------------

  /**
   * Used by EnrollmentGuard. Returns true only if the user has an ACTIVE
   * enrollment that grants access to the given course — either a direct
   * course enrollment (for standalone courses) or a path enrollment for the
   * course's parent path. Non-ACTIVE statuses return false (clarification Q3).
   */
  async hasAccessToCourse(
    userId: string,
    courseId: string,
  ): Promise<boolean> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, pathId: true },
    });
    if (!course) return false;

    if (course.pathId !== null) {
      const pe = await this.prisma.pathEnrollment.findFirst({
        where: {
          userId,
          pathId: course.pathId,
          status: EnrollmentStatus.ACTIVE,
        },
        select: { id: true },
      });
      return pe !== null;
    }

    const ce = await this.prisma.courseEnrollment.findFirst({
      where: {
        userId,
        courseId,
        status: CourseEnrollmentStatus.ACTIVE,
      },
      select: { id: true },
    });
    return ce !== null;
  }
}
