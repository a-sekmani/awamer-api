import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
