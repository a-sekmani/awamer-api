import { Controller, Get, HttpCode } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  @HttpCode(200)
  async list(): Promise<CategoryResponseDto[]> {
    return this.categoriesService.listAllPublic();
  }
}
