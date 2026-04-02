import { IsString, Length, Matches } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits' })
  code!: string;
}
