import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendPasswordResetEmail(
    email: string,
    token: string,
    name: string,
  ): Promise<void> {
    try {
      const frontendUrl = this.configService.get<string>(
        'FRONTEND_URL',
        'http://localhost:3000',
      );
      const resetLink = `${frontendUrl}/reset-password?token=${token}`;

      // TODO: Replace with AWS SES integration
      this.logger.log(
        `Password reset email for ${name} (${email}): ${resetLink}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send password reset email to ${email}: ${message}`,
      );
    }
  }

  async sendVerificationEmail(
    email: string,
    code: string,
    name: string,
  ): Promise<void> {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    if (!isProduction) {
      console.log(`\n========================================`);
      console.log(`Verification code for ${email}: ${code}`);
      console.log(`========================================\n`);
      return;
    }

    try {
      // TODO: Replace with AWS SES integration
      // Bilingual email: Arabic (top, RTL) + English (bottom, LTR)
      const htmlBody = `
        <div dir="rtl" style="text-align: right; font-family: 'Segoe UI', Tahoma, Arial, sans-serif;">
          <h2>مرحباً ${name}،</h2>
          <p>رمز التحقق من بريدك الإلكتروني هو:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 16px; background: #f4f4f4; display: inline-block; border-radius: 8px;">${code}</div>
          <p>هذا الرمز صالح لمدة 10 دقائق.</p>
        </div>
        <hr style="margin: 24px 0;" />
        <div dir="ltr" style="text-align: left; font-family: 'Segoe UI', Tahoma, Arial, sans-serif;">
          <h2>Hello ${name},</h2>
          <p>Your email verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 16px; background: #f4f4f4; display: inline-block; border-radius: 8px;">${code}</div>
          <p>This code is valid for 10 minutes.</p>
        </div>
      `;

      this.logger.log(
        `Verification email for ${name} (${email}): code=${code}`,
      );
      this.logger.debug(`Email HTML body: ${htmlBody}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send verification email to ${email}: ${message}`,
      );
    }
  }
}
