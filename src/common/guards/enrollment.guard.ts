import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { EnrollmentService } from '../../enrollment/enrollment.service';

/**
 * Rejects protected learning operations for any learner whose enrollment
 * chain does not grant ACTIVE access to the lesson's owning course. Runs
 * BEFORE ContentAccessGuard so that paywall state is never leaked to a
 * non-enrolled caller. Expects the handler's route to carry a `:lessonId`
 * path parameter.
 */
@Injectable()
export class EnrollmentGuard implements CanActivate {
  constructor(
    private readonly enrollment: EnrollmentService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      // JwtAuthGuard should have rejected unauthenticated callers before us.
      throw new ForbiddenException('Not enrolled');
    }

    const lessonId = req.params?.lessonId as string | undefined;
    if (!lessonId || typeof lessonId !== 'string') {
      // No lessonId → nothing to enforce. Fail closed.
      throw new ForbiddenException('Not enrolled');
    }

    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { section: { select: { courseId: true } } },
    });
    if (!lesson) {
      throw new NotFoundException(`Lesson '${lessonId}' not found`);
    }

    const allowed = await this.enrollment.hasAccessToCourse(
      user.userId,
      lesson.section.courseId,
    );
    if (!allowed) {
      throw new ForbiddenException('Not enrolled');
    }
    return true;
  }
}
