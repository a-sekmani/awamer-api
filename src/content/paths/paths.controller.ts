import {
  Controller,
  Get,
  HttpCode,
  Param,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PathsService } from './paths.service';
import { ListPathsQueryDto } from './dto/list-paths.query.dto';
import {
  PaginatedResponse,
  PathSummaryDto,
} from './dto/path-summary.dto';
import { PathDetailDto } from './dto/path-detail.dto';

@Controller('paths')
export class PathsController {
  constructor(private readonly pathsService: PathsService) {}

  @Public()
  @Get()
  @HttpCode(200)
  async list(
    @Query() query: ListPathsQueryDto,
  ): Promise<PaginatedResponse<PathSummaryDto>> {
    return this.pathsService.listPublic(query);
  }

  @Public()
  @Get(':slug')
  @HttpCode(200)
  async findBySlug(@Param('slug') slug: string): Promise<PathDetailDto> {
    return this.pathsService.findDetailBySlug(slug);
  }
}
