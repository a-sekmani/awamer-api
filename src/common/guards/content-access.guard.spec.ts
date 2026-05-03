import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentAccessGuard } from './content-access.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ContentAccessGuard', () => {
  let guard: ContentAccessGuard;
  let prisma: { lesson: { findUnique: jest.Mock } };

  const lesson = (opts: {
    lessonIsFree: boolean;
    courseIsFree: boolean;
    pathId: string | null;
    pathIsFree: boolean | null;
  }) => ({
    isFree: opts.lessonIsFree,
    section: {
      course: {
        isFree: opts.courseIsFree,
        pathId: opts.pathId,
        path: opts.pathId !== null ? { isFree: opts.pathIsFree } : null,
      },
    },
  });

  beforeEach(async () => {
    prisma = { lesson: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContentAccessGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    guard = moduleRef.get(ContentAccessGuard);
  });

  it('allows when lesson.isFree = true regardless of anything else', async () => {
    prisma.lesson.findUnique.mockResolvedValue(
      lesson({
        lessonIsFree: true,
        courseIsFree: false,
        pathId: 'p1',
        pathIsFree: false,
      }),
    );
    const result = await guard.canActivate(
      ctx({ user: { userId: 'u1' }, params: { lessonId: 'l1' } }),
    );
    expect(result).toBe(true);
  });

  it('allows when course.isFree = true', async () => {
    prisma.lesson.findUnique.mockResolvedValue(
      lesson({
        lessonIsFree: false,
        courseIsFree: true,
        pathId: null,
        pathIsFree: null,
      }),
    );
    const result = await guard.canActivate(
      ctx({ user: { userId: 'u1' }, params: { lessonId: 'l1' } }),
    );
    expect(result).toBe(true);
  });

  it('allows when path-attached course has a free parent path', async () => {
    prisma.lesson.findUnique.mockResolvedValue(
      lesson({
        lessonIsFree: false,
        courseIsFree: false,
        pathId: 'p1',
        pathIsFree: true,
      }),
    );
    const result = await guard.canActivate(
      ctx({ user: { userId: 'u1' }, params: { lessonId: 'l1' } }),
    );
    expect(result).toBe(true);
  });

  it('skips the "parent path is free" check for standalone courses (FR-026)', async () => {
    prisma.lesson.findUnique.mockResolvedValue(
      lesson({
        lessonIsFree: false,
        courseIsFree: false,
        pathId: null,
        pathIsFree: null,
      }),
    );
    // With the subscription stub returning true, this call resolves to true.
    // The meaningful assertion is that the path branch is not accessed.
    const result = await guard.canActivate(
      ctx({ user: { userId: 'u1' }, params: { lessonId: 'l1' } }),
    );
    expect(result).toBe(true);
  });

  it('allows paid content via the stubbed subscription check (documents TODO(subscriptions))', async () => {
    // Default behaviour per Decision 7: until SubscriptionsService exists,
    // the subscription branch returns true so EnrollmentGuard remains the
    // effective paywall. This test pins the current behaviour so a future
    // diff that flips it to default-deny is caught explicitly.
    prisma.lesson.findUnique.mockResolvedValue(
      lesson({
        lessonIsFree: false,
        courseIsFree: false,
        pathId: 'p1',
        pathIsFree: false,
      }),
    );
    const result = await guard.canActivate(
      ctx({ user: { userId: 'u1' }, params: { lessonId: 'l1' } }),
    );
    expect(result).toBe(true);
  });

  it('rejects paid content with ForbiddenException when hasActiveSubscription returns false', async () => {
    // Override the private stub to simulate the future default-deny branch.
    (
      guard as unknown as { hasActiveSubscription: () => Promise<boolean> }
    ).hasActiveSubscription = jest.fn().mockResolvedValue(false);
    prisma.lesson.findUnique.mockResolvedValue(
      lesson({
        lessonIsFree: false,
        courseIsFree: false,
        pathId: 'p1',
        pathIsFree: false,
      }),
    );
    await expect(
      guard.canActivate(
        ctx({ user: { userId: 'u1' }, params: { lessonId: 'l1' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
