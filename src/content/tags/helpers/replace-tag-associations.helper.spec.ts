import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TagStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReplaceTagAssociationsHelper } from './replace-tag-associations.helper';

type Op = { kind: string; args: unknown };

type FakeTx = {
  tag: { findMany: jest.Mock };
  pathTag: { deleteMany: jest.Mock; createMany: jest.Mock };
  courseTag: { deleteMany: jest.Mock; createMany: jest.Mock };
};

function makePrismaMock() {
  const ops: Op[] = [];
  const tagStore = new Map<string, TagStatus>();
  const tx: FakeTx = {
    tag: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        ops.push({ kind: 'tag.findMany', args: where });
        return where.id.in
          .filter((id) => tagStore.has(id))
          .map((id) => ({ id, status: tagStore.get(id) as TagStatus }));
      }),
    },
    pathTag: {
      deleteMany: jest.fn(async (args: unknown) => {
        ops.push({ kind: 'pathTag.deleteMany', args });
        return { count: 0 };
      }),
      createMany: jest.fn(async (args: unknown) => {
        ops.push({ kind: 'pathTag.createMany', args });
        return { count: 0 };
      }),
    },
    courseTag: {
      deleteMany: jest.fn(async (args: unknown) => {
        ops.push({ kind: 'courseTag.deleteMany', args });
        return { count: 0 };
      }),
      createMany: jest.fn(async (args: unknown) => {
        ops.push({ kind: 'courseTag.createMany', args });
        return { count: 0 };
      }),
    },
  };
  const $transaction = jest.fn(
    async (cb: (tx: FakeTx) => Promise<unknown>) => cb(tx),
  );
  return { $transaction, tx, ops, tagStore };
}

describe('ReplaceTagAssociationsHelper', () => {
  let helper: ReplaceTagAssociationsHelper;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplaceTagAssociationsHelper,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    helper = module.get(ReplaceTagAssociationsHelper);
  });

  describe('replaceForPath', () => {
    it('deduplicates input', async () => {
      prisma.tagStore.set('t1', TagStatus.ACTIVE);
      prisma.tagStore.set('t2', TagStatus.ACTIVE);
      await helper.replaceForPath('p1', ['t1', 't2', 't1']);
      const createCall = prisma.ops.find(
        (o) => o.kind === 'pathTag.createMany',
      );
      const data = (createCall?.args as { data: { tagId: string }[] }).data;
      expect(data.length).toBe(2);
      expect(data.map((d) => d.tagId).sort()).toEqual(['t1', 't2']);
    });

    it('runs inside a $transaction', async () => {
      prisma.tagStore.set('t1', TagStatus.ACTIVE);
      await helper.replaceForPath('p1', ['t1']);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('deletes existing associations before inserting new ones', async () => {
      prisma.tagStore.set('t1', TagStatus.ACTIVE);
      await helper.replaceForPath('p1', ['t1']);
      const kinds = prisma.ops.map((o) => o.kind);
      const deleteIdx = kinds.indexOf('pathTag.deleteMany');
      const createIdx = kinds.indexOf('pathTag.createMany');
      expect(deleteIdx).toBeGreaterThanOrEqual(0);
      expect(createIdx).toBeGreaterThan(deleteIdx);
    });

    it('rejects a nonexistent tag id with NotFoundException', async () => {
      prisma.tagStore.set('t1', TagStatus.ACTIVE);
      await expect(
        helper.replaceForPath('p1', ['t1', 'ghost']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        prisma.ops.some((o) => o.kind === 'pathTag.createMany'),
      ).toBe(false);
    });

    it("rejects a hidden tag id with BadRequestException", async () => {
      prisma.tagStore.set('t1', TagStatus.ACTIVE);
      prisma.tagStore.set('t-hidden', TagStatus.HIDDEN);
      await expect(
        helper.replaceForPath('p1', ['t1', 't-hidden']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is idempotent when called twice with the same input', async () => {
      prisma.tagStore.set('t1', TagStatus.ACTIVE);
      prisma.tagStore.set('t2', TagStatus.ACTIVE);
      await helper.replaceForPath('p1', ['t1', 't2']);
      const firstCreate = prisma.ops
        .filter((o) => o.kind === 'pathTag.createMany')
        .map((o) => o.args);
      prisma.ops.length = 0;
      await helper.replaceForPath('p1', ['t1', 't2']);
      const secondCreate = prisma.ops
        .filter((o) => o.kind === 'pathTag.createMany')
        .map((o) => o.args);
      expect(firstCreate).toEqual(secondCreate);
    });

    it('skips createMany on empty input but still deletes', async () => {
      await helper.replaceForPath('p1', []);
      const kinds = prisma.ops.map((o) => o.kind);
      expect(kinds).toContain('pathTag.deleteMany');
      expect(kinds).not.toContain('pathTag.createMany');
    });
  });

  describe('replaceForCourse', () => {
    it('behaves symmetrically for courses', async () => {
      prisma.tagStore.set('t1', TagStatus.ACTIVE);
      prisma.tagStore.set('t2', TagStatus.ACTIVE);
      await helper.replaceForCourse('c1', ['t1', 't2', 't2']);
      const kinds = prisma.ops.map((o) => o.kind);
      expect(kinds).toContain('courseTag.deleteMany');
      expect(kinds).toContain('courseTag.createMany');
      const create = prisma.ops.find(
        (o) => o.kind === 'courseTag.createMany',
      );
      const data = (create?.args as { data: { tagId: string }[] }).data;
      expect(data.length).toBe(2);
    });

    it('rejects a nonexistent tag id for courses too', async () => {
      await expect(
        helper.replaceForCourse('c1', ['ghost']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
