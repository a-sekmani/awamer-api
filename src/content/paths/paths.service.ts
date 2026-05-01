import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CourseStatus,
  MarketingOwnerType,
  PathStatus,
  Prisma,
} from '@prisma/client';
import { CacheKeys, CacheTTL } from '../../common/cache/cache-keys';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicMarketingQueries } from '../marketing/helpers/public-queries.helper';
import { ListPathsQueryDto } from './dto/list-paths.query.dto';
import {
  PaginatedResponse,
  PathSummaryDto,
} from './dto/path-summary.dto';
import { PathDetailDto } from './dto/path-detail.dto';
import {
  applyIsFreeOverride,
  buildOrderBy,
  computePathStats,
} from './path-stats.helper';
import {
  toPathDetailDto,
  toPathSummaryDto,
} from './path-mapper';
import {
  toFaqDto,
  toFeatureDto,
  toTestimonialDto,
} from './marketing-mapper';
import { computeQueryHash } from './query-hash.helper';

function buildPathListWhere(query: ListPathsQueryDto): Prisma.PathWhereInput {
  const where: Prisma.PathWhereInput = { status: PathStatus.PUBLISHED };
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.tagId) {
    where.tags = { some: { tagId: query.tagId } };
  }
  if (query.level) {
    where.level = { equals: query.level, mode: 'insensitive' };
  }
  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { subtitle: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

@Injectable()
export class PathsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly marketing: PublicMarketingQueries,
  ) {}

  async listPublic(
    query: ListPathsQueryDto,
  ): Promise<PaginatedResponse<PathSummaryDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const hash = computeQueryHash(query);
    const key = CacheKeys.paths.list(hash);

    const cached = await this.cache.get<PaginatedResponse<PathSummaryDto>>(key);
    if (cached !== null) return cached;

    const where = buildPathListWhere(query);
    const orderBy = buildOrderBy(query);
    const skip = (page - 1) * limit;

    // TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits, add
    // @@index([status, order]) on Path.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.path.findMany({
        where,
        include: {
          category: true,
          tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
          courses: {
            where: { status: CourseStatus.PUBLISHED },
            include: {
              sections: { include: { lessons: true } },
              _count: { select: { projects: true } },
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.path.count({ where }),
    ]);

    const data = items.map((p) =>
      toPathSummaryDto(p as never, computePathStats(p as never)),
    );
    const result: PaginatedResponse<PathSummaryDto> = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    await this.cache.set(key, result, CacheTTL.LIST);
    return result;
  }

  async findDetailBySlug(slug: string): Promise<PathDetailDto> {
    const key = CacheKeys.paths.detail(slug);
    const cached = await this.cache.get<PathDetailDto>(key);
    if (cached !== null) return cached;

    // TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits, add
    // @@index([pathId, status, order]) on Course.
    const path = await this.prisma.path.findUnique({
      where: { slug },
      include: {
        category: true,
        tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
        courses: {
          where: { status: CourseStatus.PUBLISHED },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          include: {
            sections: {
              orderBy: { order: 'asc' },
              include: {
                lessons: {
                  orderBy: { order: 'asc' },
                  select: { estimatedMinutes: true, isFree: true },
                },
              },
            },
            _count: { select: { projects: true } },
          },
        },
      },
    });

    if (!path || path.status !== PathStatus.PUBLISHED) {
      throw new NotFoundException(`Path with slug "${slug}" not found`);
    }

    // Decision B / FR-023: three parallel marketing queries via Promise.all.
    const [features, faqs, testimonials] = await Promise.all([
      this.marketing.getFeaturesByOwner(MarketingOwnerType.PATH, path.id),
      this.marketing.getFaqsByOwner(MarketingOwnerType.PATH, path.id),
      this.marketing.getApprovedTestimonialsByOwner(
        MarketingOwnerType.PATH,
        path.id,
      ),
    ]);

    if (path.isFree) applyIsFreeOverride(path as never);

    const stats = computePathStats(path as never);
    const dto = toPathDetailDto(
      path as never,
      {
        features: features.map(toFeatureDto),
        faqs: faqs.map(toFaqDto),
        testimonials: testimonials.map(toTestimonialDto),
      },
      stats,
    );

    await this.cache.set(key, dto, CacheTTL.DETAIL);
    return dto;
  }
}
