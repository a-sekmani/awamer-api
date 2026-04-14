import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Enforces the constitutional isFree cascade for protected learning
 * operations, in the exact order mandated by Principle VI:
 *
 *   Path.isFree → Course.isFree → Lesson.isFree → active subscription → deny
 *
 * For standalone courses (no parent path), the Path.isFree step is skipped
 * per FR-026 — there is no parent path to inspect.
 *
 * Runs AFTER EnrollmentGuard in the guard chain so that non-enrolled users
 * are rejected before any paywall evaluation can leak free/paid state.
 */
@Injectable()
export class ContentAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as { userId?: string } | undefined;
    const lessonId = req.params?.lessonId as string | undefined;
    if (!lessonId || typeof lessonId !== 'string') {
      // Guard is only meaningful on routes that carry a lessonId parameter.
      return true;
    }

    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        section: {
          include: {
            course: {
              include: {
                path: { select: { isFree: true } },
              },
            },
          },
        },
      },
    });
    if (!lesson) {
      throw new NotFoundException(`Lesson '${lessonId}' not found`);
    }

    const course = lesson.section.course;
    // Constitutional order: Path → Course → Lesson → subscription → deny.
    if (course.pathId && course.path?.isFree) return true;
    if (course.isFree) return true;
    if (lesson.isFree) return true;

    if (await this.hasActiveSubscription(user?.userId)) return true;

    throw new ForbiddenException({
      reason: 'subscription_required',
      upgradeUrl: '/plus',
    });
  }

  private async hasActiveSubscription(_userId: string | undefined): Promise<boolean> {
    // TODO(subscriptions): replace with a real SubscriptionsService.isActive()
    // call once that service exists. Defaulting to true (allow) is the
    // documented ticket §13.3 fallback — EnrollmentGuard still rejects
    // non-enrolled users, so the paywall is effectively off in development
    // but enrollment discipline remains.
    return true;
  }
}
