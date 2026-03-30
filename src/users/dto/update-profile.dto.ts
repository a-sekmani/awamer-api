import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  displayName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  avatarUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  background?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  goals?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  interests?: string;

  @IsString()
  @IsOptional()
  @IsIn(['ar', 'en'], {
    message: 'Preferred language must be either "ar" or "en"',
  })
  preferredLanguage?: string;
}
