# Phase 1 Data Model: Admin Module Foundation — Backend (KAN-78)

**Feature**: 014-admin-foundation
**Date**: 2026-05-01
**Spec**: [spec.md](./spec.md)

This feature has **no database entities** (no Prisma schema changes). What it does have is a small set of in-memory contracts and one DTO. They are documented here for completeness.

## 1. `ReorderItemsDto` (DTO)

**Location**: `src/admin/common/dto/reorder-items.dto.ts`

**Purpose**: Reusable bulk reorder payload shape for any admin endpoint that mutates `sortOrder` across multiple records of one entity (Sections, Lessons, Content Blocks, possibly Paths and Courses). Categories explicitly do not use this — Categories are sorted by `createdAt DESC`.

### Shape

```ts
class ReorderItemDto {
  id: string;          // UUID v4
  sortOrder: number;   // non-negative integer
}

class ReorderItemsDto {
  items: ReorderItemDto[];   // array of ReorderItemDto, min 1, no duplicate ids
}
```

### Field Constraints

| Field | Constraint | Validator | Error code |
|---|---|---|---|
| `items` | Required, must be an array | `@IsArray()` | `VALIDATION_FAILED` |
| `items` | Length ≥ 1 | `@ArrayMinSize(1)` | `VALIDATION_FAILED` |
| `items` | No duplicate `id` values across array entries | `@ArrayUnique(o => o.id, { message: 'reorder items contain duplicate ids' })` | `VALIDATION_FAILED` |
| `items[]` | Each item validated as nested object | `@ValidateNested({ each: true })` + `@Type(() => ReorderItemDto)` | `VALIDATION_FAILED` |
| `items[].id` | Required, UUID v4 format | `@IsUUID('4')` | `VALIDATION_FAILED` |
| `items[].sortOrder` | Required, integer ≥ 0 | `@IsInt()` + `@Min(0)` | `VALIDATION_FAILED` |

### Examples

**Valid**:
```json
{
  "items": [
    { "id": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f", "sortOrder": 0 },
    { "id": "1b9c2e3d-2e6d-5a0c-9e2e-2b3c4d5e6f70", "sortOrder": 1 }
  ]
}
```

**Invalid — duplicate id**:
```json
{
  "items": [
    { "id": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f", "sortOrder": 0 },
    { "id": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f", "sortOrder": 1 }
  ]
}
```

**Invalid — non-UUID id**:
```json
{ "items": [ { "id": "not-a-uuid", "sortOrder": 0 } ] }
```

**Invalid — negative sortOrder**:
```json
{ "items": [ { "id": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f", "sortOrder": -1 } ] }
```

**Invalid — empty array**:
```json
{ "items": [] }
```

### Validation behavior

`ReorderItemsDto` is enforced by the globally-registered `ValidationPipe` (already configured in `src/main.ts`). Failures produce HTTP 422 (or 400 by default Nest) with the existing global `HttpExceptionFilter` shape:

```json
{
  "statusCode": 422,
  "errorCode": "VALIDATION_FAILED",
  "message": "Validation failed",
  "errors": [
    "items.0.id must be a UUID",
    "items.1.sortOrder must not be less than 0"
  ]
}
```

