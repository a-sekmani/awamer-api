import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard';

const mockReflector = {
  getAllAndOverride: jest.fn(),
};

function createMockContext(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        user: { userId: 'user-uuid', email: 'test@example.com' },
      }),
      getResponse: () => ({}),
    }),
    getType: () => 'http',
    getArgs: () => [],
    getArgByIndex: () => ({}),
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should allow access when @Public() decorator is applied', () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);

    const context = createMockContext();
    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should delegate to Passport when route is not public', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);

    const context = createMockContext();

    // super.canActivate will reject because there's no real Passport strategy in unit test
    await expect(guard.canActivate(context)).rejects.toThrow();
  });

  it('should check isPublic metadata from both handler and class', () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);

    const context = createMockContext();
    guard.canActivate(context);

    expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
  });

  it('should not bypass auth when isPublic is undefined', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    const context = createMockContext();

    // undefined is falsy, so it delegates to Passport which will reject in unit test
    await expect(guard.canActivate(context)).rejects.toThrow();
  });

  it('should not bypass auth when isPublic is false', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);

    const context = createMockContext();

    await expect(guard.canActivate(context)).rejects.toThrow();
  });
});
