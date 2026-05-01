# Admin Foundation (KAN-78)

This document describes the foundation layer that every per-entity admin endpoint
in Awamer API depends on. Per-entity admin features (Categories, Paths, Courses,
Sections, Lessons, Content Blocks, Users, etc.) are layered ON TOP of this
foundation; their endpoints inherit role-based access control, the platform-wide
response shape, and audit logging automatically.

> **Spec / Plan**: see [`specs/014-admin-foundation/`](../specs/014-admin-foundation/) for
> the full design including ADRs, contracts, and the sub-module quickstart.

---

## 1. Response envelope

All admin endpoints reuse the platform-wide success and error shapes already
produced by the globally-registered `ResponseTransformInterceptor` and
`HttpExceptionFilter`. **No admin-scoped interceptor or filter is introduced** —
this avoids dual code paths and drift between admin and non-admin response
shapes.

### 1.1 Success — `{ data, message }`

```json
GET /api/v1/admin/__ping
Cookie: access_token=<admin JWT>

200 OK
{
  "data": { "ok": true },
  "message": "Success"
}
```

The `data` field carries the endpoint-specific payload. The `message` field is
always `"Success"` for 2xx responses.

### 1.2 Error — `{ statusCode, errorCode?, message, errors? }`

| Field | Type | Required | Notes |
|---|---|---|---|
| `statusCode` | integer | yes | HTTP status code |
| `errorCode` | string | when set | Stable, machine-readable code from the `ErrorCode` enum |
| `message` | string | yes | Human-readable summary |
| `errors` | string[] | only on validation failures | Field-level validation messages from class-validator |

The shape never includes stack traces, exception class names, raw database
errors, or other internal details.

### 1.3 Error examples

**401 — no JWT or invalid/expired JWT** (from the global `JwtAuthGuard`):

```json
GET /api/v1/admin/__ping
Cookie: <none>

401 Unauthorized
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

**403 — authenticated but lacking the `ADMIN` role** (from `RolesGuard`):

```json
GET /api/v1/admin/__ping
Cookie: access_token=<learner JWT>

403 Forbidden
{
  "statusCode": 403,
  "errorCode": "INSUFFICIENT_ROLE",
  "message": "Insufficient role."
}
```

**422 — validation failure** (e.g., `ReorderItemsDto` rejected):

```json
PATCH /api/v1/admin/sections/reorder
Cookie: access_token=<admin JWT>

{ "items": [{ "id": "not-a-uuid", "sortOrder": -1 }] }

422 Unprocessable Entity
{
  "statusCode": 422,
  "errorCode": "VALIDATION_FAILED",
  "message": "Validation failed",
  "errors": [
    "items.0.id must be a UUID",
    "items.0.sortOrder must not be less than 0"
  ]
}
```

(Status code may be 400 instead of 422 depending on the global `ValidationPipe`
configuration — the *shape* is the contract.)

---

## 2. Role string conventions

**ALL admin code MUST use UPPERCASE role strings.** This matches how the auth
layer issues JWTs, which propagate the Prisma `Role` enum's TypeScript values.

### 2.1 Why uppercase

In `prisma/schema.prisma`, the `Role` enum is declared with uppercase TypeScript
identifiers and an `@map` to lowercase database values:

```prisma
enum Role {
  LEARNER @map("learner")
  ADMIN   @map("admin")
}
```

The TypeScript-side value is `'LEARNER' | 'ADMIN'` — those are the strings that
`auth.service.ts` writes into the JWT payload's `roles` array, and those are
what `req.user.roles` carries everywhere downstream. The DB column is lowercase
but no admin code touches that representation.

### 2.2 Always use the `Role` enum from `@prisma/client`

For consistency, import the enum rather than typing string literals:

```ts
// Re-export inside admin scope:
import { Role } from 'src/admin/common/constants/roles.const';
// or directly from Prisma:
import { Role } from '@prisma/client';
```

### 2.3 Correct vs incorrect

✅ Correct:

```ts
@Controller('admin/categories')
@Roles(Role.ADMIN)                          // uppercase, enum-driven
export class CategoriesAdminController { ... }
```

❌ Incorrect — case mismatch silently produces 403 for legitimate admins:

```ts
@Roles('admin')                             // lowercase string never matches 'ADMIN' in JWT
@Roles('Admin')                             // mixed-case never matches
```

❌ Incorrect — typed string literal drifts from the enum:

```ts
@Roles('ADMIN')                             // works today, but if Role values ever change, this won't follow
```

### 2.4 Comparing roles inside services

If service-layer code needs to inspect roles (rare — most checks belong in the
guard), import the same enum:

```ts
import { Role } from '@prisma/client';

