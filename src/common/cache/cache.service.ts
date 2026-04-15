import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheKeys, OwnerType } from './cache-keys';
import { REDIS_CLIENT } from './redis.provider';

/**
 * CacheService is a NON-CRITICAL dependency. Every method except `isHealthy`
 * MUST NEVER throw — cache failures degrade to cache misses and are logged at `warn`.
 * See spec FR-002.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`cache.get('${key}') failed: ${(err as Error).message}`);
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number | null,
  ): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      if (ttlSeconds === null) {
        await this.redis.set(key, raw);
      } else {
        await this.redis.set(key, raw, 'EX', ttlSeconds);
      }
    } catch (err) {
      this.logger.warn(`cache.set('${key}') failed: ${(err as Error).message}`);
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      const removed = await this.redis.del(key);
      return removed > 0;
    } catch (err) {
      this.logger.warn(`cache.del('${key}') failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Cursor-based SCAN + UNLINK pattern delete. Enumerates all matching keys
   * first (SCAN never blocks Redis), then deletes in batches of 500 via UNLINK
   * (async non-blocking delete). Never uses KEYS. Never throws.
   */
  async delByPattern(pattern: string): Promise<number> {
    let totalDeleted = 0;
    try {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, found] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          500,
        );
        cursor = nextCursor;
        if (found.length > 0) keys.push(...found);
      } while (cursor !== '0');

      for (let i = 0; i < keys.length; i += 500) {
        const batch = keys.slice(i, i + 500);
        const removed = await this.redis.unlink(...batch);
        totalDeleted += removed;
      }
    } catch (err) {
      this.logger.warn(
        `cache.delByPattern('${pattern}') failed: ${(err as Error).message}`,
      );
    }
    return totalDeleted;
  }

  /**
   * Blunt-but-correct invalidation for a path or course owner, covering marketing
   * caches and all detail/list caches for the scope. See spec §4.4.
   */
  async invalidateOwner(type: OwnerType, id: string): Promise<void> {
    await this.del(CacheKeys.marketing.features(type, id));
    await this.del(CacheKeys.marketing.faqs(type, id));
    await this.del(CacheKeys.marketing.testimonials(type, id));
    if (type === 'path') {
      await this.delByPattern(CacheKeys.paths.detailPattern());
      await this.delByPattern(CacheKeys.paths.listPattern());
    } else {
      await this.delByPattern(CacheKeys.courses.detailPattern());
      await this.delByPattern(CacheKeys.courses.listPattern());
    }
  }

  /**
   * Centralized slug lookup for an owner. Used by marketing services to build
   * the public URL for the ISR revalidation helper. Returns `null` on lookup
   * failure so the caller can best-effort skip revalidation. See research R5.
   *
   * Lives on CacheService (not on each marketing service) to preserve FR-019:
   * marketing services get DI + marker replacement only, no new private methods.
   */
  async slugFor(type: OwnerType, id: string): Promise<string | null> {
    try {
      if (type === 'path') {
        const row = await this.prisma.path.findUnique({
          where: { id },
          select: { slug: true },
        });
        return row?.slug ?? null;
      }
      const row = await this.prisma.course.findUnique({
        where: { id },
        select: { slug: true },
      });
      return row?.slug ?? null;
    } catch (err) {
      this.logger.warn(
        `cache.slugFor('${type}', '${id}') failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch (err) {
      this.logger.warn(`cache.isHealthy() failed: ${(err as Error).message}`);
      return false;
    }
  }
}
