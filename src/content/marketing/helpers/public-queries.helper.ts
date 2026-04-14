import { Injectable } from '@nestjs/common';
import {
  Faq,
  Feature,
  MarketingOwnerType,
  Testimonial,
  TestimonialStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Read-only query helpers for use by KAN-26 (public discovery endpoints) and
 * any other future consumer that needs marketing content for a given owner.
 *
 * These helpers do NOT validate that the owner exists — the caller is expected
 * to have already fetched the path/course. They simply query the marketing
 * tables and return whatever matches.
 *
 * Feature and Faq have no `createdAt` column (schema frozen by KAN-70), so the
 * ordering tie-breaker falls back to `id` ASC. Testimonial has `createdAt` and
 * uses it as the tie-breaker, matching the literal spec in KAN-72 §3.
 */
@Injectable()
export class PublicMarketingQueries {
  constructor(private readonly prisma: PrismaService) {}

  async getFeaturesByOwner(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<Feature[]> {
    return this.prisma.feature.findMany({
      where: { ownerType, ownerId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
  }

  async getFaqsByOwner(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<Faq[]> {
    return this.prisma.faq.findMany({
      where: { ownerType, ownerId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
  }

  async getApprovedTestimonialsByOwner(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<Testimonial[]> {
    return this.prisma.testimonial.findMany({
      where: { ownerType, ownerId, status: TestimonialStatus.APPROVED },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
