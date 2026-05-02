import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, CategoryStatus, Prisma } from '@prisma/client';
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/library';
import { CacheKeys } from '../../common/cache/cache-keys';
import { CacheService } from '../../common/cache/cache.service';
import { ErrorCode } from '../../common/error-codes.enum';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryAdminResponseDto } from './dto/category-admin-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

interface CategoryRow extends Category {
  _count: { paths: number; courses: number };
}

@Injectable()
export class CategoriesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateCategoryDto): Promise<CategoryAdminResponseDto> {
    const nameClash = await this.prisma.category.findFirst({
      where: { name: dto.name },
    });
    if (nameClash) {
      throw new ConflictException({
        errorCode: ErrorCode.CATEGORY_NAME_EXISTS,
        message: 'Category name already exists',
      });
    }

    const slugClash = await this.prisma.category.findUnique({
      where: { slug: dto.slug },
    });
    if (slugClash) {
      throw new ConflictException({
        errorCode: ErrorCode.CATEGORY_SLUG_EXISTS,
        message: 'Category slug already exists',
      });
    }

    const created = await this.prisma.category.create({
      data: { name: dto.name, slug: dto.slug },
    });

    await this.cache.del(CacheKeys.categories.all());

    return this.toDto({ ...created, _count: { paths: 0, courses: 0 } });
  }

  async list(query: ListCategoriesQueryDto): Promise<{
    data: CategoryAdminResponseDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const where: Prisma.CategoryWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.status = query.status;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.category.count({ where }),
      this.prisma.category.findMany({
        where,
        include: { _count: { select: { paths: true, courses: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      data: rows.map((row) => this.toDto(row as CategoryRow)),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(id: string): Promise<CategoryAdminResponseDto> {
    const row = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { paths: true, courses: true } } },
    });
    if (!row) {
      throw new NotFoundException({
        errorCode: ErrorCode.CATEGORY_NOT_FOUND,
        message: 'Category not found',
      });
    }
    return this.toDto(row as CategoryRow);
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryAdminResponseDto> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        errorCode: ErrorCode.CATEGORY_NOT_FOUND,
        message: 'Category not found',
      });
    }

    if (dto.name !== undefined && dto.name !== existing.name) {
      const nameClash = await this.prisma.category.findFirst({
        where: { name: dto.name, NOT: { id } },
      });
      if (nameClash) {
        throw new ConflictException({
          errorCode: ErrorCode.CATEGORY_NAME_EXISTS,
          message: 'Category name already exists',
        });
      }
    }

    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      const slugClash = await this.prisma.category.findUnique({
        where: { slug: dto.slug },
      });
      if (slugClash && slugClash.id !== id) {
        throw new ConflictException({
          errorCode: ErrorCode.CATEGORY_SLUG_EXISTS,
          message: 'Category slug already exists',
        });
      }
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.status !== undefined && {
          status: dto.status as CategoryStatus,
        }),
      },
      include: { _count: { select: { paths: true, courses: true } } },
    });

    await this.cache.del(CacheKeys.categories.all());

    return this.toDto(updated as CategoryRow);
  }

  async remove(id: string): Promise<{ ok: true }> {
    try {
      await this.prisma.category.delete({ where: { id } });
    } catch (e) {
      if (this.isFKViolation(e)) {
        const [pathCount, courseCount] = await Promise.all([
          this.prisma.path.count({ where: { categoryId: id } }),
          this.prisma.course.count({ where: { categoryId: id } }),
        ]);
        throw new ConflictException({
          errorCode: ErrorCode.CATEGORY_IN_USE,
          message: 'Category is in use',
          errors: { pathCount, courseCount },
        });
      }
      if (this.isPrismaP2025(e)) {
        throw new NotFoundException({
          errorCode: ErrorCode.CATEGORY_NOT_FOUND,
          message: 'Category not found',
        });
      }
      throw e;
    }

    await this.cache.del(CacheKeys.categories.all());
    return { ok: true };
  }

  /**
   * Returns true for both Prisma error classes that surface a foreign-key violation:
   *   - PrismaClientKnownRequestError with code 'P2003' (a Cascade ripple blocked
   *     by a deeper constraint)
   *   - PrismaClientUnknownRequestError carrying SQLSTATE 23001 (a Restrict FK
   *     directly rejecting the delete — the post-migration case for paths.categoryId
   *     and courses.pathId).
   * KAN-82 fixes both Path.category and Course.path to Restrict; the dual-class
   * match is required.
   */
  private isFKViolation(e: unknown): boolean {
    if (e instanceof PrismaClientKnownRequestError && e.code === 'P2003') {
      return true;
    }
    if (
      e instanceof PrismaClientUnknownRequestError &&
      /23001/.test(e.message)
    ) {
      return true;
    }
    return false;
  }

  private isPrismaP2025(e: unknown): boolean {
    return e instanceof PrismaClientKnownRequestError && e.code === 'P2025';
  }

  private toDto(row: CategoryRow): CategoryAdminResponseDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      order: row.order,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      pathCount: row._count.paths,
      courseCount: row._count.courses,
    };
  }
}
