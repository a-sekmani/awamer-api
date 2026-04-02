import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailVerifiedGuard } from './email-verified.guard';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
  },
};

const mockReflector = {
  getAllAndOverride: jest.fn(),
};

function createMockContext(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: { userId },
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('EmailVerifiedGuard', () => {
  let guard: EmailVerifiedGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerifiedGuard,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<EmailVerifiedGuard>(EmailVerifiedGuard);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should allow access for verified users', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockPrismaService.user.findUnique.mockResolvedValue({
      emailVerified: true,
    });

    const context = createMockContext('user-uuid');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny access for unverified users with ForbiddenException', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockPrismaService.user.findUnique.mockResolvedValue({
      emailVerified: false,
    });

    const context = createMockContext('user-uuid');

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    mockPrismaService.user.findUnique.mockResolvedValue({
      emailVerified: false,
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Email verification required',
    );
  });

  it('should skip verification when @SkipEmailVerification() is applied', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);

    const context = createMockContext('user-uuid');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
  });

  it('should deny access when user is not found', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    const context = createMockContext('nonexistent-uuid');

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should query emailVerified from DB using userId (not JWT claims)', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockPrismaService.user.findUnique.mockResolvedValue({
      emailVerified: true,
    });

    const context = createMockContext('user-uuid');
    await guard.canActivate(context);

    // Verify the guard queries the DB with the correct userId and selects emailVerified
    expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-uuid' },
      select: { emailVerified: true },
    });
  });
});
