# Contract: Admin Audit Log Entry

**Feature**: 014-admin-foundation
**Producer**: `src/admin/interceptors/audit-log.interceptor.ts`
**Consumer**: Application logger (`@nestjs/common` `Logger`). No DB persistence in this feature.
**Activation**: applied per controller via the composite `@AdminEndpoint()` class-level decorator (which calls `@UseInterceptors(AuditLogInterceptor)`). NOT registered as `APP_INTERCEPTOR` — see `spec.md` § "Implementation correction — 2026-05-01" for why.

## When the interceptor emits

Exactly one entry per request, when ALL of the following are true:

1. The request is routed through a controller decorated with `@AdminEndpoint()` (the composite decorator that includes `@UseInterceptors(AuditLogInterceptor)`).
2. `req.method` ∈ `{ POST, PATCH, PUT, DELETE }`. GET/HEAD/OPTIONS produce no entry — the method gate skips them so even read controllers can carry `@AdminEndpoint()` without polluting logs.
3. `req.route` is defined (the route was matched — not a 404).

Controllers decorated with `@AdminEndpointNoAudit()` (the telemetry/health-check variant) skip the interceptor entirely and never produce audit entries. The `AdminHealthController` class-level decorator is `@AdminEndpoint()` so the e2e suite can exercise the audit interceptor against its `POST` handler; reads on the same controller skip emission via the method gate.

## When the interceptor does NOT emit

- Read requests (GET, HEAD, OPTIONS) on admin routes.
- Requests that 404 before reaching the matched route (i.e., no route resolution).
- Requests rejected by `JwtAuthGuard` (401) — those happen at the global guard layer before the admin-scope interceptor runs. (This is intentional: failed authentication is logged at the auth layer separately.)
- Requests rejected by `RolesGuard` (403) — same reason: the admin-scope guard runs BEFORE the audit interceptor inside the same scope. *Note: in NestJS the order is guards-before-interceptors, so a 403 at this guard means the interceptor never sees the request.*

## Outcome capture

The interceptor uses RxJS `tap` (with both `next` and `error` handlers) to record both happy-path and failure-path outcomes:

- **success** outcome: handler returned a value (HTTP 2xx). `outcome: 'success'`. No `statusCode` field.
- **error** outcome: handler or downstream interceptor/filter chain threw. `outcome: 'error'`. Adds `statusCode` (from `HttpException.getStatus()` if available, else absent for non-HTTP errors).

After recording, errors are **re-thrown** so the global `HttpExceptionFilter` can format the response normally.

## Field schema

| Field | Type | Required | Source |
|---|---|---|---|
| `userId` | UUID string | yes | `req.user.userId` |
| `userEmail` | string | yes | `req.user.email` |
| `roles` | `string[]` | yes | `req.user.roles` |
| `action` | string | yes | `${req.method} ${req.route.path}` (single concatenated string for grep-friendliness) |
| `route` | string | yes | `req.route.path` (matched pattern). Note: NestJS's `setGlobalPrefix('api/v1')` makes Express resolve the matched pattern as `/api/v1/admin/<entity>/...`. The prefix is part of the PATTERN (no parameter values present), e.g. `/api/v1/admin/users/:id`. |
| `method` | string | yes | `req.method` |
| `timestamp` | ISO 8601 string | yes | `new Date().toISOString()` |
| `ip` | string | yes | `req.ip` |
| `userAgent` | string | no | `req.headers['user-agent']` (omitted if missing) |
| `outcome` | `'success' \| 'error'` | yes | RxJS branch |
| `statusCode` | integer | conditional | only on `outcome: 'error'`, only when the thrown exception is an `HttpException` |

## Forbidden fields

The audit entry MUST NOT include any of:

- Request body (per FR-022 — admin endpoints can carry sensitive payloads).
- Request headers other than `User-Agent`.
- Response body.
- Internal exception class names or stack traces.
- Database identifiers other than `userId`.

## Failure isolation contract

If the logger transport throws while emitting (e.g., transport disconnected, JSON serialization fails), the interceptor MUST swallow the error (try/catch around the logger call). The original request response — success or error — MUST be returned unchanged. (FR-024.)

## Test cases (mapped to spec acceptance scenarios)

| Test ID | Scenario | Expected entry |
|---|---|---|
| AUDIT-T01 | Admin sends `POST /admin/__ping` (success). | One entry. `outcome: 'success'`. All required fields present. `statusCode` field absent. |
| AUDIT-T02 | Admin sends `GET /admin/__ping` (success). | NO entry. |
| AUDIT-T03 | Admin sends `DELETE /api/v1/admin/users/<uuid>` and the controller throws `NotFoundException`. | One entry. `outcome: 'error'`. `statusCode: 404`. `route: '/api/v1/admin/users/:id'` — uses the matched pattern (the parameter value `<uuid>` is replaced with `:id`); the global API prefix IS part of the matched pattern. |
| AUDIT-T04 | Logger transport throws synthetically inside test. | The mutation still returns its normal response. The synthetic logger error is not surfaced. |
| AUDIT-T05 | Authenticated non-admin sends `POST /admin/__ping`. | NO entry (RolesGuard blocks before the interceptor runs). |
| AUDIT-T06 | Anonymous sends `POST /admin/__ping`. | NO entry (JwtAuthGuard blocks before the AdminModule scope runs at all). |
