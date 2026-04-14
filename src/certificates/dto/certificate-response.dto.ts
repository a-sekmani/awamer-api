import { Expose, Type } from 'class-transformer';
import { Certificate, CertificateType } from '@prisma/client';

class SubjectSummaryDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() slug!: string;
}

export type CertificateWithRelations = Certificate & {
  path?: { id: string; title: string; slug: string } | null;
  course?: { id: string; title: string; slug: string } | null;
};

export class CertificateResponseDto {
  @Expose() id!: string;
  @Expose() type!: CertificateType;
  @Expose() pathId!: string | null;
  @Expose() courseId!: string | null;
  @Expose() certificateCode!: string;
  @Expose() issuedAt!: string;
  @Expose() @Type(() => SubjectSummaryDto) path!: SubjectSummaryDto | null;
  @Expose() @Type(() => SubjectSummaryDto) course!: SubjectSummaryDto | null;

  static fromEntity(c: CertificateWithRelations): CertificateResponseDto {
    return {
      id: c.id,
      type: c.type,
      pathId: c.pathId,
      courseId: c.courseId,
      certificateCode: c.certificateCode,
      issuedAt: c.issuedAt.toISOString(),
      path:
        c.type === CertificateType.PATH && c.path
          ? { id: c.path.id, title: c.path.title, slug: c.path.slug }
          : null,
      course:
        c.type === CertificateType.COURSE && c.course
          ? { id: c.course.id, title: c.course.title, slug: c.course.slug }
          : null,
    };
  }
}
