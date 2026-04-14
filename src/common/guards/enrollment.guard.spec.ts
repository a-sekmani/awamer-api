import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EnrollmentService } from '../../enrollment/enrollment.service';
import { EnrollmentGuard } from './enrollment.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('EnrollmentGuard', () => {
  let guard: EnrollmentGuard;
  let enrollment: { hasAccessToCourse: jest.Mock };
  let prisma: { lesson: { findUnique: jest.Mock } };

  beforeEach(async () => {
    enrollment = { hasAccessToCourse: jest.fn() };
    prisma = { lesson: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrollmentGuard,
        { provide: EnrollmentService, useValue: enrollment },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    guard = moduleRef.get(EnrollmentGuard);
  });

  it('allows access when hasAccessToCourse returns true', async () => {
    prisma.lesson.findUnique.mockResolvedValue({
      section: { courseId: 'c1' },
    });
    enrollment.hasAccessToCourse.mockResolvedValue(true);
    const result = await guard.canActivate(
      ctx({ user: { userId: 'u1' }, params: { lessonId: 'l1' } }),
    );
    expect(result).toBe(true);
    expect(enrollment.hasAccessToCourse).toHaveBeenCalledWith('u1', 'c1');
  });

  it('throws ForbiddenException when hasAccessToCourse returns false', async () => {
    prisma.lesson.findUnique.mockResolvedValue({
      section: { courseId: 'c1' },
    });
    enrollment.hasAccessToCourse.mockResolvedValue(false);
    await expect(
      guard.canActivate(
        ctx({ user: { userId: 'u1' }, params: { lessonId: 'l1' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFoundException when the lesson does not exist', async () => {
    prisma.lesson.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(
        ctx({ user: { userId: 'u1' }, params: { lessonId: 'missing' } }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails closed when req.user.userId is missing', async () => {
    await expect(
      guard.canActivate(ctx({ params: { lessonId: 'l1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed when req.params.lessonId is missing', async () => {
    await expect(
      guard.canActivate(ctx({ user: { userId: 'u1' }, params: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
