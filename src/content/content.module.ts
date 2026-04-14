import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TagsController } from './tags/tags.controller';
import { AdminTagsController } from './tags/admin-tags.controller';
import { TagsService } from './tags/tags.service';
import { ReplaceTagAssociationsHelper } from './tags/helpers/replace-tag-associations.helper';

@Module({
  imports: [AuthModule],
  controllers: [TagsController, AdminTagsController],
  providers: [TagsService, ReplaceTagAssociationsHelper],
  exports: [ReplaceTagAssociationsHelper],
})
export class ContentModule {}
