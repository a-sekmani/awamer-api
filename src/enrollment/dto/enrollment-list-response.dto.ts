import { PathEnrollmentResponseDto } from './path-enrollment-response.dto';
import { CourseEnrollmentResponseDto } from './course-enrollment-response.dto';

export class EnrollmentListResponseDto {
  paths!: PathEnrollmentResponseDto[];
  courses!: CourseEnrollmentResponseDto[];
}
