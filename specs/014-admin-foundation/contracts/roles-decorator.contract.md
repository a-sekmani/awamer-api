# Contract: `@Roles(...roles)` + `RolesGuard`

**Feature**: 014-admin-foundation

## Decorator

**Location**: `src/common/decorators/roles.decorator.ts` (already exists; not modified by this feature)

```ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

### Usage

Apply to a controller class (whole-class scope) OR an individual handler method (handler scope). Handler-level overrides class-level.

```ts
import { Role } from '@prisma/client';

@Controller('admin/categories')
@Roles(Role.ADMIN)                    // ← class-level: applies to every handler
export class CategoriesAdminController {
  @Get()
  list() { ... }

  @Post()
  create() { ... }

  @Get('public-stub')
  @Roles(Role.ADMIN, 'EDITOR')        // ← handler-level: overrides class-level (allows ADMIN OR EDITOR)
  publicStub() { ... }
}
```

### Semantics

- `@Roles('A', 'B', 'C')` → user must hold AT LEAST ONE of `A`, `B`, `C` (case-sensitive string match against the user's `roles[]`).
- `@Roles(Role.ADMIN)` → user must hold the `ADMIN` role.
- `@Roles()` (zero args) → still sets metadata, but with empty array. `RolesGuard` treats this the same as no-metadata (default-deny inside admin scope). Discouraged usage; lint suggestion: prefer omitting the decorator and letting default-deny apply.

**Role string casing**: roles are UPPERCASE throughout admin code (matching the Prisma `Role` enum values written into JWT payloads — see `docs/admin-foundation.md` §2 "Role string conventions"). Always use `Role.ADMIN` / `Role.LEARNER` from `@prisma/client` rather than string literals.

## Guard

**Location**: `src/common/guards/roles.guard.ts` (replaces existing stub)

### Behavioral contract

```ts
import { Role } from '@prisma/client';

const DEFAULT_ADMIN_REQUIRED: readonly string[] = [Role.ADMIN];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Read required roles from handler/class metadata.
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 2. Read user from request (populated by JwtAuthGuard upstream).
    const req = context.switchToHttp().getRequest();
    const user = req.user as { roles?: string[] } | undefined;

    // 3. Defensive: if for some reason no user is on req, deny.
    //    (JwtAuthGuard should have already 401'd; this is belt-and-braces.)
    if (!user) {
      throw new UnauthorizedException({ errorCode: ErrorCode.UNAUTHORIZED, message: 'Authentication required.' });
    }

    // 4. Default-deny inside admin scope: if no @Roles metadata is set, require Role.ADMIN.
    //    The guard runs only inside AdminModule's provider scope, so this default
    //    only applies to admin routes. Non-admin endpoints are not exposed to this guard.
    const requiredRoles = (required && required.length > 0) ? required : DEFAULT_ADMIN_REQUIRED;

    // 5. Check intersection: user must have at least one required role.
    const userRoles = user.roles ?? [];
    const ok = requiredRoles.some(r => userRoles.includes(r));
    if (!ok) {
      throw new ForbiddenException({ errorCode: ErrorCode.INSUFFICIENT_ROLE, message: 'Insufficient role.' });
    }

    return true;
  }
}
```

### Decision matrix

| `@Roles(...)` metadata | `req.user.roles` | Outcome |
|---|---|---|
| `[Role.ADMIN]` | `[Role.ADMIN]` | ✅ allow |
| `[Role.ADMIN]` | `[Role.ADMIN, 'EDITOR']` | ✅ allow (any-of) |
| `[Role.ADMIN]` | `[Role.LEARNER]` | ❌ 403 `INSUFFICIENT_ROLE` |
| `[Role.ADMIN, 'EDITOR']` | `['EDITOR']` | ✅ allow |
| `[Role.ADMIN, 'EDITOR']` | `[]` | ❌ 403 `INSUFFICIENT_ROLE` |
| (none — decorator omitted) | `[Role.ADMIN]` | ✅ allow (default-deny falls back to `Role.ADMIN` required, user has it) |
| (none — decorator omitted) | `[Role.LEARNER]` | ❌ 403 `INSUFFICIENT_ROLE` (default-deny on missing metadata) |
| `[]` (decorator with no args) | any | ❌ 403 (treated as missing — default-deny falls back to `Role.ADMIN` required) |
| (any) | `req.user` undefined | ❌ 401 `UNAUTHORIZED` (defensive — should have been blocked upstream) |

### Activation contract

`RolesGuard` is exported as a regular provider from `AdminModule` and applied
to admin controllers via the composite `@AdminEndpoint()` /
`@AdminEndpointNoAudit()` class-level decorator (defined at
`src/admin/common/decorators/admin-endpoint.decorator.ts`).

```ts
// src/admin/admin.module.ts
@Module({
  imports: [AuthModule],
  controllers: [AdminHealthController],
  providers: [RolesGuard, AuditLogInterceptor],
  exports: [RolesGuard, AuditLogInterceptor],
})
export class AdminModule {}

// each admin controller:
@Controller('admin/<entity>')
@AdminEndpoint()                         // bundles JwtAuthGuard, RolesGuard,
                                         // AuditLogInterceptor, @Roles(Role.ADMIN)
export class XAdminController { ... }
```

It is NOT registered as `APP_GUARD`. The `APP_GUARD` approach was rejected
during implementation because NestJS `APP_*` providers are app-global
regardless of which module declares them — a globally-registered default-deny
guard would have blocked every non-admin endpoint in the API. See the
"Implementation correction — 2026-05-01" section in `spec.md`.

### Unit test coverage (FR-013 + spec acceptance criteria)

| Test ID | Setup | Expected |
|---|---|---|
| GUARD-T01 | Mock context with `@Roles(Role.ADMIN)` and `req.user.roles = [Role.ADMIN]`. | `canActivate` returns `true`. |
| GUARD-T02 | Mock context with `@Roles(Role.ADMIN)` and `req.user.roles = [Role.LEARNER]`. | Throws `ForbiddenException`. Exception payload contains `errorCode: 'INSUFFICIENT_ROLE'`. |
| GUARD-T03 | Mock context with no `@Roles` metadata and `req.user.roles = [Role.ADMIN]`. | `canActivate` returns `true` (default-deny falls back to `Role.ADMIN`, user has it). |
| GUARD-T04 | Mock context with no `@Roles` metadata and `req.user.roles = [Role.LEARNER]`. | Throws `ForbiddenException`. |
| GUARD-T05 | Mock context with `@Roles(Role.ADMIN, 'EDITOR')` and `req.user.roles = ['EDITOR']`. | `canActivate` returns `true`. |
| GUARD-T06 | Mock context with `@Roles(Role.ADMIN)` and `req.user` is `undefined`. | Throws `UnauthorizedException`. |
| GUARD-T07 | Mock context with `@Roles()` (empty args) and `req.user.roles = [Role.LEARNER]`. | Throws `ForbiddenException` (treated as missing metadata → default-deny). |

Tests use `Reflector.getAllAndOverride` mocking via Jest, NOT a full Nest TestingModule. Pure unit, ms-fast.

## Decorator unit test coverage

| Test ID | Setup | Expected |
|---|---|---|
| DECO-T01 | Apply `@Roles(Role.ADMIN)` to a function and read metadata via `Reflect.getMetadata(ROLES_KEY, fn)`. | `['ADMIN']`. |
| DECO-T02 | Apply `@Roles(Role.ADMIN, 'EDITOR')`. | `['ADMIN', 'EDITOR']`. |
| DECO-T03 | Apply `@Roles()`. | `[]`. |
