import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TagStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ReplaceTagAssociationsHelper {
  constructor(private readonly prisma: PrismaService) {}

  async replaceForPath(pathId: string, tagIds: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const unique = await this.validateAndDedupe(tagIds, tx);
      await tx.pathTag.deleteMany({ where: { pathId } });
      if (unique.length > 0) {
        await tx.pathTag.createMany({
          data: unique.map((tagId) => ({ pathId, tagId })),
        });
      }
    });
  }

  async replaceForCourse(courseId: string, tagIds: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const unique = await this.validateAndDedupe(tagIds, tx);
      await tx.courseTag.deleteMany({ where: { courseId } });
      if (unique.length > 0) {
        await tx.courseTag.createMany({
          data: unique.map((tagId) => ({ courseId, tagId })),
        });
      }
    });
  }

  private async validateAndDedupe(
    tagIds: string[],
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const unique = Array.from(new Set(tagIds));
    if (unique.length === 0) {
      return unique;
    }

    const found = await tx.tag.findMany({
      where: { id: { in: unique } },
      select: { id: true, status: true },
    });
    const byId = new Map(found.map((t) => [t.id, t.status]));

    for (const id of unique) {
      const status = byId.get(id);
      if (status === undefined) {
        throw new NotFoundException(`Tag '${id}' does not exist`);
      }
      if (status !== TagStatus.ACTIVE) {
        throw new BadRequestException(
          `Tag '${id}' is hidden and cannot be attached`,
        );
      }
    }
    return unique;
  }
}
