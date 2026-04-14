import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CourseStatus,
  PathStatus,
  Prisma,
  TagStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TagsService } from './tags.service';

type FakeTag = {
  id: string;
  name: string;
  slug: string;
  status: TagStatus;
  createdAt: Date;
};

/**
 * Fixture (per KAN-71 §10.1 — at least 3 paths, 3 courses, 4 tags with overlaps):
 *
 *   tag1 (ACTIVE) → P1 published, P2 published, C1 published
 *   tag2 (ACTIVE) → P2 published, C2 published, C3 draft (excluded)
 *   tag3 (ACTIVE) → (no published associations — counts are 0)
 *   tag4 (HIDDEN) → P3 published, C1 published (hidden so it's not in public list)
 */
const TAGS: FakeTag[] = [
  {
    id: 'tag1',
    name: 'ألف',
    slug: 'alpha',
    status: TagStatus.ACTIVE,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
  },
  {
    id: 'tag2',
    name: 'باء',
    slug: 'beta',
    status: TagStatus.ACTIVE,
    createdAt: new Date('2026-04-02T00:00:00.000Z'),
  },
  {
    id: 'tag3',
    name: 'جيم',
    slug: 'gamma',
    status: TagStatus.ACTIVE,
    createdAt: new Date('2026-04-03T00:00:00.000Z'),
  },
  {
    id: 'tag4',
    name: 'دال',
    slug: 'delta',
    status: TagStatus.HIDDEN,
    createdAt: new Date('2026-04-04T00:00:00.000Z'),
  },
];

const PATH_COUNTS = [
  { tagId: 'tag1', _count: { _all: 2 } },
  { tagId: 'tag2', _count: { _all: 1 } },
  { tagId: 'tag4', _count: { _all: 1 } },
];

const COURSE_COUNTS = [
  { tagId: 'tag1', _count: { _all: 1 } },
  { tagId: 'tag2', _count: { _all: 1 } },
  { tagId: 'tag4', _count: { _all: 1 } },
];

function makePrismaMock() {
  return {
    tag: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pathTag: {
      groupBy: jest.fn(),
    },
    courseTag: {
      groupBy: jest.fn(),
    },
  };
}

