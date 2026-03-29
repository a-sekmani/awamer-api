import { Controller, Get } from '@nestjs/common';
import { ProgressService } from './progress.service';

@Controller('progress')
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get()
  findAll() {
    return {};
  }
}
