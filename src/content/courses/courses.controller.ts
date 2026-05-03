import { Controller, Get, HttpCode, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CoursesService } from './courses.service';
import { ListCoursesQueryDto } from './dto/list-courses.query.dto';
import { CourseSummaryDto, PaginatedResponse } from './dto/course-summary.dto';
import { CourseDetailDto } from './dto/course-detail.dto';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Public()
  @Get()
  @HttpCode(200)
  async list(
    @Query() query: ListCoursesQueryDto,
  ): Promise<PaginatedResponse<CourseSummaryDto>> {
    return this.coursesService.listPublic(query);
  }

  @Public()
  @Get(':slug')
  @HttpCode(200)
  async findBySlug(@Param('slug') slug: string): Promise<CourseDetailDto> {
    return this.coursesService.findDetailBySlug(slug);
  }
}
