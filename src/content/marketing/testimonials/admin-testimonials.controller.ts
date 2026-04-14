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
import { TestimonialsService } from './testimonials.service';
import { CreateTestimonialDto } from './dto/create-testimonial.dto';
import { UpdateTestimonialDto } from './dto/update-testimonial.dto';
import { UpdateTestimonialStatusDto } from './dto/update-testimonial-status.dto';
import { TestimonialResponseDto } from './dto/testimonial-response.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';

// TODO(auth): RolesGuard is currently a stub; revisit once the admin role
// mechanism lands. See src/content/tags/admin-tags.controller.ts.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get('paths/:ownerId/testimonials')
  listForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<TestimonialResponseDto[]> {
    return this.testimonials.listByOwner(MarketingOwnerType.PATH, ownerId);
  }

  @Get('courses/:ownerId/testimonials')
  listForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<TestimonialResponseDto[]> {
    return this.testimonials.listByOwner(MarketingOwnerType.COURSE, ownerId);
  }

  @Post('paths/:ownerId/testimonials')
  @HttpCode(201)
  createForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: CreateTestimonialDto,
  ): Promise<TestimonialResponseDto> {
    return this.testimonials.create(MarketingOwnerType.PATH, ownerId, dto);
  }

  @Post('courses/:ownerId/testimonials')
  @HttpCode(201)
  createForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: CreateTestimonialDto,
  ): Promise<TestimonialResponseDto> {
    return this.testimonials.create(MarketingOwnerType.COURSE, ownerId, dto);
  }

  @Patch('testimonials/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTestimonialDto,
  ): Promise<TestimonialResponseDto> {
    return this.testimonials.update(id, dto);
  }

  @Patch('testimonials/:id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTestimonialStatusDto,
  ): Promise<TestimonialResponseDto> {
    return this.testimonials.updateStatus(id, dto);
  }

  @Patch('paths/:ownerId/testimonials/reorder')
  reorderForPath(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: ReorderItemsDto,
  ): Promise<TestimonialResponseDto[]> {
    return this.testimonials.reorder(
      MarketingOwnerType.PATH,
      ownerId,
      dto.itemIds,
    );
  }

  @Patch('courses/:ownerId/testimonials/reorder')
  reorderForCourse(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: ReorderItemsDto,
  ): Promise<TestimonialResponseDto[]> {
    return this.testimonials.reorder(
      MarketingOwnerType.COURSE,
      ownerId,
      dto.itemIds,
    );
  }

  @Delete('testimonials/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.testimonials.remove(id);
  }
}
