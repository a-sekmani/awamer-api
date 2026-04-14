import { Expose, Type } from 'class-transformer';
import { CertificateType } from '@prisma/client';

class HolderDto {
  @Expose() fullName!: string;
}

class SubjectDto {
  @Expose() type!: CertificateType;
  @Expose() title!: string;
  @Expose() slug!: string;
}

/**
 * Strict allow-list DTO for the PUBLIC verification endpoint.
 *
 * FR-021 prohibits leaking email, enrollment date, progress data, or any other
 * non-essential private data. The class uses `@Expose()` so that when the
 * global `ClassSerializerInterceptor` runs with `excludeExtraneousValues`, any
 * field that happens to be on the object but is not declared here is dropped.
 * Per clarification Q2, the holder is exposed only as a single `fullName` —
 * never split on whitespace, never carrying user id or email.
 */
export class CertificateVerificationDto {
  @Expose() valid!: true;
  @Expose() type!: CertificateType;
  @Expose() issuedAt!: string;
  @Expose() @Type(() => HolderDto) holder!: HolderDto;
  @Expose() @Type(() => SubjectDto) subject!: SubjectDto;
}
