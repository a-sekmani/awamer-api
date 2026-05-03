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
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { FeatureResponseDto } from './dto/feature-response.dto';

@Injectable()
export class FeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownerValidator: OwnerValidator,
    private readonly reorderHelper: ReorderHelper,
    private readonly cache: CacheService,
    private readonly revalidation: RevalidationHelper,
  ) {}

  // Feature has no createdAt column (schema frozen by KAN-70); tie-breaker
  // falls back to id ASC. See specs/010-marketing-content/data-model.md.
  private readonly orderBy: Prisma.FeatureOrderByWithRelationInput[] = [
    { order: 'asc' },
    { id: 'asc' },
  ];

  async listByOwner(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<FeatureResponseDto[]> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    const rows = await this.prisma.feature.findMany({
      where: { ownerType, ownerId },
      orderBy: this.orderBy,
    });
    return rows.map(FeatureResponseDto.fromEntity);
  }

  async create(
    ownerType: MarketingOwnerType,
    ownerId: string,
    dto: CreateFeatureDto,
  ): Promise<FeatureResponseDto> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    const order = dto.order ?? (await this.nextOrder(ownerType, ownerId));
    const created = await this.prisma.feature.create({
      data: {
        ownerType,
        ownerId,
        icon: dto.icon,
        title: dto.title,
        description: dto.description,
        order,
      },
    });
    const scope: 'path' | 'course' = ownerType === 'PATH' ? 'path' : 'course';
    await this.cache.invalidateOwner(scope, ownerId);
    const slug = await this.cache.slugFor(scope, ownerId);
    if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
    return FeatureResponseDto.fromEntity(created);
  }

  async update(id: string, dto: UpdateFeatureDto): Promise<FeatureResponseDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field must be provided');
    }
    try {
      const updated = await this.prisma.feature.update({
        where: { id },
        data: {
          ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
        },
      });
      const scope: 'path' | 'course' =
        updated.ownerType === 'PATH' ? 'path' : 'course';
      await this.cache.invalidateOwner(scope, updated.ownerId);
      const slug = await this.cache.slugFor(scope, updated.ownerId);
      if (slug) await this.revalidation.revalidatePath(`/${scope}s/${slug}`);
      return FeatureResponseDto.fromEntity(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Feature '${id}' not found`);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const deleted = await this.prisma.feature.delete({ where: { id } });
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
        throw new NotFoundException(`Feature '${id}' not found`);
      }
      throw err;
    }
  }

  async reorder(
    ownerType: MarketingOwnerType,
    ownerId: string,
    itemIds: string[],
  ): Promise<FeatureResponseDto[]> {
    await this.ownerValidator.ensureOwnerExists(ownerType, ownerId);
    await this.reorderHelper.reorder('feature', ownerType, ownerId, itemIds);
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
    const top = await this.prisma.feature.findFirst({
      where: { ownerType, ownerId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return top ? top.order + 1 : 0;
  }
}
