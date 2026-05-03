import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RevalidationHelper } from './revalidation.helper';

describe('RevalidationHelper', () => {
  let helper: RevalidationHelper;
  let config: { get: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    config = { get: jest.fn() };
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevalidationHelper,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    helper = module.get(RevalidationHelper);
  });

  it('is a no-op when FRONTEND_REVALIDATE_SECRET is unset (even if FRONTEND_URL is set)', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'FRONTEND_URL' ? 'http://localhost:3000' : undefined,
    );
    await helper.revalidatePath('/paths/my-slug');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op when FRONTEND_URL is unset', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'FRONTEND_REVALIDATE_SECRET' ? 'secret' : undefined,
    );
    await helper.revalidatePath('/paths/my-slug');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to ${FRONTEND_URL}/api/revalidate with the correct body when both are set', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'FRONTEND_URL') return 'https://awamer.test';
      if (key === 'FRONTEND_REVALIDATE_SECRET') return 'super-secret';
      return undefined;
    });
    await helper.revalidatePath('/paths/my-slug');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://awamer.test/api/revalidate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: 'super-secret',
          path: '/paths/my-slug',
        }),
      },
    );
  });

  it('swallows fetch errors without propagating', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'FRONTEND_URL') return 'https://awamer.test';
      if (key === 'FRONTEND_REVALIDATE_SECRET') return 'super-secret';
      return undefined;
    });
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(helper.revalidatePath('/paths/x')).resolves.toBeUndefined();
  });
});
