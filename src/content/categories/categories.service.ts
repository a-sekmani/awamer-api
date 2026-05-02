// KAN-82: CategoriesAdminService invokes this.cache.del(CacheKeys.categories.all())
// on every successful mutation (POST/PATCH/DELETE) so this public read sees fresh data.

import { Injectable } from '@nestjs/common';
import { CategoryStatus, CourseStatus, PathStatus } from '@prisma/client';
import { CacheKeys, CacheTTL } from '../../common/cache/cache-keys';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryResponseDto } from './dto/category-response.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async listAllPublic(): Promise<CategoryResponseDto[]> {
    const key = CacheKeys.categories.all();
    const cached = await this.cache.get<CategoryResponseDto[]>(key);
    if (cached !== null) return cached;

    const rows = await this.prisma.category.findMany({
      where: { status: CategoryStatus.ACTIVE },
      orderBy: { order: 'asc' },
      include: {
        _count: {
          select: {
            paths: { where: { status: PathStatus.PUBLISHED } },
            courses: { where: { status: CourseStatus.PUBLISHED } },
          },
        },
      },
    });

    const dto: CategoryResponseDto[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      order: row.order,
      pathCount: row._count.paths,
      courseCount: row._count.courses,
    }));

    await this.cache.set(key, dto, CacheTTL.CATEGORIES);
    return dto;
  }
}
