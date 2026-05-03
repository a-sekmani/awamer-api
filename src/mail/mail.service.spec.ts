import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const mockConfigService = {
  get: jest.fn().mockReturnValue('development'),
};

describe('MailService', () => {
  let service: MailService;
  let consoleSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MailService>(MailService);

    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation();
    debugSpy = jest
      .spyOn((service as any).logger, 'debug')
      .mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('development');
  });

  describe('sendVerificationEmail — dev mode', () => {
    it('should print the code to console.log in non-production', async () => {
      await service.sendVerificationEmail(
        'ahmad@example.com',
        '654321',
        'Ahmad',
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('ahmad@example.com');
      expect(output).toContain('654321');
    });

    it('should not call the SES/logger path in non-production', async () => {
      await service.sendVerificationEmail('test@example.com', '123456', 'Test');

      expect(logSpy).not.toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should return early without throwing in non-production', async () => {
      await expect(
        service.sendVerificationEmail('test@example.com', '123456', 'Test'),
      ).resolves.toBeUndefined();
    });
  });

  describe('sendVerificationEmail — production mode', () => {
    beforeEach(() => {
      mockConfigService.get.mockReturnValue('production');
    });

    it('should log with the correct name, email, and code via logger', async () => {
      await service.sendVerificationEmail(
        'ahmad@example.com',
        '654321',
        'Ahmad',
      );

      expect(logSpy).toHaveBeenCalledTimes(1);
      const logMessage = logSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain('Ahmad');
      expect(logMessage).toContain('ahmad@example.com');
      expect(logMessage).toContain('654321');
    });

    it('should produce a bilingual email body containing the code', async () => {
      await service.sendVerificationEmail(
        'test@example.com',
        '123456',
        'Test User',
      );

      expect(debugSpy).toHaveBeenCalledTimes(1);
      const htmlBody = debugSpy.mock.calls[0][0] as string;

      expect(htmlBody).toContain('123456');
      expect(htmlBody).toContain('مرحباً');
      expect(htmlBody).toContain('dir="rtl"');
      expect(htmlBody).toContain('Hello');
      expect(htmlBody).toContain('dir="ltr"');
      expect(htmlBody).toContain('Test User');
    });

    it('should not use console.log in production', async () => {
      await service.sendVerificationEmail('test@example.com', '123456', 'Test');

      // console.log should not have been called with verification code
      const consoleOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(consoleOutput).not.toContain('Verification code');
    });

    it('should not throw if an internal error occurs (catches exceptions)', async () => {
      logSpy.mockImplementationOnce(() => {
        throw new Error('Logger crashed');
      });

      await expect(
        service.sendVerificationEmail('test@example.com', '123456', 'Test'),
      ).resolves.toBeUndefined();
    });
  });
});
