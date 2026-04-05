import { Test, TestingModule } from '@nestjs/testing';
import { CleanupService } from './cleanup.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = {
  rateLimitedRequest: {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
};

describe('CleanupService', () => {
  let service: CleanupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CleanupService>(CleanupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should delete records older than 24 hours', async () => {
    mockPrismaService.rateLimitedRequest.deleteMany.mockResolvedValue({
      count: 5,
    });

    const before = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await service.cleanupExpiredRateLimits();
    const after = new Date(Date.now() - 24 * 60 * 60 * 1000);

    expect(
      mockPrismaService.rateLimitedRequest.deleteMany,
    ).toHaveBeenCalledTimes(1);

    const call = mockPrismaService.rateLimitedRequest.deleteMany.mock.calls[0][0];
    const cutoff = call.where.createdAt.lt as Date;

    // The cutoff should be approximately 24 hours ago
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
  });

  it('should not delete records newer than 24 hours', async () => {
    mockPrismaService.rateLimitedRequest.deleteMany.mockResolvedValue({
      count: 0,
    });

    await service.cleanupExpiredRateLimits();

    // The query uses `lt` (less than) cutoff, so newer records are excluded
    const call = mockPrismaService.rateLimitedRequest.deleteMany.mock.calls[0][0];
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('should handle zero records to delete', async () => {
    mockPrismaService.rateLimitedRequest.deleteMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      service.cleanupExpiredRateLimits(),
    ).resolves.not.toThrow();
  });
});
