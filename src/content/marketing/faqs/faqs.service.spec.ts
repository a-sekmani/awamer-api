import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MarketingOwnerType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnerValidator } from '../helpers/owner-validator.helper';
import { ReorderHelper } from '../helpers/reorder.helper';
import { FaqsService } from './faqs.service';

type Row = {
  id: string;
  ownerType: MarketingOwnerType;
  ownerId: string;
  question: string;
  answer: string;
  order: number;
};

const row = (id: string, order: number): Row => ({
  id,
  ownerType: MarketingOwnerType.PATH,
  ownerId: 'p1',
  question: `q-${id}`,
  answer: `a-${id}`,
  order,
});

describe('FaqsService', () => {
  let service: FaqsService;
  let prisma: {
    faq: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let ownerValidator: { ensureOwnerExists: jest.Mock };
  let reorderHelper: { reorder: jest.Mock };

  beforeEach(async () => {
    prisma = {
      faq: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    ownerValidator = { ensureOwnerExists: jest.fn().mockResolvedValue(undefined) };
    reorderHelper = { reorder: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FaqsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OwnerValidator, useValue: ownerValidator },
        { provide: ReorderHelper, useValue: reorderHelper },
      ],
    }).compile();
    service = moduleRef.get(FaqsService);
  });

  it('lists by owner with correct orderBy', async () => {
    prisma.faq.findMany.mockResolvedValue([row('a', 0)]);
    await service.listByOwner(MarketingOwnerType.PATH, 'p1');
    expect(prisma.faq.findMany).toHaveBeenCalledWith({
      where: { ownerType: MarketingOwnerType.PATH, ownerId: 'p1' },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
  });

  it('creates with explicit order', async () => {
    prisma.faq.create.mockResolvedValue(row('x', 3));
    await service.create(MarketingOwnerType.COURSE, 'c1', {
      question: 'q',
      answer: 'a',
      order: 3,
    });
    expect(prisma.faq.create).toHaveBeenCalledWith({
      data: {
        ownerType: MarketingOwnerType.COURSE,
        ownerId: 'c1',
        question: 'q',
        answer: 'a',
        order: 3,
      },
    });
  });

  it('appends when order omitted (max + 1)', async () => {
    prisma.faq.findFirst.mockResolvedValue({ order: 2 });
    prisma.faq.create.mockResolvedValue(row('x', 3));
    await service.create(MarketingOwnerType.PATH, 'p1', {
      question: 'q',
      answer: 'a',
    });
    expect(prisma.faq.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ order: 3 }),
      }),
    );
  });

  it('appends to 0 on empty owner', async () => {
    prisma.faq.findFirst.mockResolvedValue(null);
    prisma.faq.create.mockResolvedValue(row('x', 0));
    await service.create(MarketingOwnerType.PATH, 'p1', {
      question: 'q',
      answer: 'a',
    });
    expect(prisma.faq.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ order: 0 }),
      }),
    );
  });

  it('rejects update with empty body', async () => {
    await expect(service.update('id', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFound on P2025 for update', async () => {
    prisma.faq.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: 'x',
      }),
    );
    await expect(
      service.update('id', { question: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound on P2025 for delete', async () => {
    prisma.faq.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: 'x',
      }),
    );
    await expect(service.remove('id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('delegates reorder to the helper', async () => {
    prisma.faq.findMany.mockResolvedValue([row('a', 0)]);
    await service.reorder(MarketingOwnerType.PATH, 'p1', ['a']);
    expect(reorderHelper.reorder).toHaveBeenCalledWith(
      'faq',
      MarketingOwnerType.PATH,
      'p1',
      ['a'],
    );
  });
});
