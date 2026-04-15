import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      throw new Error('REDIS_URL is required but was not provided');
    }
    const useTls = url.startsWith('rediss://');
    const logger = new Logger('RedisClient');
    const client = new Redis(url, {
      tls: useTls ? {} : undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    client.on('connect', () => {
      logger.log(`Connected to ${url.replace(/\/\/.*@/, '//***@')}`);
    });
    client.on('error', (err) => {
      logger.warn(`Redis error: ${err.message}`);
    });
    return client;
  },
};
