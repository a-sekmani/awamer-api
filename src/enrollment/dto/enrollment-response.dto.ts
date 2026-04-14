import { Expose } from 'class-transformer';

export class EnrollmentResponseDto {
  @Expose() id!: string;
  @Expose() userId!: string;
  @Expose() status!: string;
  @Expose() enrolledAt!: string;
}
