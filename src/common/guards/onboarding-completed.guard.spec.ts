import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OnboardingCompletedGuard } from './onboarding-completed.guard';

function createMockContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('OnboardingCompletedGuard', () => {
  let guard: OnboardingCompletedGuard;

  beforeEach(() => {
    guard = new OnboardingCompletedGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access when onboardingCompleted is true', () => {
    const context = createMockContext({
      userId: 'user-uuid',
      onboardingCompleted: true,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when onboardingCompleted is false', () => {
    const context = createMockContext({
      userId: 'user-uuid',
      onboardingCompleted: false,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when onboardingCompleted is undefined', () => {
    const context = createMockContext({
      userId: 'user-uuid',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when user is null', () => {
    const context = createMockContext(null);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should include ONBOARDING_REQUIRED error code', () => {
    const context = createMockContext({
      userId: 'user-uuid',
      onboardingCompleted: false,
    });

    try {
      guard.canActivate(context);
      fail('Expected ForbiddenException');
    } catch (error) {
      const response = (error as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response.errorCode).toBe('ONBOARDING_REQUIRED');
    }
  });
});
