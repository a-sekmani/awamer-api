import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  capture(
    userId: string,
    event: string,
    properties?: Record<string, any>,
  ): void {
    // TODO: Replace with PostHog server-side capture
    this.logger.log(
      `[${event}] userId=${userId}${properties ? ` properties=${JSON.stringify(properties)}` : ''}`,
    );
  }
}
