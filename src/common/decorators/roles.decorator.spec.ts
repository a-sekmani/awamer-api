import 'reflect-metadata';
import { Role } from '@prisma/client';
import { ROLES_KEY, Roles } from './roles.decorator';

describe('@Roles decorator', () => {
  it('DECO-T01 — @Roles(Role.ADMIN) sets ROLES_KEY metadata to [\'ADMIN\']', () => {
    class Target {
      @Roles(Role.ADMIN)
      static handler(): void {}
    }

    const meta = Reflect.getMetadata(ROLES_KEY, Target.handler);
    expect(meta).toEqual([Role.ADMIN]);
  });

  it('DECO-T02 — @Roles(ADMIN, "EDITOR") sets metadata to [\'ADMIN\', \'EDITOR\']', () => {
    class Target {
      @Roles(Role.ADMIN, 'EDITOR')
      static handler(): void {}
    }

    const meta = Reflect.getMetadata(ROLES_KEY, Target.handler);
    expect(meta).toEqual([Role.ADMIN, 'EDITOR']);
  });

  it('DECO-T03 — @Roles() with no args sets metadata to []', () => {
    class Target {
      @Roles()
      static handler(): void {}
    }

    const meta = Reflect.getMetadata(ROLES_KEY, Target.handler);
    expect(meta).toEqual([]);
  });
});
