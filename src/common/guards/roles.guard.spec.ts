import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ErrorCode } from '../error-codes.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  function makeContext(user: unknown): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('GUARD-T01 — admin user with @Roles(Role.ADMIN) is allowed', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    expect(guard.canActivate(makeContext({ roles: [Role.ADMIN] }))).toBe(true);
  });

  it('GUARD-T02 — learner with @Roles(Role.ADMIN) is denied with INSUFFICIENT_ROLE', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    let thrown: ForbiddenException | undefined;
    try {
      guard.canActivate(makeContext({ roles: [Role.LEARNER] }));
    } catch (e) {
      thrown = e as ForbiddenException;
    }

    expect(thrown).toBeInstanceOf(ForbiddenException);
    const body = thrown!.getResponse() as { errorCode?: string };
    expect(body.errorCode).toBe(ErrorCode.INSUFFICIENT_ROLE);
  });

  it('GUARD-T03 — no @Roles metadata + admin user → allowed (default-deny falls back to ADMIN required)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext({ roles: [Role.ADMIN] }))).toBe(true);
  });

  it('GUARD-T04 — no @Roles metadata + learner → denied (default-deny)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(() =>
      guard.canActivate(makeContext({ roles: [Role.LEARNER] })),
    ).toThrow(ForbiddenException);
  });

  it('GUARD-T05 — multi-role @Roles(ADMIN, "EDITOR") with editor user → allowed', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Role.ADMIN, 'EDITOR']);
    expect(guard.canActivate(makeContext({ roles: ['EDITOR'] }))).toBe(true);
  });

  it('GUARD-T06 — req.user undefined → throws UnauthorizedException', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    let thrown: UnauthorizedException | undefined;
    try {
      guard.canActivate(makeContext(undefined));
    } catch (e) {
      thrown = e as UnauthorizedException;
    }

    expect(thrown).toBeInstanceOf(UnauthorizedException);
    const body = thrown!.getResponse() as { errorCode?: string };
    expect(body.errorCode).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('GUARD-T07 — empty @Roles() (zero args) is treated as missing → default-deny on learner', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    expect(() =>
      guard.canActivate(makeContext({ roles: [Role.LEARNER] })),
    ).toThrow(ForbiddenException);
  });
});
