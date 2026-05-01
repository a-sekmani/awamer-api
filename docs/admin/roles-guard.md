# RolesGuard — Backend Reference (awamer-api)

> **Class:** `RolesGuard`
> **Source:** `src/common/guards/roles.guard.ts`
> **Companion decorator:** `@Roles(...roles)` (`src/common/decorators/roles.decorator.ts`)
> **Applied via:** `@AdminEndpoint()` / `@AdminEndpointNoAudit()` — see [admin-endpoint-decorator.md](./admin-endpoint-decorator.md)

`RolesGuard` is the role-based authorization check that runs after
authentication and decides whether the caller's roles intersect the
roles required by the route. On admin routes, it is the source of every
`403 INSUFFICIENT_ROLE` and the defensive `401 UNAUTHORIZED` for
already-authenticated callers whose `req.user` was nevertheless lost.

It is structurally a generic role guard (not an admin-only file), but
its only callsite today is the admin foundation. If a non-admin caller
ever uses it, cross-link from the new home and treat this doc as the
canonical reference.

---

## 1. Summary

The guard is a thin three-step decision:

1. Read the required roles from the route handler / controller class
   metadata that `@Roles(...)` set.
2. Read `req.user` populated by the upstream `JwtAuthGuard`.
3. Allow if any required role is present in `req.user.roles`; otherwise
   deny with `ForbiddenException(INSUFFICIENT_ROLE)`. If `req.user` is
   missing, throw `UnauthorizedException(UNAUTHORIZED)` defensively.

The guard does **not** sniff URLs, the global API prefix, or the route
pattern. It cares only about the `@Roles(...)` metadata it can read
through `Reflector.getAllAndOverride`. Activation scoping is the job of
`@AdminEndpoint()` (and any future per-route `@UseGuards(RolesGuard)`
caller); the guard itself is unaware of which routes it is mounted on.

---

## 2. `canActivate(context)`

Source: `src/common/guards/roles.guard.ts:19–49`.

1. **Read required roles.**
   ```ts
   const required = this.reflector.getAllAndOverride<string[] | undefined>(
     ROLES_KEY,
     [context.getHandler(), context.getClass()],
   );
   ```
   `getAllAndOverride` checks the handler first, then the class — so a
   handler-level `@Roles(...)` overrides a class-level one. For
   admin controllers using `@AdminEndpoint()`, the metadata is always
   `[Role.ADMIN]` set at the class level.
2. **Read the user.**
   ```ts
   const req = context.switchToHttp().getRequest<{ user?: { roles?: string[] } }>();
   const user = req.user;
   ```
   `req.user` is populated by `JwtStrategy.validate` (yielding
   `{ userId, email, emailVerified, onboardingCompleted, roles }`) when
   `JwtAuthGuard` succeeds upstream. Populated `roles` is `string[]`
   carrying uppercase Prisma `Role` enum values (e.g. `['ADMIN']`,
   `['LEARNER']`, or both).
3. **Defensive auth check.**
   ```ts
   if (!user) {
     throw new UnauthorizedException({
       errorCode: ErrorCode.UNAUTHORIZED,
       message: 'Authentication required.',
     });
   }
   ```
   `JwtAuthGuard` should have already 401'd unauthenticated requests,
   so reaching this branch means something upstream is wrong — a route
   marked `@Public()` that nevertheless reached `RolesGuard`, or
   middleware that cleared `req.user`. The guard fails closed here
   rather than crashing on a downstream `user.roles` access.
4. **Resolve effective required roles.**
   ```ts
   const requiredRoles =
     required && required.length > 0 ? required : DEFAULT_ADMIN_REQUIRED;
   ```
   Where `DEFAULT_ADMIN_REQUIRED = [Role.ADMIN]` (line 13). Missing
   metadata, or an empty `@Roles()` call, falls back to "ADMIN
   required". This default is a safety net — see §4.
5. **Intersection check.**
   ```ts
   const userRoles = user.roles ?? [];
   const allowed = requiredRoles.some((r) => userRoles.includes(r));
   ```
   Any-of semantics: the user must hold at least **one** of the
   required roles. Comparison is plain string equality — case-sensitive,
   no normalization.
6. **Deny on mismatch.**
   ```ts
   if (!allowed) {
     throw new ForbiddenException({
       errorCode: ErrorCode.INSUFFICIENT_ROLE,
       message: 'Insufficient role.',
     });
   }
   return true;
   ```

---

## 3. Decision matrix

| `@Roles(...)` metadata on the route | `req.user.roles` | Outcome |
|---|---|---|
| `[Role.ADMIN]` | `[Role.ADMIN]` | ✅ allow |
| `[Role.ADMIN]` | `[Role.ADMIN, 'EDITOR']` | ✅ allow (any-of) |
| `[Role.ADMIN]` | `[Role.LEARNER]` | ❌ `403 INSUFFICIENT_ROLE` |
| `[Role.ADMIN, 'EDITOR']` | `['EDITOR']` | ✅ allow |
| `[Role.ADMIN, 'EDITOR']` | `[]` | ❌ `403 INSUFFICIENT_ROLE` |
| (no `@Roles(...)` decorator) | `[Role.ADMIN]` | ✅ allow — default fallback to `[Role.ADMIN]`, user has it |
| (no `@Roles(...)` decorator) | `[Role.LEARNER]` | ❌ `403 INSUFFICIENT_ROLE` — default fallback applies |
| `@Roles()` (zero args, empty array metadata) | any | ❌ `403 INSUFFICIENT_ROLE` — empty metadata is treated as missing → default fallback |
| (any) | `req.user` is `undefined` | ❌ `401 UNAUTHORIZED` (defensive — `JwtAuthGuard` should have caught this) |

