import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateTestimonialDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 100)
  @Matches(/\S/, { message: 'authorName must not be blank' })
  authorName?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 100)
  @Matches(/\S/, { message: 'authorTitle must not be blank' })
  authorTitle?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 1000)
  @Matches(/\S/, { message: 'content must not be blank' })
  content?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
