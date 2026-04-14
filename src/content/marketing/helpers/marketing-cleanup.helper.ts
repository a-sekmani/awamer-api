import { Injectable } from '@nestjs/common';
import { MarketingOwnerType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Polymorphic cleanup for marketing content tied to a Path or Course.
 *
 * Because Feature/Faq/Testimonial use polymorphic ownership (no `@relation`),
 * `onDelete: Cascade` is not available and Path/Course deletes must explicitly
 * call this helper. All three deleteMany calls run in a single transaction so
 * a failure leaves no half-cleaned owner.
 *
 * Idempotent: deleteMany returns { count: 0 } when no rows match.
 */
@Injectable()
export class MarketingCleanupHelper {
  constructor(private readonly prisma: PrismaService) {}

  async deleteAllForPath(pathId: string): Promise<void> {
    await this.deleteAllForOwner(MarketingOwnerType.PATH, pathId);
  }

  async deleteAllForCourse(courseId: string): Promise<void> {
    await this.deleteAllForOwner(MarketingOwnerType.COURSE, courseId);
  }

  private async deleteAllForOwner(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.feature.deleteMany({ where: { ownerType, ownerId } }),
      this.prisma.faq.deleteMany({ where: { ownerType, ownerId } }),
      this.prisma.testimonial.deleteMany({ where: { ownerType, ownerId } }),
    ]);
  }
}
