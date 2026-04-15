import { Module } from '@nestjs/common';
import { MarketingModule } from '../marketing/marketing.module';
import { PathsController } from './paths.controller';
import { PathsService } from './paths.service';

@Module({
  imports: [MarketingModule],
  controllers: [PathsController],
  providers: [PathsService],
  exports: [PathsService],
})
export class PathsModule {}
