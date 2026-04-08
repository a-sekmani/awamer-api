import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
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

/**
 * A single onboarding response. The shape is conditional on `questionKey`:
 *
 *   - `background` / `goals` → carries `answer: string` (an enum value).
 *   - `interests`            → carries `items: string[]` (1-4 unique enum
 *     values).
 *
 * Both fields are declared on the same class so the global ValidationPipe
 * (whitelist + forbidNonWhitelisted) lets each shape through. `@ValidateIf`
 * scopes each rule to the relevant question key, so the service no longer
 * parses JSON or hand-checks bounds.
 */
export class OnboardingResponseItemDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...VALID_QUESTION_KEYS])
  questionKey!: string;

  // answer is required for background/goals, ignored for interests.
  @ValidateIf((o) => o.questionKey !== 'interests')
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  answer?: string;

  // items is required for interests, ignored for background/goals.
  @ValidateIf((o) => o.questionKey === 'interests')
  @IsArray()
  @ArrayMinSize(MIN_INTERESTS)
  @ArrayMaxSize(MAX_INTERESTS)
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn([...VALID_INTERESTS], { each: true })
  items?: string[];

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
