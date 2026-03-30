import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OnboardingResponseItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  questionKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  answer!: string;

  @IsInt()
  @Min(1)
  stepNumber!: number;
}

export class SubmitOnboardingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnboardingResponseItemDto)
  responses!: OnboardingResponseItemDto[];

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
}
