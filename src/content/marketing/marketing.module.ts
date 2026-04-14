import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AdminFeaturesController } from './features/admin-features.controller';
import { FeaturesService } from './features/features.service';
import { AdminFaqsController } from './faqs/admin-faqs.controller';
import { FaqsService } from './faqs/faqs.service';
import { AdminTestimonialsController } from './testimonials/admin-testimonials.controller';
import { TestimonialsService } from './testimonials/testimonials.service';
import { OwnerValidator } from './helpers/owner-validator.helper';
import { ReorderHelper } from './helpers/reorder.helper';
import { MarketingCleanupHelper } from './helpers/marketing-cleanup.helper';
import { PublicMarketingQueries } from './helpers/public-queries.helper';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminFeaturesController,
    AdminFaqsController,
    AdminTestimonialsController,
  ],
  providers: [
    FeaturesService,
    FaqsService,
    TestimonialsService,
    OwnerValidator,
    ReorderHelper,
    MarketingCleanupHelper,
    PublicMarketingQueries,
  ],
  exports: [
    OwnerValidator,
    ReorderHelper,
    MarketingCleanupHelper,
    PublicMarketingQueries,
  ],
})
export class MarketingModule {}
