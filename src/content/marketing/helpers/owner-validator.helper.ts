import { Injectable, NotFoundException } from '@nestjs/common';
import { MarketingOwnerType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class OwnerValidator {
  constructor(private readonly prisma: PrismaService) {}

  async ensurePathExists(pathId: string): Promise<void> {
    const found = await this.prisma.path.findUnique({
      where: { id: pathId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(`Path '${pathId}' does not exist`);
    }
  }

  async ensureCourseExists(courseId: string): Promise<void> {
    const found = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(`Course '${courseId}' does not exist`);
    }
  }

  async ensureOwnerExists(
    ownerType: MarketingOwnerType,
    ownerId: string,
  ): Promise<void> {
    if (ownerType === MarketingOwnerType.PATH) {
      await this.ensurePathExists(ownerId);
      return;
    }
    if (ownerType === MarketingOwnerType.COURSE) {
      await this.ensureCourseExists(ownerId);
      return;
    }
    throw new NotFoundException(
      `Unknown owner type '${ownerType as string}'`,
    );
  }
}
