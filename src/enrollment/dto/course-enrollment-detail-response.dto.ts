import { Expose, Type } from 'class-transformer';
import {
  Course,
  CourseEnrollment,
  CourseProgress,
  LastPosition,
} from '@prisma/client';
import { CourseEnrollmentResponseDto } from './course-enrollment-response.dto';

class LastPositionSummaryDto {
  @Expose() sectionId!: string;
  @Expose() lessonId!: string;
  @Expose() accessedAt!: string;
}

export class CourseEnrollmentDetailResponseDto extends CourseEnrollmentResponseDto {
  @Expose()
  @Type(() => LastPositionSummaryDto)
  lastPosition!: LastPositionSummaryDto | null;

  static fromDetail(
    enrollment: CourseEnrollment & { course: Course },
    progress: CourseProgress | null,
    lastPosition: LastPosition | null,
  ): CourseEnrollmentDetailResponseDto {
    const base = CourseEnrollmentResponseDto.fromEntity(enrollment, progress);
    return {
      ...base,
      lastPosition: lastPosition
        ? {
            sectionId: lastPosition.sectionId,
            lessonId: lastPosition.lessonId,
            accessedAt: lastPosition.accessedAt.toISOString(),
          }
        : null,
    };
  }
}