(Note: Awamer API standardizes on the existing filter's behavior — the filter sets `errorCode: VALIDATION_FAILED` automatically when class-validator returns an array of messages — see `src/common/filters/http-exception.filter.ts:46-49`.)

---

## 2. Audit log entry (in-memory structured log)

**Location of emitter**: `src/admin/interceptors/audit-log.interceptor.ts`

**Persistence**: NONE. Entries are written to the application logger (`@nestjs/common` `Logger`). Database persistence is a follow-up feature.

### Fields

| Field | Type | Source | Notes |
|---|---|---|---|
| `userId` | `string` (UUID) | `req.user.userId` (set by `JwtStrategy.validate`) | Always present after `JwtAuthGuard` |
| `userEmail` | `string` | `req.user.email` | Always present after `JwtAuthGuard` |
| `roles` | `string[]` | `req.user.roles` | Array per existing JWT payload shape |
| `action` | `string` | `${req.method} ${req.route?.path}` | E.g. `"POST /api/v1/admin/users/:id"` (NestJS `setGlobalPrefix('api/v1')` is part of the matched pattern; no parameter values appear). |
| `route` | `string` | `req.route?.path` | Matched pattern (with global API prefix), NOT raw URL. E.g. `/api/v1/admin/users/:id`. |
| `method` | `string` | `req.method` | One of `POST`, `PATCH`, `PUT`, `DELETE` |
| `timestamp` | `string` (ISO 8601) | `new Date().toISOString()` | UTC ISO string |
| `ip` | `string` | `req.ip` (Express, with `app.set('trust proxy', ...)` if behind LB) | Best-effort |
| `userAgent` | `string \| undefined` | `req.headers['user-agent']` | May be missing |
| `outcome` | `'success' \| 'error'` | RxJS pipeline branch | `success` from `tap.next`, `error` from `tap.error` / `catchError` |
| `statusCode` | `number \| undefined` | On error: `exception.status` (when `HttpException`) | Omitted on success (the response status is normal 2xx) |

### Emission rules

1. **Method gate**: Only emits when `req.method` ∈ `{ POST, PATCH, PUT, DELETE }`. GET/HEAD/OPTIONS produce no entry. (Spec FR-019 lists POST/PATCH/DELETE; PUT is included to be safe — admin endpoints should not use it but the cost of including it is zero, and excluding it would silently drop audit on a future PUT-using sub-module.)
2. **Route gate**: Skips emission when `req.route` is `undefined` (defensive — should not happen in practice for matched admin routes).
3. **Cardinality**: Exactly one log entry per request (success or error, not both).
4. **Failure isolation**: If the logger itself throws, the interceptor wraps the emission in a `try/catch` so the underlying request response is unaffected. Logger errors are silently swallowed at info-level visibility (best-effort).

### Example success entry

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

### Example error entry

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

---

## 3. `ErrorCode` enum extensions

**Location**: `src/common/error-codes.enum.ts` (existing file — adding new members)

### New members

| Code | When emitted |
|---|---|
| `FORBIDDEN` | Generic 403 from admin scope — when a `ForbiddenException` is thrown without a more specific code attached. |
| `INSUFFICIENT_ROLE` | Specifically thrown by `RolesGuard` when the authenticated user lacks the required admin role (or any required role from `@Roles(...)` metadata). |

### Existing reused members

| Code | When emitted |
|---|---|
| `UNAUTHORIZED` | 401 from `JwtAuthGuard` — token missing, expired, or invalid. (Already exists.) |
| `VALIDATION_FAILED` | Auto-set by the global filter when `class-validator` returns an array of messages — applies to `ReorderItemsDto` failures and any other admin DTO. (Already exists.) |
| `INTERNAL_ERROR` | Auto-set by the global filter for unhandled exceptions. (Already exists.) |

---

## 4. Module-scoped provider topology (DI hierarchy)

This is not "data" in the database sense, but it is structural state worth documenting.

### Application root (`AppModule`) — UNCHANGED

```
AppModule
├── APP_GUARD: JwtAuthGuard         ← already global, runs first on every route
├── APP_GUARD: ThrottlerGuard       ← already global
├── APP_FILTER: HttpExceptionFilter ← already global, formats every error
├── APP_INTERCEPTOR: ResponseTransformInterceptor ← already global, wraps every success in { data, message }
└── imports: [..., AdminModule, ...]
```

### Admin scope (`AdminModule`) — NEW after this feature

```
AdminModule
├── imports: [AuthModule, ...future per-entity admin sub-modules]
├── controllers:
│   └── AdminHealthController              ← @AdminEndpoint() at class level
├── providers: [RolesGuard, AuditLogInterceptor]    ← regular providers (NOT APP_*)
└── exports: [RolesGuard, AuditLogInterceptor]      ← available to imported sub-modules
```

Activation: each admin controller decorates its class with `@AdminEndpoint()`
(or `@AdminEndpointNoAudit()`), which calls `@UseGuards(JwtAuthGuard, RolesGuard)`,
`@UseInterceptors(AuditLogInterceptor)`, and `@Roles(Role.ADMIN)` in one
`applyDecorators()` bundle. See spec.md § "Implementation correction —
2026-05-01" for why this approach replaces the originally-planned `APP_*`
provider registration.

### Request flow on a hypothetical `POST /api/v1/admin/categories`

```
1. JwtAuthGuard (global APP_GUARD)        → 401 if no/invalid JWT
2. ThrottlerGuard (global APP_GUARD)      → 429 if rate-limited
3. JwtAuthGuard (route-level via @AdminEndpoint, idempotent)  → reaffirms auth
4. RolesGuard (route-level via @AdminEndpoint)                → 403 if missing/insufficient role
5. ValidationPipe (global)                → 422 if DTO invalid
6. ResponseTransformInterceptor (global APP_INTERCEPTOR) before
7. AuditLogInterceptor (route-level via @AdminEndpoint) before
8. Controller handler executes
9. AuditLogInterceptor on next/error  → emit audit log entry
10. ResponseTransformInterceptor on next → wrap as { data, message: 'Success' }
11. HttpExceptionFilter (global APP_FILTER) on error → format as { statusCode, errorCode, message, errors? }
```

The route-level interceptor (step 7) runs AFTER global interceptors, which means
it runs AFTER `req.route` is finalized by Express's router. That ordering is
what makes the `req.route.path` read at log-emission time work without
URL-scrubbing.