The matrix is asserted by seven unit tests at
`src/common/guards/roles.guard.spec.ts` (cases `GUARD-T01` through
`GUARD-T07`).

---

## 4. The default-deny fallback (and the absence of URL sniffing)

When `@Roles(...)` metadata is missing or empty, the guard falls back
to requiring `Role.ADMIN`. This default exists because:

- It fails closed. A future controller that uses
  `@UseGuards(RolesGuard)` directly (without `@AdminEndpoint()`) and
  forgets to add `@Roles(...)` still rejects non-admins instead of
  accidentally allowing them.
- It is a belt-and-braces guarantee on top of the canonical pattern
  `@AdminEndpoint()`, which always supplies `@Roles(Role.ADMIN)` as
  part of its `applyDecorators(...)` bundle. The default is never the
  primary mechanism — the decorator is.

The guard explicitly does **not** inspect the request URL or the global
API prefix. There is no `if (req.url.startsWith('/api/v1/admin/'))`
branch and no equivalent check. Activation scoping is the job of the
caller (`@AdminEndpoint()` decides which routes the guard runs on);
the guard's job is the role check, full stop. Mixing those concerns
would couple authorization to URL strings, which is a footgun that the
project explicitly rejected during the KAN-78 implementation
(`specs/014-admin-foundation/spec.md` Clarifications Q1).

The most common failure mode this default does **not** catch: a new
admin controller that **omits `@AdminEndpoint()` entirely**. In that
case `RolesGuard` is never mounted on the route, and the route is
reachable by any authenticated user. The code-review checklist in
[conventions.md §3](./conventions.md#3-code-review-checklist) is the line of defense for that case; an
ESLint rule asserting class-level `@AdminEndpoint()` on every
controller in `src/admin/**` is tracked as a follow-up enhancement.

---

## 5. Error responses surfaced

All errors flow through the global `HttpExceptionFilter`
(`src/common/filters/http-exception.filter.ts`) into the platform-wide
shape `{ statusCode, message, errorCode?, errors?: [] }`.

| Status | `errorCode` | When |
|--------|---|---|
| `401` | `UNAUTHORIZED` | Defensive branch — `req.user` was missing despite the guard running. Should be unreachable in production; surfaces as a normal 401 if it ever happens. |
| `403` | `INSUFFICIENT_ROLE` | Authenticated user whose `roles` array does not intersect the required-roles set. The dominant error path. |

The error body never contains stack traces, exception class names, or
internal identifiers — `HttpExceptionFilter` strips them. The e2e suite
asserts these absences explicitly under the `'403 response body
contains no stack trace or internal exception class names'` test
(`test/admin.e2e-spec.ts:160–173`).

---

## 6. Files involved

| File | Role |
|---|---|
| `src/common/guards/roles.guard.ts` | The guard implementation. |
| `src/common/decorators/roles.decorator.ts` | `@Roles(...roles)` — `(...roles: string[]) => SetMetadata(ROLES_KEY, roles)`. The metadata reader pairs with the guard. |
| `src/admin/common/decorators/admin-endpoint.decorator.ts` | The composite decorator that mounts the guard at the route level via `@UseGuards(JwtAuthGuard, RolesGuard)`. |
| `src/admin/common/constants/roles.const.ts` | Re-exports `Role` from `@prisma/client` so admin code passes `Role.ADMIN`, not the literal `'ADMIN'`. |
| `src/common/error-codes.enum.ts` | `UNAUTHORIZED`, `INSUFFICIENT_ROLE`. |
| `src/auth/strategies/jwt.strategy.ts` | Populates `req.user.roles` upstream. |

---

## 7. Tests

| File | Covers |
|---|---|
| `src/common/guards/roles.guard.spec.ts` | The full decision matrix in seven cases (`GUARD-T01`..`GUARD-T07`): admin allowed, learner denied with `INSUFFICIENT_ROLE`, missing-metadata default fallback (allowed for admin, denied for learner), multi-role intersection, missing `req.user` → `UnauthorizedException`, empty `@Roles()` treated as missing. |
| `src/common/decorators/roles.decorator.spec.ts` | Three cases (`DECO-T01`..`DECO-T03`) confirming `@Roles(Role.ADMIN)`, `@Roles(Role.ADMIN, 'EDITOR')`, and `@Roles()` all set the right `ROLES_KEY` metadata. |
| `test/admin.e2e-spec.ts` | End-to-end: admin → 200, learner → 403 with `INSUFFICIENT_ROLE` and clean error body, anonymous / malformed / expired JWT → 401. See [ping.md §9](./ping.md). |

---

## 8. Things NOT to change without coordination

- **Case sensitivity.** `requiredRoles.some((r) => userRoles.includes(r))`
  is a plain string match. Lowercasing one side or the other to be
  "lenient" would silently break either every admin user (if the guard
  expects `'admin'`) or every test (if metadata expects `'ADMIN'`).
  The whole project is consistent on uppercase Prisma-enum values; see
  [conventions.md §1](./conventions.md#1-role-string-conventions) for the convention and rationale.
- **The default-deny fallback.** Removing the
  `DEFAULT_ADMIN_REQUIRED = [Role.ADMIN]` constant would turn missing
  metadata into "no role required" — i.e. "anyone authenticated can
  pass". This converts the most common authoring mistake from
  fail-closed to fail-open.
- **The defensive `!user` 401.** Without it, a missing `req.user`
  would crash on `user.roles` and surface a 500. The 401 is more
  honest about what happened.
- **Intersection direction.** The check is "does the user hold any
  required role?", not "does the user hold all required roles?".
  Switching to `every` would silently revoke access from every user
  who is not multi-role.
- **No URL sniffing.** Adding URL-prefix branches inside the guard
  re-introduces the rejected design from the original KAN-78
  Clarifications Q1. Activation is the decorator's job.
