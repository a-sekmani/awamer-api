import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Dormant ISR revalidation helper. POSTs to `${FRONTEND_URL}/api/revalidate`
 * to ask the Next.js frontend to regenerate a cached page.
 *
 * Dormancy gate is on `FRONTEND_REVALIDATE_SECRET` presence (NOT FRONTEND_URL),
 * because FRONTEND_URL already has a value in .env.example; gating on the URL
 * would unintentionally activate the helper in every local dev environment.
 * See spec FR-026.
 */
@Injectable()
export class RevalidationHelper {
  private readonly logger = new Logger(RevalidationHelper.name);

  constructor(private readonly config: ConfigService) {}

  async revalidatePath(path: string): Promise<void> {
    const secret = this.config.get<string>('FRONTEND_REVALIDATE_SECRET');
    const frontendUrl = this.config.get<string>('FRONTEND_URL');

    if (!secret) {
      this.logger.debug(
        `revalidatePath skipped (FRONTEND_REVALIDATE_SECRET unset): ${path}`,
      );
      return;
    }
    if (!frontendUrl) {
      this.logger.debug(`revalidatePath skipped (FRONTEND_URL unset): ${path}`);
      return;
    }

    try {
      await fetch(`${frontendUrl}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, path }),
      });
    } catch (err) {
      this.logger.warn(
        `revalidatePath('${path}') failed: ${(err as Error).message}`,
      );
    }
  }
}