if (req.user.roles.includes(Role.ADMIN)) { ... }
```

---

## 3. `@Roles(...)` decorator and `RolesGuard`

### 3.1 Decorator

```ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

- **Class-level**: applies to every handler in the controller.
- **Handler-level**: overrides class-level for that one handler.
- **Multi-arg**: `@Roles(Role.ADMIN, 'EDITOR')` accepts users with EITHER role.

### 3.2 Guard

`RolesGuard` is exported as a regular provider from `AdminModule` and applied
to admin controllers via the composite `@AdminEndpoint()` / `@AdminEndpointNoAudit()`
decorator (see §5). It is NOT registered as `APP_GUARD` — that approach was
rejected during implementation because NestJS `APP_*` providers are always
app-global regardless of which module declares them, and a globally-registered
default-deny guard would block every non-admin endpoint in the API.

The decorator-based approach gives the same "import once, inherit everything"
ergonomic that the original module-cascade design promised, while matching
how NestJS actually scopes guards.

### 3.3 Decision matrix

| `@Roles(...)` metadata | `req.user.roles` | Outcome |
|---|---|---|
| `[Role.ADMIN]` | `[Role.ADMIN]` | ✅ allow |
| `[Role.ADMIN]` | `[Role.ADMIN, 'EDITOR']` | ✅ allow (any-of) |
| `[Role.ADMIN]` | `[Role.LEARNER]` | ❌ 403 `INSUFFICIENT_ROLE` |
| `[Role.ADMIN, 'EDITOR']` | `['EDITOR']` | ✅ allow |
| `[Role.ADMIN, 'EDITOR']` | `[]` | ❌ 403 `INSUFFICIENT_ROLE` |
| (none — decorator omitted) | `[Role.ADMIN]` | ✅ allow (default-deny falls back to `Role.ADMIN`, user has it) |
| (none — decorator omitted) | `[Role.LEARNER]` | ❌ 403 `INSUFFICIENT_ROLE` (default-deny on missing metadata) |
| `[]` (decorator with no args) | any | ❌ 403 (treated as missing — default-deny falls back to `Role.ADMIN`) |
| (any) | `req.user` undefined | ❌ 401 `UNAUTHORIZED` (defensive; `JwtAuthGuard` should have already blocked) |

### 3.4 Default-deny inside admin scope

When `RolesGuard` runs and the handler has no `@Roles(...)` metadata, the guard
default-denies with HTTP 403. The composite `@AdminEndpoint()` /
`@AdminEndpointNoAudit()` decorator always applies `@Roles(Role.ADMIN)`, so on
any admin controller that uses the canonical decorator the metadata is present
by construction. The default-deny path covers two cases:

1. A future controller that uses `@UseGuards(RolesGuard)` directly without a
   `@Roles(...)` metadata will fail-closed (403) rather than fail-open.
2. Defensive belt-and-braces: if the metadata is somehow lost, the guard still
   denies non-admins.

The most likely failure mode — forgetting the decorator entirely — is NOT
caught by default-deny (the guard simply never runs on that route). That is
why the code-review checklist in §5.2 and the future ESLint rule in §5.4
exist.

---

## 4. Audit Log

Every admin **mutation** request produces exactly one structured log entry. The
emitter is `AuditLogInterceptor` (`src/admin/interceptors/audit-log.interceptor.ts`),
registered as `APP_INTERCEPTOR` provider INSIDE `AdminModule` so it only fires
within admin scope.

### 4.1 When the interceptor emits

Exactly one entry per request, when ALL of the following are true:

1. The request is routed through any controller within `AdminModule`'s scope.
2. `req.method` ∈ `{ POST, PATCH, PUT, DELETE }`. GET / HEAD / OPTIONS produce no entry.
3. `req.route.path` is defined (the route was matched — not a 404).

### 4.2 When the interceptor does NOT emit

- Read requests (GET / HEAD / OPTIONS) on admin routes.
- Requests rejected by `JwtAuthGuard` (401) — those happen at the global guard
  layer before the admin-scope interceptor runs.
- Requests rejected by `RolesGuard` (403) — guards run BEFORE interceptors in
  the admin scope, so a 403 means the interceptor never sees the request.
- 404s before route resolution.

### 4.3 Field schema

