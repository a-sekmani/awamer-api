import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MarketingOwnerType } from '@prisma/client';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { FeaturesService } from './features.service';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { FeatureResponseDto } from './dto/feature-response.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';

// TODO(auth): RolesGuard is currently a stub; revisit once the admin role
// mechanism lands. See src/content/tags/admin-tags.controller.ts.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminFeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get('paths/:ownerId/features')
  listForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<FeatureResponseDto[]> {
    return this.features.listByOwner(MarketingOwnerType.PATH, ownerId);
  }

  @Get('courses/:ownerId/features')
  listForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<FeatureResponseDto[]> {
    return this.features.listByOwner(MarketingOwnerType.COURSE, ownerId);
  }

  @Post('paths/:ownerId/features')
  @HttpCode(201)
  createForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: CreateFeatureDto,
  ): Promise<FeatureResponseDto> {
    return this.features.create(MarketingOwnerType.PATH, ownerId, dto);
  }

  @Post('courses/:ownerId/features')
  @HttpCode(201)
  createForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: CreateFeatureDto,
  ): Promise<FeatureResponseDto> {
    return this.features.create(MarketingOwnerType.COURSE, ownerId, dto);
  }

  @Patch('features/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeatureDto,
  ): Promise<FeatureResponseDto> {
    return this.features.update(id, dto);
  }

  @Patch('paths/:ownerId/features/reorder')
  reorderForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: ReorderItemsDto,
  ): Promise<FeatureResponseDto[]> {
    return this.features.reorder(MarketingOwnerType.PATH, ownerId, dto.itemIds);
  }

  @Patch('courses/:ownerId/features/reorder')
  reorderForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: ReorderItemsDto,
  ): Promise<FeatureResponseDto[]> {
    return this.features.reorder(
      MarketingOwnerType.COURSE,
      ownerId,
      dto.itemIds,
    );
  }

  @Delete('features/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.features.remove(id);
  }
}
