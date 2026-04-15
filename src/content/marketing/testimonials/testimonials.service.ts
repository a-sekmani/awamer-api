import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MarketingOwnerType,
  Prisma,
  TestimonialStatus,
} from '@prisma/client';
import { CacheService } from '../../../common/cache/cache.service';
import { RevalidationHelper } from '../../../common/cache/revalidation.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnerValidator } from '../helpers/owner-validator.helper';
import { ReorderHelper } from '../helpers/reorder.helper';
import { CreateTestimonialDto } from './dto/create-testimonial.dto';
import { UpdateTestimonialDto } from './dto/update-testimonial.dto';
import { UpdateTestimonialStatusDto } from './dto/update-testimonial-status.dto';
import { TestimonialResponseDto } from './dto/testimonial-response.dto';

@Injectable()
export class TestimonialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownerValidator: OwnerValidator,
    private readonly reorderHelper: ReorderHelper,
    private readonly cache: CacheService,
    private readonly revalidation: RevalidationHelper,
  ) {}

  private readonly orderBy: Prisma.TestimonialOrderByWithRelationInput[] = [
    { order: 'asc' },
    { createdAt: 'asc' },
  ];

  async listByOwner(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<TestimonialResponseDto[]> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    const rows = await this.prisma.testimonial.findMany({
      where: { ownerType, ownerId },
      orderBy: this.orderBy,
    });
    return rows.map(TestimonialResponseDto.fromEntity);
  }

  async create(
    ownerType: MarketingOwnerType,
    ownerId: string,
    dto: CreateTestimonialDto,
  ): Promise<TestimonialResponseDto> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    const order = dto.order ?? (await this.nextOrder(ownerType, ownerId));
    const created = await this.prisma.testimonial.create({
      data: {
        ownerType,
        ownerId,
        authorName: dto.authorName,
        authorTitle: dto.authorTitle ?? null,
        avatarUrl: dto.avatarUrl ?? null,
        content: dto.content,
        rating: dto.rating ?? null,
        order,
        // Always PENDING on creation, regardless of any caller input.
        status: TestimonialStatus.PENDING,
      },
    });
    const scope: 'path' | 'course' =
      ownerType === 'PATH' ? 'path' : 'course';
    await this.cache.invalidateOwner(scope, ownerId);
    const slug = await this.cache.slugFor(scope, ownerId);
    if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
    return TestimonialResponseDto.fromEntity(created);
  }

  async update(
    id: string,
    dto: UpdateTestimonialDto,
  ): Promise<TestimonialResponseDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field must be provided');
    }
    try {
      const updated = await this.prisma.testimonial.update({
        where: { id },
        data: {
          ...(dto.authorName !== undefined
            ? { authorName: dto.authorName }
            : {}),
          ...(dto.authorTitle !== undefined
            ? { authorTitle: dto.authorTitle }
            : {}),
          ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
          ...(dto.content !== undefined ? { content: dto.content } : {}),
          ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
        },
      });
      const scope: 'path' | 'course' =
        updated.ownerType === 'PATH' ? 'path' : 'course';
      await this.cache.invalidateOwner(scope, updated.ownerId);
      const slug = await this.cache.slugFor(scope, updated.ownerId);
      if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
      return TestimonialResponseDto.fromEntity(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Testimonial '${id}' not found`);
      }
      throw err;
    }
  }

  async updateStatus(
    id: string,
    dto: UpdateTestimonialStatusDto,
  ): Promise<TestimonialResponseDto> {
    try {
      const updated = await this.prisma.testimonial.update({
        where: { id },
        data: { status: dto.status },
      });
      const scope: 'path' | 'course' =
        updated.ownerType === 'PATH' ? 'path' : 'course';
      await this.cache.invalidateOwner(scope, updated.ownerId);
      const slug = await this.cache.slugFor(scope, updated.ownerId);
      if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
      return TestimonialResponseDto.fromEntity(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Testimonial '${id}' not found`);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const deleted = await this.prisma.testimonial.delete({ where: { id } });
      const scope: 'path' | 'course' =
        deleted.ownerType === 'PATH' ? 'path' : 'course';
      await this.cache.invalidateOwner(scope, deleted.ownerId);
      const slug = await this.cache.slugFor(scope, deleted.ownerId);
      if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Testimonial '${id}' not found`);
      }
      throw err;
    }
  }

  async reorder(
    ownerType: MarketingOwnerType,
    ownerId: string,
    itemIds: string[],
  ): Promise<TestimonialResponseDto[]> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    await this.reorderHelper.reorder(
      'testimonial',
      ownerType,
      ownerId,
      itemIds,
    );
    const scope: 'path' | 'course' =
      ownerType === 'PATH' ? 'path' : 'course';
    await this.cache.invalidateOwner(scope, ownerId);
    const slug = await this.cache.slugFor(scope, ownerId);
    if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
    return this.listByOwner(ownerType, ownerId);
  }

  private async nextOrder(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<number> {
    const top = await this.prisma.testimonial.findFirst({
      where: { ownerType, ownerId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return top ? top.order + 1 : 0;
  }
}
