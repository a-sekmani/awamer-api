import { BadRequestException, Injectable } from '@nestjs/common';
import { MarketingOwnerType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Generic atomic reorder for any marketing entity that has
 * `id`, `ownerType`, `ownerId`, and `order` columns.
 *
 * A single helper instance serves features, faqs, and testimonials. The
 * validation pass (deduplication, set-equality against current owner ids) is
 * shared; the per-model Prisma calls are dispatched via a small switch because
 * Prisma's generated delegate types are not structurally compatible with one
 * another (each `findMany`/`update` signature takes a model-specific args type).
 */
export type ReorderableModel = 'feature' | 'faq' | 'testimonial';

@Injectable()
export class ReorderHelper {
  constructor(private readonly prisma: PrismaService) {}

  async reorder(
    model: ReorderableModel,
    ownerType: MarketingOwnerType,
    ownerId: string,
    itemIds: string[],
  ): Promise<void> {
    this.assertNoDuplicates(itemIds);
    const currentIds = await this.fetchCurrentIds(model, ownerType, ownerId);
    this.assertSetEquality(currentIds, itemIds);

    await this.prisma.$transaction(
      itemIds.map((id, index) => this.buildUpdate(model, id, index)),
    );
  }

  private assertNoDuplicates(itemIds: string[]): void {
    const seen = new Set<string>();
    for (const id of itemIds) {
      if (seen.has(id)) {
        throw new BadRequestException(
          `Reorder list contains duplicate id '${id}'`,
        );
      }
      seen.add(id);
    }
  }

  private assertSetEquality(currentIds: string[], itemIds: string[]): void {
    const current = new Set(currentIds);
    const requested = new Set(itemIds);
    if (current.size !== requested.size) {
      throw new BadRequestException(
        `Reorder list size mismatch: owner has ${current.size} items but request provided ${requested.size}`,
      );
    }
    for (const id of requested) {
      if (!current.has(id)) {
        throw new BadRequestException(
          `Reorder list contains id '${id}' which does not belong to this owner`,
        );
      }
    }
    for (const id of current) {
      if (!requested.has(id)) {
        throw new BadRequestException(
          `Reorder list is missing id '${id}' which belongs to this owner`,
        );
      }
    }
  }

  private async fetchCurrentIds(
    model: ReorderableModel,
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<string[]> {
    const where = { ownerType, ownerId };
    const select = { id: true };
    let rows: Array<{ id: string }>;
    switch (model) {
      case 'feature':
        rows = await this.prisma.feature.findMany({ where, select });
        break;
      case 'faq':
        rows = await this.prisma.faq.findMany({ where, select });
        break;
      case 'testimonial':
        rows = await this.prisma.testimonial.findMany({ where, select });
        break;
    }
    return rows.map((r) => r.id);
  }

  private buildUpdate(
    model: ReorderableModel,
    id: string,
    order: number,
  ): Prisma.PrismaPromise<unknown> {
    switch (model) {
      case 'feature':
        return this.prisma.feature.update({ where: { id }, data: { order } });
      case 'faq':
        return this.prisma.faq.update({ where: { id }, data: { order } });
      case 'testimonial':
        return this.prisma.testimonial.update({
          where: { id },
          data: { order },
        });
    }
  }
}
