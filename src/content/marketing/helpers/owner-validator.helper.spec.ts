import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MarketingOwnerType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnerValidator } from './owner-validator.helper';

describe('OwnerValidator', () => {
  let validator: OwnerValidator;
  let prisma: {
    path: { findUnique: jest.Mock };
    course: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      path: { findUnique: jest.fn() },
      course: { findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [OwnerValidator, { provide: PrismaService, useValue: prisma }],
    }).compile();
    validator = moduleRef.get(OwnerValidator);
  });

  describe('ensurePathExists', () => {
    it('passes when the path exists', async () => {
      prisma.path.findUnique.mockResolvedValue({ id: 'p1' });
      await expect(validator.ensurePathExists('p1')).resolves.toBeUndefined();
      expect(prisma.path.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
        select: { id: true },
      });
    });

    it("throws NotFoundException when the path doesn't exist", async () => {
      prisma.path.findUnique.mockResolvedValue(null);
      await expect(validator.ensurePathExists('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('ensureCourseExists', () => {
    it('passes when the course exists', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 'c1' });
      await expect(validator.ensureCourseExists('c1')).resolves.toBeUndefined();
    });

    it("throws NotFoundException when the course doesn't exist", async () => {
      prisma.course.findUnique.mockResolvedValue(null);
      await expect(validator.ensureCourseExists('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('ensureOwnerExists', () => {
    it('resolves PATH to the path lookup', async () => {
      prisma.path.findUnique.mockResolvedValue({ id: 'p1' });
      await validator.ensureOwnerExists(MarketingOwnerType.PATH, 'p1');
      expect(prisma.path.findUnique).toHaveBeenCalled();
      expect(prisma.course.findUnique).not.toHaveBeenCalled();
    });

    it('resolves COURSE to the course lookup', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 'c1' });
      await validator.ensureOwnerExists(MarketingOwnerType.COURSE, 'c1');
      expect(prisma.course.findUnique).toHaveBeenCalled();
      expect(prisma.path.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown ownerType (defensive)', async () => {
      await expect(
        validator.ensureOwnerExists(
          'UNKNOWN' as unknown as MarketingOwnerType,
          'x',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
