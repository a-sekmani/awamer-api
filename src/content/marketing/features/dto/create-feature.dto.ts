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

export class CreateFeatureDto {
  @IsString()
  @Transform(trim)
  @Length(1, 255)
  @Matches(/\S/, { message: 'icon must not be blank' })
  icon!: string;

  @IsString()
  @Transform(trim)
  @Length(1, 150)
  @Matches(/\S/, { message: 'title must not be blank' })
  title!: string;

  @IsString()
  @Transform(trim)
  @Length(1, 500)
  @Matches(/\S/, { message: 'description must not be blank' })
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
