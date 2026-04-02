import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const mockConfigService = {
  get: jest.fn().mockReturnValue('http://localhost:3000'),
};

describe('MailService', () => {
  let service: MailService;
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

    // Spy on logger methods to capture output without printing
    logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation();
    debugSpy = jest
      .spyOn((service as any).logger, 'debug')
      .mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendVerificationEmail', () => {
    it('should log with the correct name, email, and code', async () => {
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

      // Contains the code
      expect(htmlBody).toContain('123456');
      // Contains Arabic content
      expect(htmlBody).toContain('مرحباً');
      expect(htmlBody).toContain('dir="rtl"');
      // Contains English content
      expect(htmlBody).toContain('Hello');
      expect(htmlBody).toContain('dir="ltr"');
      // Contains the user's name in both sections
      expect(htmlBody).toContain('Test User');
    });

    it('should send the email to the correct email address', async () => {
      await service.sendVerificationEmail(
        'specific@email.com',
        '111111',
        'User',
      );

      const logMessage = logSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain('specific@email.com');
    });

    it('should not throw if an internal error occurs (catches exceptions)', async () => {
      // Force the logger to throw to simulate an internal error
      logSpy.mockImplementationOnce(() => {
        throw new Error('Logger crashed');
      });

      // The method should not throw — it has a try/catch
      await expect(
        service.sendVerificationEmail('test@example.com', '123456', 'Test'),
      ).resolves.toBeUndefined();
    });
  });
});
