import { IsEnum } from 'class-validator';
import { TestimonialStatus } from '@prisma/client';

export class UpdateTestimonialStatusDto {
  @IsEnum(TestimonialStatus)
  status!: TestimonialStatus;
}