| Field | Type | Required | Source |
|---|---|---|---|
| `userId` | UUID string | yes | `req.user.userId` (from `JwtStrategy.validate`) |
| `userEmail` | string | yes | `req.user.email` |
| `roles` | `string[]` | yes | `req.user.roles` (uppercase Prisma enum values, e.g. `['ADMIN']`) |
| `action` | string | yes | `${req.method} ${req.route.path}` |
| `route` | string | yes | `req.route.path` — the matched **pattern**, not the raw URL |
| `method` | string | yes | `POST` / `PATCH` / `PUT` / `DELETE` |
| `timestamp` | ISO 8601 string | yes | `new Date().toISOString()` |
| `ip` | string | yes | `req.ip` |
| `userAgent` | string | optional | `req.headers['user-agent']` |
| `outcome` | `'success' \| 'error'` | yes | RxJS `tap.next` vs `tap.error` |
| `statusCode` | integer | only on `error` | `HttpException.getStatus()` when available |

> **About the `route` field**: NestJS's `setGlobalPrefix('api/v1')` causes Express
> to record the matched pattern as `/api/v1/admin/<entity>/...`. So a real
> entry looks like `route: '/api/v1/admin/users/:id'`, not `/admin/users/:id`.
> The prefix is part of the PATTERN — it does not contain raw IDs and is
> useful for API-version forensics. The hard guarantee is "no parameter
> values appear in `route`" — `:id` stays as `:id`.

### 4.4 Example success entry

```json
{
  "level": "log",
  "context": "AdminAudit",
  "message": {
    "userId": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f",
    "userEmail": "ops@awamer.com",
    "roles": ["ADMIN"],
    "action": "POST /api/v1/admin/categories",
    "route": "/api/v1/admin/categories",
    "method": "POST",
    "timestamp": "2026-05-01T12:34:56.789Z",
    "ip": "10.0.0.42",
    "userAgent": "Mozilla/5.0 ...",
    "outcome": "success"
  }
}
```

### 4.5 Example error entry

```json
{
  "level": "log",
  "context": "AdminAudit",
  "message": {
    "userId": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f",
    "userEmail": "ops@awamer.com",
    "roles": ["ADMIN"],
    "action": "DELETE /api/v1/admin/users/:id",
    "route": "/api/v1/admin/users/:id",
    "method": "DELETE",
    "timestamp": "2026-05-01T12:35:01.123Z",
    "ip": "10.0.0.42",
    "userAgent": "Mozilla/5.0 ...",
    "outcome": "error",
    "statusCode": 404
  }
}
```

### 4.6 Forbidden fields

The audit entry MUST NOT include:

- Request body (admin endpoints can carry sensitive payloads).
- Request headers other than `User-Agent`.
- Response body.
- Internal exception class names or stack traces.
- Database identifiers other than `userId`.

### 4.7 Failure isolation

If the logger transport throws while emitting (transport disconnected, JSON
serialization fails, etc.), `AuditLogInterceptor` swallows the error and
returns the underlying handler's response unchanged. **Logger failures are
never propagated to the request pipeline.**

### 4.8 Persistence

Audit entries are written to the application logger only. Database
persistence is out of scope for KAN-78 and tracked as a follow-up feature.

> Full machine-readable contract: [`specs/014-admin-foundation/contracts/audit-log.contract.md`](../specs/014-admin-foundation/contracts/audit-log.contract.md).

---

## 5. Adding a new per-entity admin sub-module

Activation works via a **composite class-level decorator** rather than
NestJS module-scope cascade. (See spec.md "Implementation correction —
2026-05-01" for why: NestJS `APP_GUARD` / `APP_INTERCEPTOR` providers are
always global regardless of which module declares them.)

The end-to-end walkthrough lives at
[`specs/014-admin-foundation/quickstart.md`](../specs/014-admin-foundation/quickstart.md).
TL;DR:

1. Create `src/admin/<entity>/<entity>-admin.module.ts` + controller + service.
2. Decorate the controller class with `@Controller('admin/<entity>')` and
   `@AdminEndpoint()` (or `@AdminEndpointNoAudit()` for telemetry-only
   routes — see §5.1 below).
3. Import `<Entity>AdminModule` into `AdminModule.imports` (NEVER into
   `AppModule.imports`) so the providers resolve from `AdminModule`'s scope.
4. Add an e2e spec at `test/<entity>-admin.e2e-spec.ts` that mirrors
   `test/admin.e2e-spec.ts` for the 401/403/200 scenarios.

