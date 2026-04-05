import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';
import { ForgotPasswordDto } from './forgot-password.dto';
import { ResetPasswordDto } from './reset-password.dto';

describe('RegisterDto', () => {
  it('should normalize email to lowercase and trim', () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Test',
      email: '  Test@Example.COM  ',
      password: 'Test1234!',
    });
    expect(dto.email).toBe('test@example.com');
  });

  it('should accept valid password with special character', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Test',
      email: 'test@example.com',
      password: 'Test1234!',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject password without special character', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Test',
      email: 'test@example.com',
      password: 'Test1234',
    });
    const errors = await validate(dto);
    const pwError = errors.find((e) => e.property === 'password');
    expect(pwError).toBeDefined();
  });

  it('should reject password longer than 128 characters', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Test',
      email: 'test@example.com',
      password: 'A'.repeat(129) + '1a!',
    });
    const errors = await validate(dto);
    const pwError = errors.find((e) => e.property === 'password');
    expect(pwError).toBeDefined();
  });

  it('should reject name longer than 100 characters', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'A'.repeat(101),
      email: 'test@example.com',
      password: 'Test1234!',
    });
    const errors = await validate(dto);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
  });

  it('should reject invalid email', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Test',
      email: 'not-an-email',
      password: 'Test1234!',
    });
    const errors = await validate(dto);
    const emailError = errors.find((e) => e.property === 'email');
    expect(emailError).toBeDefined();
  });
});

describe('LoginDto', () => {
  it('should normalize email to lowercase and trim', () => {
    const dto = plainToInstance(LoginDto, {
      email: '  User@Example.COM  ',
      password: 'pass',
    });
    expect(dto.email).toBe('user@example.com');
  });

  it('should accept valid login', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'test@example.com',
      password: 'Test1234!',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject password longer than 128 characters', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'test@example.com',
      password: 'A'.repeat(129),
    });
    const errors = await validate(dto);
    const pwError = errors.find((e) => e.property === 'password');
    expect(pwError).toBeDefined();
  });

  it('should reject empty password', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'test@example.com',
      password: '',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('ForgotPasswordDto', () => {
  it('should normalize email to lowercase and trim', () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: '  Forgot@Example.COM  ',
    });
    expect(dto.email).toBe('forgot@example.com');
  });

  it('should reject invalid email', async () => {
    const dto = plainToInstance(ForgotPasswordDto, { email: 'bad' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept valid email', async () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: 'test@example.com',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});

describe('ResetPasswordDto', () => {
  it('should reject password without special character', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'valid-token',
      password: 'Test1234',
    });
    const errors = await validate(dto);
    const pwError = errors.find((e) => e.property === 'password');
    expect(pwError).toBeDefined();
  });

  it('should accept valid password with special character', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'valid-token',
      password: 'Test1234!',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject empty token', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: '',
      password: 'Test1234!',
    });
    const errors = await validate(dto);
    const tokenError = errors.find((e) => e.property === 'token');
    expect(tokenError).toBeDefined();
  });

  it('should reject password shorter than 8 characters', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'valid',
      password: 'Ab1!',
    });
    const errors = await validate(dto);
    const pwError = errors.find((e) => e.property === 'password');
    expect(pwError).toBeDefined();
  });
});
