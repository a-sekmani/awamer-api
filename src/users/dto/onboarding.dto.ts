import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const VALID_BACKGROUNDS = [
  'student',
  'freelancer',
  'employee',
  'job_seeker',
] as const;

export const VALID_INTERESTS = [
  'programming',
  'data_science',
  'ai',
  'mobile_dev',
  'cybersecurity',
  'cloud_devops',
  'game_dev',
  'vr_ar',
  'blockchain',
  'iot',
  'design_ux',
  'digital_marketing',
  'project_management',
] as const;

export const VALID_GOALS = [
  'learn_new_skill',
  'level_up',
  'advance_career',
  'switch_career',
  'build_project',
] as const;

export const VALID_QUESTION_KEYS = [
  'background',
  'interests',
  'goals',
] as const;

export const MAX_INTERESTS = 4;
export const MIN_INTERESTS = 1;

export class OnboardingResponseItemDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...VALID_QUESTION_KEYS])
  questionKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  answer!: string;

  @IsInt()
  @Min(1)
  @Max(3)
  stepNumber!: number;
}

export class SubmitOnboardingDto {
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => OnboardingResponseItemDto)
  responses!: OnboardingResponseItemDto[];
}
