import { Expose, Type } from 'class-transformer';
import {
  PathEnrollment,
  Path,
  PathProgress,
  ProgressStatus,
} from '@prisma/client';

class PathSummaryDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() slug!: string;
  @Expose() thumbnail!: string | null;
}

class ProgressSummaryDto {
  @Expose() percentComplete!: number;
  @Expose() status!: ProgressStatus;
}

export class PathEnrollmentResponseDto {
  @Expose() id!: string;
  @Expose() userId!: string;
  @Expose() pathId!: string;
  @Expose() status!: string;
  @Expose() enrolledAt!: string;
  @Expose() @Type(() => PathSummaryDto) path!: PathSummaryDto;
  @Expose() @Type(() => ProgressSummaryDto) progress!: ProgressSummaryDto;

  static fromEntity(
    enrollment: PathEnrollment & { path: Path },
    progress: PathProgress | null,
  ): PathEnrollmentResponseDto {
    return {
      id: enrollment.id,
      userId: enrollment.userId,
      pathId: enrollment.pathId,
      status: enrollment.status,
      enrolledAt: enrollment.enrolledAt.toISOString(),
      path: {
        id: enrollment.path.id,
        title: enrollment.path.title,
        slug: enrollment.path.slug,
        thumbnail: enrollment.path.thumbnail,
      },
      progress: {
        percentComplete: progress?.percentage ?? 0,
        status: progress?.status ?? ProgressStatus.NOT_STARTED,
      },
    };
  }
}
