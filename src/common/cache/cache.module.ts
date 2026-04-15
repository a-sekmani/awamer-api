import { Global, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';
import { PrismaModule } from '../../prisma/prisma.module';
import { CacheService } from './cache.service';
import { REDIS_CLIENT, redisProvider } from './redis.provider';
import { RevalidationHelper } from './revalidation.helper';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [redisProvider, CacheService, RevalidationHelper],
  exports: [CacheService, RevalidationHelper, REDIS_CLIENT],
})
export class CacheModule implements OnModuleDestroy {
  private readonly logger = new Logger(CacheModule.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleDestroy(): Promise<void> {
    try {
      const client = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false });
      if (client) {
        await client.quit();
      }
    } catch (err) {
      this.logger.warn(`Redis quit failed: ${(err as Error).message}`);
    }
  }
}
