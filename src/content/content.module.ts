import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TagsController } from './tags/tags.controller';
import { AdminTagsController } from './tags/admin-tags.controller';
import { TagsService } from './tags/tags.service';
import { ReplaceTagAssociationsHelper } from './tags/helpers/replace-tag-associations.helper';
import { MarketingModule } from './marketing/marketing.module';
import { CategoriesModule } from './categories/categories.module';
import { PathsModule } from './paths/paths.module';
import { CoursesModule } from './courses/courses.module';

@Module({
  imports: [
    AuthModule,
    MarketingModule,
    CategoriesModule,
    PathsModule,
    CoursesModule,
  ],
  controllers: [TagsController, AdminTagsController],
  providers: [TagsService, ReplaceTagAssociationsHelper],
  exports: [ReplaceTagAssociationsHelper, MarketingModule],
})
export class ContentModule {}
