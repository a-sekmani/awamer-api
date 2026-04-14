import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { AdminTagResponseDto } from './dto/admin-tag-response.dto';

// TODO(auth): replace with real admin guard once the admin role mechanism is
// fully implemented — `RolesGuard` is currently a stub that always returns true.
@Controller('admin/tags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  async list(): Promise<AdminTagResponseDto[]> {
    return this.tagsService.listAdmin();
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateTagDto): Promise<AdminTagResponseDto> {
    return this.tagsService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTagDto,
  ): Promise<AdminTagResponseDto> {
    return this.tagsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.tagsService.remove(id);
  }
}
