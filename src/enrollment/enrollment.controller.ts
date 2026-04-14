import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EnrollmentService } from './enrollment.service';
import { EnrollmentListResponseDto } from './dto/enrollment-list-response.dto';
import { CourseEnrollmentDetailResponseDto } from './dto/course-enrollment-detail-response.dto';

@Controller('enrollments')
@UseGuards(JwtAuthGuard)
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Post('paths/:pathId')
  @HttpCode(201)
  async enrollInPath(
    @Param('pathId', ParseUUIDPipe) pathId: string,
    @Req() req: Request,
  ) {
    const { userId } = req.user as { userId: string };
    return this.enrollment.enrollInPath(userId, pathId);
  }

  @Post('courses/:courseId')
  @HttpCode(201)
  async enrollInCourse(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Req() req: Request,
  ) {
    const { userId } = req.user as { userId: string };
    return this.enrollment.enrollInCourse(userId, courseId);
  }

  @Get('me')
  async listMine(@Req() req: Request): Promise<EnrollmentListResponseDto> {
    const { userId } = req.user as { userId: string };
    return this.enrollment.listAllForUser(userId);
  }

  @Get('me/courses/:courseId')
  async getCourseEnrollment(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Req() req: Request,
  ): Promise<CourseEnrollmentDetailResponseDto> {
    const { userId } = req.user as { userId: string };
    const result = await this.enrollment.getCourseEnrollment(userId, courseId);
    if (!result) {
      throw new NotFoundException('Enrollment not found');
    }
    return result;
  }
}
