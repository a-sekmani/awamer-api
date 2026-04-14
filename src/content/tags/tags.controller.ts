import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { TagsService } from './tags.service';
import { TagResponseDto } from './dto/tag-response.dto';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  async list(): Promise<TagResponseDto[]> {
    return this.tagsService.listPublic();
  }
}
