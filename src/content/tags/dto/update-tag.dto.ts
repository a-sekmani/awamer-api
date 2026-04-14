import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { TagStatus } from '@prisma/client';

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 100)
  @Matches(/\S/, { message: 'name must not be blank' })
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'slug must contain only lowercase letters, digits, and single hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsEnum(TagStatus)
  status?: TagStatus;
}
