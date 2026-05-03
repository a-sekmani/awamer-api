import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuditLogInterceptor } from './audit-log.interceptor';

interface MockReqShape {
  method: string;
  route?: { path: string };
  user?: { userId: string; email: string; roles: string[] };
  ip?: string;
  headers?: Record<string, string>;
}

function makeContext(req: MockReqShape): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function makeNext(value: unknown, throwError$?: unknown): CallHandler {
  return {
    handle: () => (throwError$ ? throwError(() => throwError$) : of(value)),
  };
}

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let logSpy: jest.SpyInstance;

  const adminUser = {
    userId: '0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f',
    email: 'ops@awamer.com',
    roles: [Role.ADMIN],
  };

  beforeEach(() => {
    interceptor = new AuditLogInterceptor();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('AUDIT-T01 — POST mutation success: emits one structured entry with all required fields', async () => {
    const ctx = makeContext({
      method: 'POST',
      route: { path: '/admin/__ping' },
      user: adminUser,
      ip: '10.0.0.42',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });

    const result = await lastValueFrom(
      interceptor.intercept(ctx, makeNext({ ok: true })),
    );

    expect(result).toEqual({ ok: true });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = logSpy.mock.calls[0][0];
    expect(payload).toMatchObject({
      userId: adminUser.userId,
      userEmail: adminUser.email,
      roles: [Role.ADMIN],
      action: 'POST /admin/__ping',
      route: '/admin/__ping',
      method: 'POST',
      ip: '10.0.0.42',
      userAgent: 'Mozilla/5.0',
      outcome: 'success',
    });
    expect(typeof payload.timestamp).toBe('string');
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
    expect(payload.statusCode).toBeUndefined();
  });

  it('AUDIT-T02 — GET request emits no entry', async () => {
    const ctx = makeContext({
      method: 'GET',
      route: { path: '/admin/__ping' },
      user: adminUser,
      ip: '10.0.0.42',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });

    await lastValueFrom(interceptor.intercept(ctx, makeNext({ ok: true })));

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('AUDIT-T03 — DELETE on parameterized route logs the matched pattern, not the raw URL', async () => {
    const ctx = makeContext({
      method: 'DELETE',
      route: { path: '/admin/users/:id' },
      user: adminUser,
      ip: '10.0.0.42',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });

    const httpErr = new HttpException('Not found', 404);
    await expect(
      lastValueFrom(
        interceptor
          .intercept(ctx, makeNext(undefined, httpErr))
          .pipe(catchError(() => of('caught'))),
      ),
    ).resolves.toBe('caught');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = logSpy.mock.calls[0][0];
    expect(payload.route).toBe('/admin/users/:id');
    expect(payload.action).toBe('DELETE /admin/users/:id');
    expect(payload.outcome).toBe('error');
    expect(payload.statusCode).toBe(404);
    // raw UUIDs MUST NOT leak into route
    expect(payload.route).not.toMatch(/[0-9a-f]{8}-/);
  });

  it('AUDIT-T04 — logger throw is swallowed; the original response still resolves', async () => {
    logSpy.mockImplementationOnce(() => {
      throw new Error('logger transport down');
    });

    const ctx = makeContext({
      method: 'POST',
      route: { path: '/admin/__ping' },
      user: adminUser,
      ip: '10.0.0.42',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });

    const result = await lastValueFrom(
      interceptor.intercept(ctx, makeNext({ ok: true })),
    );
    expect(result).toEqual({ ok: true });
  });

  it('AUDIT-T05 — req.route undefined skips emission', async () => {
    const ctx = makeContext({
      method: 'POST',
      route: undefined,
      user: adminUser,
      ip: '10.0.0.42',
    });

    await lastValueFrom(interceptor.intercept(ctx, makeNext({ ok: true })));

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('AUDIT-T06 — PUT mutation success: emits one entry (PUT included in method gate per FR-019)', async () => {
    const ctx = makeContext({
      method: 'PUT',
      route: { path: '/admin/__ping' },
      user: adminUser,
      ip: '10.0.0.42',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });

    await lastValueFrom(interceptor.intercept(ctx, makeNext({ ok: true })));

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatchObject({
      method: 'PUT',
      action: 'PUT /admin/__ping',
      outcome: 'success',
    });
  });
});
