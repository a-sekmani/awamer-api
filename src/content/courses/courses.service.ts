import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseLevel,
  CourseStatus,
  MarketingOwnerType,
  Prisma,
} from '@prisma/client';
import { CacheKeys, CacheTTL } from '../../common/cache/cache-keys';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicMarketingQueries } from '../marketing/helpers/public-queries.helper';
import { ListCoursesQueryDto } from './dto/list-courses.query.dto';
import {
  CourseSummaryDto,
  PaginatedResponse,
} from './dto/course-summary.dto';
import { CourseDetailDto } from './dto/course-detail.dto';
import {
  buildCourseOrderBy,
  computeCourseStats,
  applyIsFreeOverride,
} from './course-stats.helper';
import {
  toCourseDetailDto,
  toCourseSummaryDto,
} from './course-mapper';
import {
  toFaqDto,
  toFeatureDto,
  toTestimonialDto,
} from '../paths/marketing-mapper';
import { computeQueryHash } from '../paths/query-hash.helper';

function buildCourseListWhere(
  query: ListCoursesQueryDto,
): Prisma.CourseWhereInput {
  const where: Prisma.CourseWhereInput = { status: CourseStatus.PUBLISHED };
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.tagId) {
    where.tags = { some: { tagId: query.tagId } };
  }
  if (query.level) {
    where.level = query.level.toUpperCase() as CourseLevel;
  }
  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { subtitle: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.pathId) {
    where.pathId = query.pathId;
  } else if (query.standalone === true) {
    where.pathId = null;
  }
  return where;
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly marketing: PublicMarketingQueries,
  ) {}

  async listPublic(
    query: ListCoursesQueryDto,
  ): Promise<PaginatedResponse<CourseSummaryDto>> {
    if (query.pathId && query.standalone === true) {
      throw new BadRequestException(
        'Cannot supply both pathId and standalone',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const hash = computeQueryHash(query);
    const key = CacheKeys.courses.list(hash);

    const cached =
      await this.cache.get<PaginatedResponse<CourseSummaryDto>>(key);
    if (cached !== null) return cached;

    const where = buildCourseListWhere(query);
    const orderBy = buildCourseOrderBy(query);
    const skip = (page - 1) * limit;

    // TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits, add
    // @@index([pathId, status, order]) on Course.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        include: {
          category: true,
          path: true,
          tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
          sections: { include: { lessons: true } },
          _count: { select: { projects: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.course.count({ where }),
    ]);

    const data = items.map((c) =>
      toCourseSummaryDto(c as never, computeCourseStats(c as never)),
    );
    const result: PaginatedResponse<CourseSummaryDto> = {
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

  async findDetailBySlug(slug: string): Promise<CourseDetailDto> {
    const key = CacheKeys.courses.detail(slug);
    const cached = await this.cache.get<CourseDetailDto>(key);
    if (cached !== null) return cached;

    // TODO(KAN-26-followup-indexes): If perf monitoring shows hot DB hits, add
    // @@index([pathId, status, order]) on Course.
    const course = await this.prisma.course.findUnique({
      where: { slug },
      include: {
        category: true,
        path: true,
        tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
        sections: {
          orderBy: { order: 'asc' },
          include: { lessons: { orderBy: { order: 'asc' } } },
        },
        _count: { select: { projects: true } },
      },
    });

    if (!course || course.status !== CourseStatus.PUBLISHED) {
      throw new NotFoundException(`Course with slug "${slug}" not found`);
    }

    const [features, faqs, testimonials] = await Promise.all([
      this.marketing.getFeaturesByOwner(MarketingOwnerType.COURSE, course.id),
      this.marketing.getFaqsByOwner(MarketingOwnerType.COURSE, course.id),
      this.marketing.getApprovedTestimonialsByOwner(
        MarketingOwnerType.COURSE,
        course.id,
      ),
    ]);

    if (course.isFree) applyIsFreeOverride(course as never);

    const stats = computeCourseStats(course as never);
    const dto = toCourseDetailDto(
      course as never,
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
