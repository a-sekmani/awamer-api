import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EnrollmentGuard } from '../common/guards/enrollment.guard';
import { ContentAccessGuard } from '../common/guards/content-access.guard';
import { ProgressService } from '../progress/progress.service';

@Controller('learning')
export class LearningController {
  constructor(private readonly progress: ProgressService) {}

  // Guard order per Decision 9 + FR-025: JWT → Enrollment → Access. The
  // three guards are listed explicitly at the method level so the order of
  // evaluation is deterministic and reviewable.
  @Post('lessons/:lessonId/complete')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, EnrollmentGuard, ContentAccessGuard)
  async complete(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req: Request,
  ) {
    const { userId } = req.user as { userId: string };
    return this.progress.completeLesson(userId, lessonId);
  }
}
