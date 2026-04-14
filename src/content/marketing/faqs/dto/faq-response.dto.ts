import { Faq, MarketingOwnerType } from '@prisma/client';

export class FaqResponseDto {
  id!: string;
  ownerType!: MarketingOwnerType;
  ownerId!: string;
  question!: string;
  answer!: string;
  order!: number;

  static fromEntity(f: Faq): FaqResponseDto {
    return {
      id: f.id,
      ownerType: f.ownerType,
      ownerId: f.ownerId,
      question: f.question,
      answer: f.answer,
      order: f.order,
    };
  }
}
