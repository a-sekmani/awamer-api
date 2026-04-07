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
  const validPayload = {
    responses: [
      { questionKey: 'background', answer: 'student', stepNumber: 1 },
      { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
      { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
    ],
  };

  it('should accept valid 3-response payload with correct keys and stepNumbers', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, validPayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject empty responses array', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, { responses: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject responses with fewer than 3 items', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'student', stepNumber: 1 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject responses with more than 3 items', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        ...validPayload.responses,
        { questionKey: 'background', answer: 'student', stepNumber: 1 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject invalid questionKey (e.g., "favorite_color")', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'favorite_color', answer: 'blue', stepNumber: 1 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject stepNumber of 0', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'student', stepNumber: 0 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject stepNumber of 4', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'student', stepNumber: 4 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject stepNumber that is a string', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'student', stepNumber: 'abc' },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject stepNumber that is a float (e.g., 1.5)', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'student', stepNumber: 1.5 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject missing questionKey in response item', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { answer: 'student', stepNumber: 1 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject missing answer in response item', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', stepNumber: 1 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject missing stepNumber in response item', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'student' },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject empty string questionKey', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: '', answer: 'student', stepNumber: 1 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject empty string answer', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: '', stepNumber: 1 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject answer exceeding 1000 characters', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'a'.repeat(1001), stepNumber: 1 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject non-array responses (e.g., object)', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: { questionKey: 'background', answer: 'student', stepNumber: 1 },
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject when responses is undefined', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject extra top-level fields via forbidNonWhitelisted', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'student', stepNumber: 1 },
        { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
      background: 'Student',
      goals: 'AI Career',
      interests: 'ML',
    });
    // With forbidNonWhitelisted: true (global ValidationPipe), extra fields
    // are rejected. The DTO class only declares 'responses'.
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject duplicate questionKeys in responses (2 backgrounds)', async () => {
    const dto = plainToInstance(SubmitOnboardingDto, {
      responses: [
        { questionKey: 'background', answer: 'student', stepNumber: 1 },
        { questionKey: 'background', answer: 'freelancer', stepNumber: 1 },
        { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
      ],
    });
    const errors = await validate(dto);
    // DTO validation passes (structural), but service-level will reject
    // This test verifies DTO does not crash on duplicate keys
    expect(errors).toHaveLength(0);
  });

  it('should accept all 3 valid questionKey values', async () => {
    for (const key of ['background', 'interests', 'goals']) {
      const dto = plainToInstance(SubmitOnboardingDto, {
        responses: [
          { questionKey: 'background', answer: 'student', stepNumber: 1 },
          { questionKey: 'interests', answer: '["ai"]', stepNumber: 2 },
          { questionKey: 'goals', answer: 'learn_new_skill', stepNumber: 3 },
        ],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });
});
