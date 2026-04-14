import {
  MarketingOwnerType,
  Testimonial,
  TestimonialStatus,
} from '@prisma/client';

export class TestimonialResponseDto {
  id!: string;
  ownerType!: MarketingOwnerType;
  ownerId!: string;
  authorName!: string;
  authorTitle!: string | null;
  avatarUrl!: string | null;
  content!: string;
  rating!: number | null;
  status!: TestimonialStatus;
  order!: number;
  createdAt!: string;

  static fromEntity(t: Testimonial): TestimonialResponseDto {
    return {
      id: t.id,
      ownerType: t.ownerType,
      ownerId: t.ownerId,
      authorName: t.authorName,
      authorTitle: t.authorTitle,
      avatarUrl: t.avatarUrl,
      content: t.content,
      rating: t.rating,
      status: t.status,
      order: t.order,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