`@AdminEndpoint()` bundles `JwtAuthGuard`, `RolesGuard`,
`AuditLogInterceptor`, and `@Roles(Role.ADMIN)` into a single
`applyDecorators()` call. The audit interceptor's method gate skips
GET / HEAD / OPTIONS internally (FR-023), so reads do not pollute logs even
when the standard decorator is applied at the class level.

### 5.1 Choosing between `@AdminEndpoint()` and `@AdminEndpointNoAudit()`

| Use | Decorator |
|---|---|
| Any product-facing admin endpoint (CRUD, reorder, etc.) — read or write | `@AdminEndpoint()` |
| Health checks, version probes, debug pings — read-only telemetry where audit entries would be noise | `@AdminEndpointNoAudit()` |

When in doubt, use `@AdminEndpoint()`. The interceptor is cheap and
self-filtering on GET; the cost of forgetting audit on a write is much
higher than the cost of one extra interceptor pass on a read.

### 5.2 Code review checklist for new admin controllers

Reviewers MUST confirm:

- [ ] Controller is in `src/admin/<entity>/`
- [ ] Class is decorated with `@AdminEndpoint()` (or `@AdminEndpointNoAudit()`
      for telemetry-only endpoints) — not just per-method
- [ ] Module is imported into `AdminModule.imports`
- [ ] Route prefix follows `/admin/<entity>` convention
- [ ] Role strings are uppercase via `Role.ADMIN` (not literal `'admin'`)
- [ ] DTOs use `class-validator` decorators (per Constitution Principle V)
- [ ] If the controller mutates `sortOrder`, it imports `ReorderItemsDto`
      from `src/admin/common/dto/reorder-items.dto` rather than redefining
- [ ] E2E test covers: anonymous (401), learner (403), admin (200)
- [ ] No code in `src/admin/**` is imported from any public/learner module

### 5.3 Forbidden patterns

- ❌ Importing the sub-module into `AppModule.imports` — bypasses the
  shared admin tree.
- ❌ Re-implementing `RolesGuard`, the audit interceptor, the response
  envelope, or the error filter inside the sub-module.
- ❌ Importing anything from `src/admin/**` from a public/learner-facing
  module — admin primitives are admin-only.
- ❌ Using lowercase or mixed-case role strings (`'admin'`, `'Admin'`).
- ❌ Re-defining `ReorderItemsDto` inside a sub-module — import it from
  `src/admin/common/dto/reorder-items.dto`.
- ❌ Forgetting the class-level `@AdminEndpoint()` decorator — without it,
  the route is exposed without authorization.

### 5.4 Future enhancement: ESLint enforcement

A custom ESLint rule should enforce that every controller class in
`src/admin/**` has either `@AdminEndpoint()` or `@AdminEndpointNoAudit()`
applied at the class level. This prevents the most likely failure mode:
a developer creates a new admin controller and forgets the decorator,
silently exposing the routes without authorization checks.

Tracked as a follow-up enhancement (not blocking KAN-78 acceptance).

---

## 6. Shared admin primitives

| Primitive | Location | Use |
|---|---|---|
| `Role` enum re-export | `src/admin/common/constants/roles.const.ts` | Convenience re-export of the Prisma `Role` enum for use by admin sub-modules |
| `ReorderItemsDto` | `src/admin/common/dto/reorder-items.dto.ts` | Bulk reorder payload `[{ id: UUID, sortOrder: non-negative int }]` for entities that support manual ordering (Sections, Lessons, Content Blocks; possibly Paths, Courses). Categories explicitly do NOT use this. |
| `ErrorCode.FORBIDDEN`, `ErrorCode.INSUFFICIENT_ROLE` | `src/common/error-codes.enum.ts` | Stable, machine-readable codes surfaced on admin 403 responses |

---

## 7. References

- Spec: [`specs/014-admin-foundation/spec.md`](../specs/014-admin-foundation/spec.md)
- Plan: [`specs/014-admin-foundation/plan.md`](../specs/014-admin-foundation/plan.md)
- Contracts:
  - [`contracts/admin-ping.openapi.yaml`](../specs/014-admin-foundation/contracts/admin-ping.openapi.yaml)
  - [`contracts/audit-log.contract.md`](../specs/014-admin-foundation/contracts/audit-log.contract.md)
  - [`contracts/reorder-items.contract.md`](../specs/014-admin-foundation/contracts/reorder-items.contract.md)
  - [`contracts/roles-decorator.contract.md`](../specs/014-admin-foundation/contracts/roles-decorator.contract.md)
- Quickstart for new sub-modules: [`specs/014-admin-foundation/quickstart.md`](../specs/014-admin-foundation/quickstart.md)
