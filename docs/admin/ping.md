# Admin Ping — Backend Spec (awamer-api)

> **Module:** `AdminModule`
> **Endpoints:** `GET /api/v1/admin/__ping`, `POST /api/v1/admin/__ping`
> **Decorator:** `@AdminEndpoint()` at the class level — bundles `JwtAuthGuard`, `RolesGuard`, `AuditLogInterceptor`, `@Roles(Role.ADMIN)`
> **Status code:** `200 OK` on `GET`; `201 Created` on `POST`

This document describes the admin foundation's wiring smoke test as
implemented in `src/admin/controllers/admin-health.controller.ts`. It is
the only endpoint shipped by KAN-78 — every per-entity admin endpoint
added afterward (Categories, Paths, Courses, Sections, Lessons, Content
Blocks, Users, …) follows this same shape via `@AdminEndpoint()`.

---

## 1. Summary

`/admin/__ping` exists to exercise the entire admin foundation stack
end-to-end against a single, harmless route. It carries **no product
surface**. The handlers return a static `{ ok: true }` payload; the
value of the endpoint is everything that happens around the handler:

- `JwtAuthGuard` (global) rejects unauthenticated callers with `401`.
- `RolesGuard` (route-level via `@AdminEndpoint()`) rejects authenticated
  non-admin callers with `403` and `errorCode: INSUFFICIENT_ROLE`.
- `AuditLogInterceptor` (route-level via `@AdminEndpoint()`) emits one
  structured log entry on the `POST` (FR-019/FR-020) and zero entries on
  the `GET` (FR-023, "no audit on reads").
- The global `ResponseTransformInterceptor` wraps the handler return as
  `{ data: { ok: true }, message: 'Success' }`.

The existence of two verbs on one path is deliberate: `GET` exercises
the read path so the e2e suite can assert the audit interceptor stays
silent on reads; `POST` exercises the write path so the same suite can
assert exactly-one audit emission, full field shape, and graceful
behavior when the logger itself throws.

---

## 2. Request

### HTTP

```
GET  /api/v1/admin/__ping
POST /api/v1/admin/__ping
```