describe('TagsService', () => {
  let service: TagsService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(TagsService);
  });

  describe('listPublic', () => {
    it('returns only ACTIVE tags, alphabetically, with correct counts', async () => {
      prisma.tag.findMany.mockResolvedValue(
        TAGS.filter((t) => t.status === TagStatus.ACTIVE),
      );
      prisma.pathTag.groupBy.mockResolvedValue(
        PATH_COUNTS.filter((c) => c.tagId !== 'tag4'),
      );
      prisma.courseTag.groupBy.mockResolvedValue(
        COURSE_COUNTS.filter((c) => c.tagId !== 'tag4'),
      );

      const result = await service.listPublic();

      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { status: TagStatus.ACTIVE },
        orderBy: { name: 'asc' },
      });
      expect(prisma.pathTag.groupBy).toHaveBeenCalledWith({
        by: ['tagId'],
        where: { path: { status: PathStatus.PUBLISHED } },
        _count: { _all: true },
      });
      expect(prisma.courseTag.groupBy).toHaveBeenCalledWith({
        by: ['tagId'],
        where: { course: { status: CourseStatus.PUBLISHED } },
        _count: { _all: true },
      });
      expect(result).toEqual([
        { id: 'tag1', name: 'ألف', slug: 'alpha', pathCount: 2, courseCount: 1 },
        { id: 'tag2', name: 'باء', slug: 'beta', pathCount: 1, courseCount: 1 },
        { id: 'tag3', name: 'جيم', slug: 'gamma', pathCount: 0, courseCount: 0 },
      ]);
    });

    it('returns an empty array when no active tags exist', async () => {
      prisma.tag.findMany.mockResolvedValue([]);
      prisma.pathTag.groupBy.mockResolvedValue([]);
      prisma.courseTag.groupBy.mockResolvedValue([]);
      const result = await service.listPublic();
      expect(result).toEqual([]);
    });

    it('round-trips Arabic tag names unchanged', async () => {
      const arabic = 'ذكاء صناعي';
      prisma.tag.findMany.mockResolvedValue([
        {
          id: 'ai',
          name: arabic,
          slug: 'ai',
          status: TagStatus.ACTIVE,
          createdAt: new Date(),
        },
      ]);
      prisma.pathTag.groupBy.mockResolvedValue([]);
      prisma.courseTag.groupBy.mockResolvedValue([]);
      const [first] = await service.listPublic();
      expect(first.name).toBe(arabic);
    });
  });

  describe('listAdmin', () => {
    it('returns all tags regardless of status', async () => {
      prisma.tag.findMany.mockResolvedValue(TAGS);
      prisma.pathTag.groupBy.mockResolvedValue(PATH_COUNTS);
      prisma.courseTag.groupBy.mockResolvedValue(COURSE_COUNTS);
      const result = await service.listAdmin();
      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      expect(result.length).toBe(4);
      const hidden = result.find((r) => r.id === 'tag4');
      expect(hidden?.status).toBe(TagStatus.HIDDEN);
      expect(hidden?.pathCount).toBe(1);
      expect(hidden?.courseCount).toBe(1);
    });

    it('includes status and ISO createdAt on every row', async () => {
      prisma.tag.findMany.mockResolvedValue([TAGS[0]]);
      prisma.pathTag.groupBy.mockResolvedValue([]);
      prisma.courseTag.groupBy.mockResolvedValue([]);
      const [row] = await service.listAdmin();
      expect(row.status).toBe(TagStatus.ACTIVE);
      expect(row.createdAt).toBe('2026-04-01T00:00:00.000Z');
    });
  });

  describe('create', () => {
    it('creates a tag with default ACTIVE status', async () => {
      const row: FakeTag = {
        id: 'new',
        name: 'New',
        slug: 'new',
        status: TagStatus.ACTIVE,
        createdAt: new Date(),
      };
      prisma.tag.create.mockResolvedValue(row);
      prisma.pathTag.groupBy.mockResolvedValue([]);
      prisma.courseTag.groupBy.mockResolvedValue([]);
      const result = await service.create({ name: 'New', slug: 'new' });
      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: { name: 'New', slug: 'new', status: TagStatus.ACTIVE },
      });
      expect(result.pathCount).toBe(0);
      expect(result.courseCount).toBe(0);
    });

    it('maps Prisma P2002 to ConflictException', async () => {
      prisma.tag.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '6',
        }),
      );
      await expect(
        service.create({ name: 'X', slug: 'dup' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('throws BadRequestException on empty body', async () => {
      await expect(service.update('id1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.tag.update).not.toHaveBeenCalled();
    });

    it('maps P2025 to NotFoundException', async () => {
      prisma.tag.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('missing', {
          code: 'P2025',
          clientVersion: '6',
        }),
      );
      await expect(
        service.update('missing-id', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps P2002 to ConflictException', async () => {
      prisma.tag.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '6',
        }),
      );
      await expect(
        service.update('some-id', { slug: 'collide' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('supports status transitions ACTIVE → HIDDEN → ACTIVE', async () => {
      const base: FakeTag = {
        id: 't',
        name: 'T',
        slug: 't',
        status: TagStatus.HIDDEN,
        createdAt: new Date(),
      };
      prisma.tag.update.mockResolvedValueOnce(base);
      prisma.pathTag.groupBy.mockResolvedValue([]);
      prisma.courseTag.groupBy.mockResolvedValue([]);
      const hidden = await service.update('t', { status: TagStatus.HIDDEN });
      expect(hidden.status).toBe(TagStatus.HIDDEN);

      prisma.tag.update.mockResolvedValueOnce({
        ...base,
        status: TagStatus.ACTIVE,
      });
      const active = await service.update('t', { status: TagStatus.ACTIVE });
      expect(active.status).toBe(TagStatus.ACTIVE);
    });
  });

  describe('remove', () => {
    it('maps P2025 to NotFoundException', async () => {
      prisma.tag.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('missing', {
          code: 'P2025',
          clientVersion: '6',
        }),
      );
      await expect(service.remove('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('resolves to void on success', async () => {
      prisma.tag.delete.mockResolvedValue(TAGS[0]);
      await expect(service.remove('tag1')).resolves.toBeUndefined();
    });
  });
});
