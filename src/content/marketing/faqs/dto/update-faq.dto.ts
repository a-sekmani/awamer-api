import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateFaqDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 300)
  @Matches(/\S/, { message: 'question must not be blank' })
  question?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 2000)
  @Matches(/\S/, { message: 'answer must not be blank' })
  answer?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
