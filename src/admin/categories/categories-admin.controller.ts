import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AdminEndpoint } from '../common/decorators/admin-endpoint.decorator';
import { CategoriesAdminService } from './categories-admin.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/**
 * CategoriesAdminController — admin CRUD over Category (KAN-82).
 *
 * `@AdminEndpoint()` at the class level applies JwtAuthGuard, RolesGuard, and
 * AuditLogInterceptor in one shot. The two providers (RolesGuard,
 * AuditLogInterceptor) are registered locally in CategoriesAdminModule per
 * FR-005a — sub-modules MUST NOT rely on `AdminModule.imports` cascade.
 */
@Controller('admin/categories')
@AdminEndpoint()
export class CategoriesAdminController {
  constructor(private readonly service: CategoriesAdminService) {}

  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() query: ListCategoriesQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
