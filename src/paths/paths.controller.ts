import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PathsService } from './paths.service';

@Controller('paths')
export class PathsController {
  constructor(private readonly pathsService: PathsService) {}

  @Get()
  @Public()
  findAll() {
    return {};
  }
}
