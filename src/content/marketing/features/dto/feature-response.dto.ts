import { Feature, MarketingOwnerType } from '@prisma/client';

export class FeatureResponseDto {
  id!: string;
  ownerType!: MarketingOwnerType;
  ownerId!: string;
  icon!: string;
  title!: string;
  description!: string;
  order!: number;

  static fromEntity(f: Feature): FeatureResponseDto {
    return {
      id: f.id,
      ownerType: f.ownerType,
      ownerId: f.ownerId,
      icon: f.icon,
      title: f.title,
      description: f.description,
      order: f.order,
    };
  }
}
