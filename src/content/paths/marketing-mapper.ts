import type { Faq, Feature, Testimonial } from '@prisma/client';
import { FaqDto, FeatureDto, TestimonialDto } from './dto/path-detail.dto';

export function toFeatureDto(row: Feature): FeatureDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    icon: row.icon,
    order: row.order,
  };
}

export function toFaqDto(row: Faq): FaqDto {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    order: row.order,
  };
}

export function toTestimonialDto(row: Testimonial): TestimonialDto {
  return {
    id: row.id,
    authorName: row.authorName,
    authorTitle: row.authorTitle,
    authorAvatar: row.avatarUrl,
    body: row.content,
    rating: row.rating,
    order: row.order,
  };
}
