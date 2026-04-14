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
import { FaqsService } from './faqs.service';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import { FaqResponseDto } from './dto/faq-response.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';

// TODO(auth): RolesGuard is currently a stub; revisit once the admin role
// mechanism lands. See src/content/tags/admin-tags.controller.ts.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminFaqsController {
  constructor(private readonly faqs: FaqsService) {}

  @Get('paths/:ownerId/faqs')
  listForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<FaqResponseDto[]> {
    return this.faqs.listByOwner(MarketingOwnerType.PATH, ownerId);
  }

  @Get('courses/:ownerId/faqs')
  listForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<FaqResponseDto[]> {
    return this.faqs.listByOwner(MarketingOwnerType.COURSE, ownerId);
  }

  @Post('paths/:ownerId/faqs')
  @HttpCode(201)
  createForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: CreateFaqDto,
  ): Promise<FaqResponseDto> {
    return this.faqs.create(MarketingOwnerType.PATH, ownerId, dto);
  }

  @Post('courses/:ownerId/faqs')
  @HttpCode(201)
  createForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: CreateFaqDto,
  ): Promise<FaqResponseDto> {
    return this.faqs.create(MarketingOwnerType.COURSE, ownerId, dto);
  }

  @Patch('faqs/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFaqDto,
  ): Promise<FaqResponseDto> {
    return this.faqs.update(id, dto);
  }

  @Patch('paths/:ownerId/faqs/reorder')
  reorderForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: ReorderItemsDto,
  ): Promise<FaqResponseDto[]> {
    return this.faqs.reorder(MarketingOwnerType.PATH, ownerId, dto.itemIds);
  }

  @Patch('courses/:ownerId/faqs/reorder')
  reorderForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: ReorderItemsDto,
  ): Promise<FaqResponseDto[]> {
    return this.faqs.reorder(MarketingOwnerType.COURSE, ownerId, dto.itemIds);
  }

  @Delete('faqs/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.faqs.remove(id);
  }
}
