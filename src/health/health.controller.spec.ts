import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../common/cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };
  let cache: { isHealthy: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    cache = { isHealthy: jest.fn().mockResolvedValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns { status, database, cache, uptime } when everything is healthy', async () => {
    const result = await controller.check();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        database: 'connected',
        cache: 'connected',
      }),
    );
    expect(result.uptime).toEqual(expect.any(Number));
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('reports cache disconnected but status ok when only Redis is down', async () => {
    cache.isHealthy.mockResolvedValue(false);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.cache).toBe('disconnected');
    expect(result.database).toBe('connected');
  });

  it('reports status degraded when database check throws', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('disconnected');
  });

  it('reports status degraded when both database and cache are down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    cache.isHealthy.mockResolvedValue(false);
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('disconnected');
    expect(result.cache).toBe('disconnected');
  });
});
