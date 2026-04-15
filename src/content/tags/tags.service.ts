import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseStatus,
  PathStatus,
  Prisma,
  Tag,
  TagStatus,
} from '@prisma/client';
import { CacheKeys, CacheTTL } from '../../common/cache/cache-keys';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { TagResponseDto } from './dto/tag-response.dto';
import { AdminTagResponseDto } from './dto/admin-tag-response.dto';

type CountMap = Map<string, number>;

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async listPublic(): Promise<TagResponseDto[]> {
    const cached = await this.cache.get<TagResponseDto[]>(CacheKeys.tags.all());
    if (cached !== null) return cached;
    const tags = await this.prisma.tag.findMany({
      where: { status: TagStatus.ACTIVE },
      orderBy: { name: 'asc' },
    });
    const { pathCounts, courseCounts } = await this.loadCounts();
    const dto = tags.map((tag) =>
      this.toPublicDto(tag, pathCounts, courseCounts),
    );
    await this.cache.set(CacheKeys.tags.all(), dto, CacheTTL.TAGS);
    return dto;
  }

  async listAdmin(): Promise<AdminTagResponseDto[]> {
    const tags = await this.prisma.tag.findMany({
      orderBy: { name: 'asc' },
    });
    const { pathCounts, courseCounts } = await this.loadCounts();
    return tags.map((tag) => this.toAdminDto(tag, pathCounts, courseCounts));
  }

  async create(dto: CreateTagDto): Promise<AdminTagResponseDto> {
    await this.cache.del(CacheKeys.tags.all());
    await this.cache.del(CacheKeys.tags.adminAll());
    await this.cache.delByPattern(CacheKeys.paths.listPattern());
    await this.cache.delByPattern(CacheKeys.courses.listPattern());
    try {
      const tag = await this.prisma.tag.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          status: dto.status ?? TagStatus.ACTIVE,
        },
      });
      const { pathCounts, courseCounts } = await this.loadCounts();
      return this.toAdminDto(tag, pathCounts, courseCounts);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Tag with slug '${dto.slug}' already exists`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateTagDto): Promise<AdminTagResponseDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field must be provided');
    }
    await this.cache.del(CacheKeys.tags.all());
    await this.cache.del(CacheKeys.tags.adminAll());
    await this.cache.delByPattern(CacheKeys.paths.listPattern());
    await this.cache.delByPattern(CacheKeys.courses.listPattern());
    try {
      const tag = await this.prisma.tag.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
      const { pathCounts, courseCounts } = await this.loadCounts();
      return this.toAdminDto(tag, pathCounts, courseCounts);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          throw new NotFoundException(`Tag '${id}' not found`);
        }
        if (err.code === 'P2002') {
          throw new ConflictException(
            `Tag with slug '${dto.slug ?? ''}' already exists`,
          );
        }
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    await this.cache.del(CacheKeys.tags.all());
    await this.cache.del(CacheKeys.tags.adminAll());
    await this.cache.delByPattern(CacheKeys.paths.listPattern());
    await this.cache.delByPattern(CacheKeys.courses.listPattern());
    try {
      await this.prisma.tag.delete({ where: { id } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Tag '${id}' not found`);
      }
      throw err;
    }
  }

  private async loadCounts(): Promise<{
    pathCounts: CountMap;
    courseCounts: CountMap;
  }> {
    const [pathGroups, courseGroups] = await Promise.all([
      this.prisma.pathTag.groupBy({
        by: ['tagId'],
        where: { path: { status: PathStatus.PUBLISHED } },
        _count: { _all: true },
      }),
      this.prisma.courseTag.groupBy({
        by: ['tagId'],
        where: { course: { status: CourseStatus.PUBLISHED } },
        _count: { _all: true },
      }),
    ]);
    const pathCounts: CountMap = new Map(
      pathGroups.map((g) => [g.tagId, g._count._all]),
    );
    const courseCounts: CountMap = new Map(
      courseGroups.map((g) => [g.tagId, g._count._all]),
    );
    return { pathCounts, courseCounts };
  }

  private toPublicDto(
    tag: Tag,
    pathCounts: CountMap,
    courseCounts: CountMap,
  ): TagResponseDto {
    return {
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      pathCount: pathCounts.get(tag.id) ?? 0,
      courseCount: courseCounts.get(tag.id) ?? 0,
    };
  }

  private toAdminDto(
    tag: Tag,
    pathCounts: CountMap,
    courseCounts: CountMap,
  ): AdminTagResponseDto {
    return {
      ...this.toPublicDto(tag, pathCounts, courseCounts),
      status: tag.status,
      createdAt: tag.createdAt.toISOString(),
    };
  }
}
