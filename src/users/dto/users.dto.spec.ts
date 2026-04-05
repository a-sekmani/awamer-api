import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateUserDto } from './update-user.dto';
import { ChangePasswordDto } from './change-password.dto';
import { SubmitOnboardingDto } from './onboarding.dto';

describe('UpdateUserDto', () => {
  it('should accept locale ar', async () => {
    const dto = plainToInstance(UpdateUserDto, { locale: 'ar' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept locale en', async () => {
    const dto = plainToInstance(UpdateUserDto, { locale: 'en' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject locale fr', async () => {
    const dto = plainToInstance(UpdateUserDto, { locale: 'fr' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('locale');
  });

  it('should reject locale arabic', async () => {
    const dto = plainToInstance(UpdateUserDto, { locale: 'arabic' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('locale');
  });

  it('should accept empty object (all fields optional)', async () => {
    const dto = plainToInstance(UpdateUserDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('ChangePasswordDto', () => {
  it('should reject missing currentPassword', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      newPassword: 'Test1234',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const field = errors.find((e) => e.property === 'currentPassword');
    expect(field).toBeDefined();
  });

  it('should reject missing newPassword', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: 'OldPass',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const field = errors.find((e) => e.property === 'newPassword');
    expect(field).toBeDefined();
  });

  it('should accept both fields present', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: 'OldPass1!',
      newPassword: 'NewPass123!',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('SubmitOnboardingDto', () => {
  it('should reject empty responses array', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, { responses: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject missing questionKey in item', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [{ answer: 'a', stepNumber: 1 }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject non-number stepNumber', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [{ questionKey: 'q', answer: 'a', stepNumber: 'abc' }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept valid responses array', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [{ questionKey: 'q', answer: 'a', stepNumber: 1 }],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