Auth: a valid JWT carrying `roles: ['ADMIN']` (uppercase, sourced from
the Prisma `Role` enum — see [conventions.md §1](./conventions.md#1-role-string-conventions) for the role-string
convention). The token may arrive in either the `access_token` cookie
or an `Authorization: Bearer <token>` header — `JwtStrategy` reads
both extractors (`src/auth/strategies/jwt.strategy.ts`).

No request body. No query parameters. No path parameters.

---

## 3. Behavior — `AdminHealthController`

Source: `src/admin/controllers/admin-health.controller.ts` (lines 1–32).

The class is decorated `@Controller('admin/__ping')` and `@AdminEndpoint()`
at the class level. Every handler on the class therefore inherits the
full guard + interceptor + role-metadata stack.

### 3.1 `GET` handler — `ping()`

```ts
@Get()
ping(): { ok: true } {
  return { ok: true };
}
```

The handler is a constant return. The work happens elsewhere:

1. `JwtAuthGuard` (global `APP_GUARD`) verifies the JWT and populates
   `req.user` via `JwtStrategy.validate` — yielding
   `{ userId, email, emailVerified, onboardingCompleted, roles }`.
2. `JwtAuthGuard` (route-level, idempotent, applied by
   `@AdminEndpoint()`) re-verifies. The double-application is harmless;
   it makes the contract self-contained at the call site.
3. `RolesGuard` (route-level) reads the `@Roles(Role.ADMIN)` metadata
   set by `@AdminEndpoint()` and the `req.user.roles` array. On
   intersection it returns `true`; otherwise it throws
   `ForbiddenException({ errorCode: ErrorCode.INSUFFICIENT_ROLE, ... })`.
4. `ValidationPipe` (global, configured in `src/main.ts`) is a no-op —
   there is nothing to validate.
5. The handler executes and returns `{ ok: true }`.
6. `AuditLogInterceptor` (route-level) **skips emission** — its method
   gate (`MUTATING_METHODS` set in
   `src/admin/interceptors/audit-log.interceptor.ts:12`) excludes `GET`.
7. `ResponseTransformInterceptor` (global `APP_INTERCEPTOR`) wraps the
   payload as `{ data: { ok: true }, message: 'Success' }`.

### 3.2 `POST` handler — `postPing()`

```ts
@Post()
postPing(): { ok: true } {
  return { ok: true };
}
```

Functionally identical to `ping()` — the same constant return, the
same guard chain. The single difference is HTTP method:

- The handler returns the same value, but Nest's default for `@Post()`
  is `201 Created` (so the e2e suite asserts `.expect(201)`).
- `AuditLogInterceptor` **does emit** because `'POST'` is in
  `MUTATING_METHODS`. See [audit-log-interceptor.md §3](./audit-log-interceptor.md)
  for the full method gate, and [audit-log-interceptor.md §4](./audit-log-interceptor.md)
  for the exact log-entry shape.

The `POST` handler exists **solely** for e2e coverage of the audit
interceptor; it has no product purpose. Removing it would silently lose
the test signal that asserts mutation logging works against a known-good
route. See §10.

---

## 4. Rate limiting

No per-route `@Throttle(...)` override. The endpoint inherits the
global throttler default (`THROTTLE_LIMIT=100` requests per
`THROTTLE_TTL=60000` ms per IP) configured in `AppModule`.

The e2e suite mocks `ThrottlerGuard.prototype.canActivate` to return
`true` (`test/admin.e2e-spec.ts:91`) so throttling does not interfere
with the foundation assertions.

---

## 5. Successful response

### `GET`

```
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "data": { "ok": true },
  "message": "Success"
}
```

### `POST`

```
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "data": { "ok": true },
  "message": "Success"
}
```

The wrapping `{ data, message }` shape is produced by the global
`ResponseTransformInterceptor` (`src/common/interceptors/response-transform.interceptor.ts`).
See [docs/api-conventions.md §2](../api-conventions.md) for the canonical
envelope rules.

---

## 6. Error responses

All errors are normalized by `HttpExceptionFilter`
(`src/common/filters/http-exception.filter.ts`) into the platform-wide
shape:

```json
{ "statusCode": 401, "message": "...", "errorCode": "...", "errors": [ ... ]? }
```

| Status | `errorCode` | When |
|--------|---|---|
| `401` | (unset) | Anonymous request — no JWT in `access_token` cookie and no `Authorization` header. The base `JwtAuthGuard` throws `UnauthorizedException` without an `errorCode`, so the field is absent on this path. |
| `401` | (unset) | Malformed bearer token (e.g. `Bearer not-a-real-jwt`). Passport rejects; `JwtAuthGuard` propagates as 401. |
| `401` | (unset) | Expired JWT (`exp` past). Same path. |
| `403` | `INSUFFICIENT_ROLE` | Authenticated user whose JWT `roles` does not include `'ADMIN'`. Thrown by `RolesGuard` (`src/common/guards/roles.guard.ts:38–43`). |
| `429` | `RATE_LIMIT_EXCEEDED` | Global throttler tripped. |
| `500` | `INTERNAL_ERROR` | Unhandled exception inside the handler (cannot occur for this endpoint — handlers are constant returns). |

Body invariants asserted by the e2e suite under the
`'403 response body contains no stack trace or internal exception class names'`
test (`test/admin.e2e-spec.ts:160–173`):

- `body.stack` is `undefined`.
- `body.cause` is `undefined`.
- `body.name` is `undefined`.
- `body.message` does not contain the substrings `Exception`,
  `ForbiddenException`, or `RolesGuard`.

---

## 7. Side effects

| Event | When |
|---|---|
| One structured `AdminAudit` log line | On `POST` only. Contains `userId`, `userEmail`, `roles`, `action`, `route`, `method`, `timestamp`, `ip`, `userAgent`, `outcome: 'success'` (and `statusCode` on the error path). See [audit-log-interceptor.md §4](./audit-log-interceptor.md). |
| **No** log line | On `GET`. The interceptor's method gate excludes `GET`/`HEAD`/`OPTIONS`. |
| **No** DB writes | Handlers return constants; no Prisma calls. |
| **No** outbound network calls | Handlers return constants. |

The audit log line is the only observable side effect of the endpoint.

---

## 8. Files involved

| File | Role |
|---|---|
| `src/admin/controllers/admin-health.controller.ts` | The `ping()` and `postPing()` handlers. |
| `src/admin/admin.module.ts` | Registers `AdminHealthController` in `controllers[]`; exports `RolesGuard` and `AuditLogInterceptor` so the composite decorator can resolve them. |
| `src/admin/common/decorators/admin-endpoint.decorator.ts` | `@AdminEndpoint()` — bundles `JwtAuthGuard`, `RolesGuard`, `AuditLogInterceptor`, `@Roles(Role.ADMIN)`. |
| `src/common/guards/roles.guard.ts` | The `403` / `401` decision logic surfaced in §6. |
| `src/admin/interceptors/audit-log.interceptor.ts` | Emits the audit line on `POST`. |
| `src/auth/guards/jwt-auth.guard.ts` | Global authentication; the source of `401`. |
| `src/common/interceptors/response-transform.interceptor.ts` | Produces the `{ data, message }` wrapping. |
| `src/common/filters/http-exception.filter.ts` | Produces every error body shown in §6. |
| `src/common/error-codes.enum.ts` | `INSUFFICIENT_ROLE`, `UNAUTHORIZED`, `RATE_LIMIT_EXCEEDED`, `INTERNAL_ERROR`. |

---

## 9. Tests

| File | Covers |
|---|---|
| `test/admin.e2e-spec.ts` | Nine scenarios across four `describe` blocks: admin happy path on `GET` (US1, line 130); learner `403` with `INSUFFICIENT_ROLE` and clean error body (US2, lines 146–173); anonymous / malformed-bearer / expired `401` (US3, lines 180–222); `POST` emits one structured audit entry with the matched route pattern, `GET` emits zero, and `POST` still succeeds when `Logger.log` is forced to throw (US5, lines 254–314). |

---

## 10. Things NOT to change without coordination

- **The `@AdminEndpoint()` class-level decorator.** Removing or
  downgrading it (e.g. to per-method) is the single failure mode that
  silently exposes the route. The code-review checklist in
  [conventions.md §3](./conventions.md#3-code-review-checklist) calls this out as the foremost item.
- **The `POST` handler.** It exists to exercise the audit interceptor.
  Removing it loses the e2e signal that asserts `POST/PATCH/PUT/DELETE`
  emission works against a known-good route — and that signal protects
  every per-entity admin endpoint shipped after this one.
- **The constant `{ ok: true }` return.** Both verbs return the same
  literal so the e2e suite can assert exact-equality. Anything richer
  (timestamps, build SHAs, etc.) would force the test to loosen its
  assertion and weaken the contract.
- **The `__ping` slug.** The double-underscore prefix marks it as a
  test/wiring endpoint, distinct from any product `health` or `status`
  route a future admin feature might add.
- **The decorator stack inside `@AdminEndpoint()`.** Modifying it
  (e.g. adding caching, swapping guards, removing audit) changes the
  contract for every per-entity admin endpoint that uses the same
  decorator. See [admin-endpoint-decorator.md §6](./admin-endpoint-decorator.md).
