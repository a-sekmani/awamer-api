import { Test, TestingModule } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheKeys } from './cache-keys';
import { CacheService } from './cache.service';
import { REDIS_CLIENT } from './redis.provider';

describe('CacheService', () => {
  let service: CacheService;
  let redis: InstanceType<typeof RedisMock>;
  let prisma: {
    path: { findUnique: jest.Mock };
    course: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    redis = new RedisMock();
    prisma = {
      path: { findUnique: jest.fn() },
      course: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CacheService);
  });

  afterEach(async () => {
    await redis.flushall();
  });

  describe('get', () => {
    it('returns null on cache miss', async () => {
      expect(await service.get('missing')).toBeNull();
    });

    it('returns the stored value on cache hit', async () => {
      await redis.set('k', JSON.stringify({ a: 1 }));
      expect(await service.get<{ a: number }>('k')).toEqual({ a: 1 });
    });

    it('round-trips Arabic UTF-8 text', async () => {
      const arabic = { title: 'أهلا بالعالم' };
      await service.set('ar', arabic, null);
      expect(await service.get<typeof arabic>('ar')).toEqual(arabic);
    });

    it('returns null on corrupted JSON without throwing', async () => {
      await redis.set('bad', 'not-json{');
      expect(await service.get('bad')).toBeNull();
    });

    it('returns null when redis throws without propagating', async () => {
      jest.spyOn(redis, 'get').mockRejectedValueOnce(new Error('boom'));
      expect(await service.get('x')).toBeNull();
    });
  });

  describe('set', () => {
    it('stores a value with no TTL (null) permanently', async () => {
      await service.set('k', { v: 1 }, null);
      expect(await redis.ttl('k')).toBe(-1);
      expect(JSON.parse((await redis.get('k'))!)).toEqual({ v: 1 });
    });

    it('stores a value with a numeric TTL and sets expiry', async () => {
      await service.set('k', 'v', 60);
      const ttl = await redis.ttl('k');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('swallows redis errors without throwing', async () => {
      jest.spyOn(redis, 'set').mockRejectedValueOnce(new Error('boom'));
      await expect(service.set('k', 'v', null)).resolves.toBeUndefined();
    });
  });

  describe('del', () => {
    it('returns true when the key existed', async () => {
      await redis.set('k', '"v"');
      expect(await service.del('k')).toBe(true);
    });

    it('returns false when the key did not exist', async () => {
      expect(await service.del('absent')).toBe(false);
    });

    it('swallows errors and returns false', async () => {
      jest.spyOn(redis, 'del').mockRejectedValueOnce(new Error('boom'));
      expect(await service.del('k')).toBe(false);
    });
  });

  describe('delByPattern', () => {
    it('removes all matching keys and returns the count', async () => {
      await redis.set('perf:1', '1');
      await redis.set('perf:2', '2');
      await redis.set('other', 'x');
      const removed = await service.delByPattern('perf:*');
      expect(removed).toBe(2);
      expect(await redis.get('other')).toBe('x');
      expect(await redis.get('perf:1')).toBeNull();
    });

    it('handles a large key set without throwing', async () => {
      const pipeline = redis.pipeline();
      for (let i = 0; i < 1000; i++) pipeline.set(`stress:${i}`, '1');
      await pipeline.exec();
      const removed = await service.delByPattern('stress:*');
      expect(removed).toBe(1000);
    });

    it('returns 0 and swallows errors on redis failure', async () => {
      jest.spyOn(redis, 'scan').mockRejectedValueOnce(new Error('boom'));
      expect(await service.delByPattern('anything:*')).toBe(0);
    });
  });

  describe('invalidateOwner', () => {
    it('deletes marketing + pattern keys for a path owner', async () => {
      const id = 'p-1';
      await redis.set(CacheKeys.marketing.features('path', id), '1');
      await redis.set(CacheKeys.marketing.faqs('path', id), '1');
      await redis.set(CacheKeys.marketing.testimonials('path', id), '1');
      await redis.set('paths:detail:some-slug', '1');
      await redis.set('paths:list:abc123', '1');
      await redis.set('courses:list:xyz', '1');

      await service.invalidateOwner('path', id);

      expect(
        await redis.get(CacheKeys.marketing.features('path', id)),
      ).toBeNull();
      expect(await redis.get(CacheKeys.marketing.faqs('path', id))).toBeNull();
      expect(
        await redis.get(CacheKeys.marketing.testimonials('path', id)),
      ).toBeNull();
      expect(await redis.get('paths:detail:some-slug')).toBeNull();
      expect(await redis.get('paths:list:abc123')).toBeNull();
      // courses:* must remain untouched when invalidating a path
      expect(await redis.get('courses:list:xyz')).toBe('1');
    });

    it('deletes marketing + pattern keys for a course owner', async () => {
      await redis.set(CacheKeys.marketing.features('course', 'c-1'), '1');
      await redis.set('courses:detail:slug', '1');
      await redis.set('courses:list:abc', '1');
      await redis.set('paths:list:preserved', '1');

      await service.invalidateOwner('course', 'c-1');

      expect(
        await redis.get(CacheKeys.marketing.features('course', 'c-1')),
      ).toBeNull();
      expect(await redis.get('courses:detail:slug')).toBeNull();
      expect(await redis.get('courses:list:abc')).toBeNull();
      expect(await redis.get('paths:list:preserved')).toBe('1');
    });
  });

  describe('slugFor', () => {
    it('returns the slug for a valid path owner', async () => {
      prisma.path.findUnique.mockResolvedValue({ slug: 'my-path' });
      expect(await service.slugFor('path', 'id-1')).toBe('my-path');
      expect(prisma.path.findUnique).toHaveBeenCalledWith({
        where: { id: 'id-1' },
        select: { slug: true },
      });
    });

    it('returns the slug for a valid course owner', async () => {
      prisma.course.findUnique.mockResolvedValue({ slug: 'my-course' });
      expect(await service.slugFor('course', 'id-2')).toBe('my-course');
    });

    it('returns null when the owner does not exist', async () => {
      prisma.path.findUnique.mockResolvedValue(null);
      expect(await service.slugFor('path', 'missing')).toBeNull();
    });

    it('returns null and swallows errors when Prisma throws', async () => {
      prisma.path.findUnique.mockRejectedValueOnce(new Error('db down'));
      await expect(service.slugFor('path', 'id')).resolves.toBeNull();
    });
  });

  describe('isHealthy', () => {
    it('returns true when Redis responds to PING', async () => {
      expect(await service.isHealthy()).toBe(true);
    });

    it('returns false when Redis throws on PING', async () => {
      jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('down'));
      expect(await service.isHealthy()).toBe(false);
    });
  });
});
