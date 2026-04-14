import { Module } from '@nestjs/common';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { ProgressModule } from '../progress/progress.module';
import { EnrollmentGuard } from '../common/guards/enrollment.guard';
import { ContentAccessGuard } from '../common/guards/content-access.guard';
import { LearningController } from './learning.controller';

@Module({
  imports: [EnrollmentModule, ProgressModule],
  controllers: [LearningController],
  providers: [EnrollmentGuard, ContentAccessGuard],
})
export class LearningModule {}
