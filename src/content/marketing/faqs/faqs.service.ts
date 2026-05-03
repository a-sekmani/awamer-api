import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MarketingOwnerType, Prisma } from '@prisma/client';
import { CacheService } from '../../../common/cache/cache.service';
import { RevalidationHelper } from '../../../common/cache/revalidation.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnerValidator } from '../helpers/owner-validator.helper';
import { ReorderHelper } from '../helpers/reorder.helper';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import { FaqResponseDto } from './dto/faq-response.dto';

@Injectable()
export class FaqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownerValidator: OwnerValidator,
    private readonly reorderHelper: ReorderHelper,
    private readonly cache: CacheService,
    private readonly revalidation: RevalidationHelper,
  ) {}

  // Faq has no createdAt column (schema frozen by KAN-70); tie-breaker falls
  // back to id ASC. See specs/010-marketing-content/data-model.md.
  private readonly orderBy: Prisma.FaqOrderByWithRelationInput[] = [
    { order: 'asc' },
    { id: 'asc' },
  ];

  async listByOwner(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<FaqResponseDto[]> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    const rows = await this.prisma.faq.findMany({
      where: { ownerType, ownerId },
      orderBy: this.orderBy,
    });
    return rows.map(FaqResponseDto.fromEntity);
  }

  async create(
    ownerType: MarketingOwnerType,
    ownerId: string,
    dto: CreateFaqDto,
  ): Promise<FaqResponseDto> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    const order = dto.order ?? (await this.nextOrder(ownerType, ownerId));
    const created = await this.prisma.faq.create({
      data: {
        ownerType,
        ownerId,
        question: dto.question,
        answer: dto.answer,
        order,
      },
    });
    const scope: 'path' | 'course' = ownerType === 'PATH' ? 'path' : 'course';
    await this.cache.invalidateOwner(scope, ownerId);
    const slug = await this.cache.slugFor(scope, ownerId);
    if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
    return FaqResponseDto.fromEntity(created);
  }

  async update(id: string, dto: UpdateFaqDto): Promise<FaqResponseDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field must be provided');
    }
    try {
      const updated = await this.prisma.faq.update({
        where: { id },
        data: {
          ...(dto.question !== undefined ? { question: dto.question } : {}),
          ...(dto.answer !== undefined ? { answer: dto.answer } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
        },
      });
      const scope: 'path' | 'course' =
        updated.ownerType === 'PATH' ? 'path' : 'course';
      await this.cache.invalidateOwner(scope, updated.ownerId);
      const slug = await this.cache.slugFor(scope, updated.ownerId);
      if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
      return FaqResponseDto.fromEntity(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Faq '${id}' not found`);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const deleted = await this.prisma.faq.delete({ where: { id } });
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
        throw new NotFoundException(`Faq '${id}' not found`);
      }
      throw err;
    }
  }

  async reorder(
    ownerType: MarketingOwnerType,
    ownerId: string,
    itemIds: string[],
  ): Promise<FaqResponseDto[]> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    await this.reorderHelper.reorder('faq', ownerType, ownerId, itemIds);
    const scope: 'path' | 'course' = ownerType === 'PATH' ? 'path' : 'course';
    await this.cache.invalidateOwner(scope, ownerId);
    const slug = await this.cache.slugFor(scope, ownerId);
    if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
    return this.listByOwner(ownerType, ownerId);
  }

  private async nextOrder(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<number> {
    const top = await this.prisma.faq.findFirst({
      where: { ownerType, ownerId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return top ? top.order + 1 : 0;
  }
}
