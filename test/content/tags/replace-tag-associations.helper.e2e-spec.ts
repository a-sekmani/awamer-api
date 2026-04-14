import { INestApplication } from '@nestjs/common';
import { PrismaClient, TagStatus } from '@prisma/client';
import { prisma as testPrisma, truncateAll } from '../../schema/setup';
import { createTestApp } from './test-app';
import { ReplaceTagAssociationsHelper } from '../../../src/content/tags/helpers/replace-tag-associations.helper';

const prisma: PrismaClient = testPrisma;

async function seedCtx() {
  const cat = await prisma.category.create({
    data: { name: 'C', slug: 'rep-cat' },
  });
  const path = await prisma.path.create({
    data: { categoryId: cat.id, title: 'P', slug: 'rep-p' },
  });
  const course = await prisma.course.create({
    data: { categoryId: cat.id, slug: 'rep-c', title: 'C' },
  });
  const tagA = await prisma.tag.create({
    data: { name: 'A', slug: 'rep-a', status: TagStatus.ACTIVE },
  });
  const tagB = await prisma.tag.create({
    data: { name: 'B', slug: 'rep-b', status: TagStatus.ACTIVE },
  });
  const tagC = await prisma.tag.create({
    data: { name: 'C', slug: 'rep-c-tag', status: TagStatus.ACTIVE },
  });
  const tagD = await prisma.tag.create({
    data: { name: 'D', slug: 'rep-d', status: TagStatus.ACTIVE },
  });
  const tagHidden = await prisma.tag.create({
    data: { name: 'H', slug: 'rep-hidden', status: TagStatus.HIDDEN },
  });
  return { path, course, tagA, tagB, tagC, tagD, tagHidden };
}

describe('ReplaceTagAssociationsHelper (e2e)', () => {
  let app: INestApplication;
  let helper: ReplaceTagAssociationsHelper;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    helper = app.get(ReplaceTagAssociationsHelper);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('replaceForPath', () => {
    it('replaces the full tag set atomically', async () => {
      const { path, tagA, tagB, tagC, tagD } = await seedCtx();
      await prisma.pathTag.createMany({
        data: [
          { pathId: path.id, tagId: tagA.id },
          { pathId: path.id, tagId: tagB.id },
        ],
      });
      await helper.replaceForPath(path.id, [tagB.id, tagC.id, tagD.id]);
      const rows = await prisma.pathTag.findMany({
        where: { pathId: path.id },
        orderBy: { tagId: 'asc' },
      });
      const tagIds = rows.map((r) => r.tagId).sort();
      expect(tagIds).toEqual([tagB.id, tagC.id, tagD.id].sort());
    });

    it('empty array removes all associations', async () => {
      const { path, tagA } = await seedCtx();
      await prisma.pathTag.create({ data: { pathId: path.id, tagId: tagA.id } });
      await helper.replaceForPath(path.id, []);
      expect(await prisma.pathTag.count({ where: { pathId: path.id } })).toBe(0);
    });

    it('deduplicates input', async () => {
      const { path, tagA, tagB } = await seedCtx();
      await helper.replaceForPath(path.id, [tagA.id, tagB.id, tagA.id, tagB.id]);
      expect(await prisma.pathTag.count({ where: { pathId: path.id } })).toBe(2);
    });

    it('nonexistent tag id rolls back and keeps prior state', async () => {
      const { path, tagA, tagB } = await seedCtx();
      await prisma.pathTag.createMany({
        data: [
          { pathId: path.id, tagId: tagA.id },
          { pathId: path.id, tagId: tagB.id },
        ],
      });
      await expect(
        helper.replaceForPath(path.id, [
          tagA.id,
          '00000000-0000-0000-0000-000000000000',
        ]),
      ).rejects.toThrow();
      const remaining = await prisma.pathTag.findMany({
        where: { pathId: path.id },
      });
      expect(remaining.map((r) => r.tagId).sort()).toEqual(
        [tagA.id, tagB.id].sort(),
      );
    });

    it('hidden tag id rolls back and keeps prior state', async () => {
      const { path, tagA, tagB, tagHidden } = await seedCtx();
      await prisma.pathTag.createMany({
        data: [
          { pathId: path.id, tagId: tagA.id },
          { pathId: path.id, tagId: tagB.id },
        ],
      });
      await expect(
        helper.replaceForPath(path.id, [tagA.id, tagHidden.id]),
      ).rejects.toThrow();
      const remaining = await prisma.pathTag.findMany({
        where: { pathId: path.id },
      });
      expect(remaining.map((r) => r.tagId).sort()).toEqual(
        [tagA.id, tagB.id].sort(),
      );
    });

    it('is idempotent when called twice with the same input', async () => {
      const { path, tagA, tagB } = await seedCtx();
      await helper.replaceForPath(path.id, [tagA.id, tagB.id]);
      const firstRows = await prisma.pathTag.findMany({
        where: { pathId: path.id },
        orderBy: { tagId: 'asc' },
      });
      await helper.replaceForPath(path.id, [tagA.id, tagB.id]);
      const secondRows = await prisma.pathTag.findMany({
        where: { pathId: path.id },
        orderBy: { tagId: 'asc' },
      });
      expect(secondRows.map((r) => r.tagId)).toEqual(
        firstRows.map((r) => r.tagId),
      );
    });
  });

  describe('replaceForCourse', () => {
    it('behaves identically for courses', async () => {
      const { course, tagA, tagB, tagC } = await seedCtx();
      await prisma.courseTag.createMany({
        data: [
          { courseId: course.id, tagId: tagA.id },
          { courseId: course.id, tagId: tagB.id },
        ],
      });
      await helper.replaceForCourse(course.id, [tagB.id, tagC.id]);
      const rows = await prisma.courseTag.findMany({
        where: { courseId: course.id },
      });
      expect(rows.map((r) => r.tagId).sort()).toEqual(
        [tagB.id, tagC.id].sort(),
      );
    });

    it('rolls back on hidden tag id for courses', async () => {
      const { course, tagA, tagHidden } = await seedCtx();
      await prisma.courseTag.create({
        data: { courseId: course.id, tagId: tagA.id },
      });
      await expect(
        helper.replaceForCourse(course.id, [tagHidden.id]),
      ).rejects.toThrow();
      const remaining = await prisma.courseTag.findMany({
        where: { courseId: course.id },
      });
      expect(remaining.map((r) => r.tagId)).toEqual([tagA.id]);
    });
  });
});
