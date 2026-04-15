import { Controller, Get } from '@nestjs/common';
import { CacheService } from '../common/cache/cache.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

type ConnectivityState = 'connected' | 'disconnected';

const DB_TIMEOUT_MS = 500;

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @Public()
  async check() {
    const [database, cacheState] = await Promise.all([
      this.checkDatabase(),
      this.cache
        .isHealthy()
        .then((ok): ConnectivityState => (ok ? 'connected' : 'disconnected')),
    ]);
    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      cache: cacheState,
      uptime: Math.floor(process.uptime()),
    };
  }

  private async checkDatabase(): Promise<ConnectivityState> {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('db-check-timeout')),
            DB_TIMEOUT_MS,
          ),
        ),
      ]);
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }
}
