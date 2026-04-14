import { Expose, Type } from 'class-transformer';
import {
  Course,
  CourseEnrollment,
  CourseProgress,
  ProgressStatus,
} from '@prisma/client';

class CourseSummaryDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() slug!: string;
  @Expose() thumbnail!: string | null;
}

class ProgressSummaryDto {
  @Expose() percentComplete!: number;
  @Expose() status!: ProgressStatus;
}

export class CourseEnrollmentResponseDto {
  @Expose() id!: string;
  @Expose() userId!: string;
  @Expose() courseId!: string;
  @Expose() status!: string;
  @Expose() enrolledAt!: string;
  @Expose() @Type(() => CourseSummaryDto) course!: CourseSummaryDto;
  @Expose() @Type(() => ProgressSummaryDto) progress!: ProgressSummaryDto;

  static fromEntity(
    enrollment: CourseEnrollment & { course: Course },
    progress: CourseProgress | null,
  ): CourseEnrollmentResponseDto {
    return {
      id: enrollment.id,
      userId: enrollment.userId,
      courseId: enrollment.courseId,
      status: enrollment.status,
      enrolledAt: enrollment.enrolledAt.toISOString(),
      course: {
        id: enrollment.course.id,
        title: enrollment.course.title,
        slug: enrollment.course.slug,
        thumbnail: enrollment.course.thumbnail,
      },
      progress: {
        percentComplete: progress?.percentage ?? 0,
        status: progress?.status ?? ProgressStatus.NOT_STARTED,
      },
    };
  }
}
