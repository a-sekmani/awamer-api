import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;
}
