# AuditLogInterceptor — Backend Reference (awamer-api)

> **Class:** `AuditLogInterceptor`
> **Source:** `src/admin/interceptors/audit-log.interceptor.ts`
> **Applied via:** `@AdminEndpoint()` — see [admin-endpoint-decorator.md](./admin-endpoint-decorator.md). NOT applied by `@AdminEndpointNoAudit()`.
> **Logger context:** `AdminAudit`

`AuditLogInterceptor` emits exactly one structured log line per
admin **mutation** request (POST/PATCH/PUT/DELETE) and zero lines per
read. It is the foundation's audit trail — every per-entity admin
endpoint that uses `@AdminEndpoint()` produces this log automatically.

---

## 1. Summary

The interceptor reads metadata up front (user, route pattern, method,
ip, userAgent), then subscribes to `next.handle()` with an RxJS pipeline
that calls `Logger.log` from inside `tap.next` on success or
`catchError` on failure. The log call is wrapped in a `try/catch` so a
broken logger transport cannot fail the request.

The log shape is fixed (see §4) and field-stable: every entry contains
the same set of keys whether the request succeeds or errors. Database
persistence is **out of scope** for this feature; the application
logger is the only sink.

---

## 2. `intercept(context, next)`

Source: `src/admin/interceptors/audit-log.interceptor.ts:67–87`.

1. **Read the request.**
   ```ts
   const req = context.switchToHttp().getRequest<AdminRequest>();
   ```
   `AdminRequest` is the project-local type for the fields the
   interceptor cares about: `method`, `route?: { path: string }`,
   `user?: { userId, email, roles }`, `ip`, `headers['user-agent']`.
2. **Method + route gate.**
   ```ts
   if (!MUTATING_METHODS.has(req.method) || !req.route?.path) {
     return next.handle();
   }
   ```
   Where `MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])`
   (line 12). Both conditions must hold for emission to happen:
   - The method is in the mutating set. `GET`/`HEAD`/`OPTIONS` short-circuit.
   - `req.route.path` is defined. This is set by Express only after the
     router has matched the request — so a 404-before-match would skip
     emission cleanly.
3. **Build the metadata.**
   ```ts
   const meta = this.buildMetadata(req);
   ```
   `buildMetadata` (lines 89–105) constructs a `AdminAuditMetadata`
   record with the eight required fields. See §4.
4. **Subscribe with both outcome handlers.**
   ```ts
   return next.handle().pipe(
     tap({
       next: () => this.safelyLog({ ...meta, outcome: 'success' }),
     }),
     catchError((err) => {
       const statusCode =
         err instanceof HttpException ? err.getStatus() : undefined;
       this.safelyLog({ ...meta, outcome: 'error', statusCode });
       return throwError(() => err);
     }),
   );
   ```
   - On success (`tap.next`): emit one entry with `outcome: 'success'`.
     The handler's return value is not modified.
   - On error (`catchError`): emit one entry with `outcome: 'error'`
     and `statusCode` extracted from the thrown `HttpException`
     (omitted for non-HTTP errors), then **re-throw** the original
     error via `throwError(() => err)` so the global
     `HttpExceptionFilter` formats the response normally.
5. **Failure isolation.**
   ```ts
   private safelyLog(entry: AdminAuditEntry): void {
     try { this.logger.log(entry); }
     catch { /* never propagate logger failures */ }
   }
   ```
   The `try/catch` inside `safelyLog` (lines 107–113) is the line that
   satisfies "logger throw must not break the request" (FR-024).
   Asserted by the `'POST mutation succeeds even when the audit logger
   throws synthetically'` test in `test/admin.e2e-spec.ts:300–314`.

---

## 3. Method gate

The method gate is the single switch that distinguishes "audited" from
"silent" routes. It lives in **the interceptor itself**, not in the
caller — so a controller that applies `@AdminEndpoint()` at the class
level can include both `@Get()` and `@Post()` handlers without the
read handlers polluting logs.

| HTTP method | Gate | Why |
|---|---|---|
| `POST` | ✅ logged | Resource creation. Must be auditable. |
| `PATCH` | ✅ logged | Resource mutation. Must be auditable. |
| `PUT` | ✅ logged | Defensive — admin endpoints should not use `PUT`, but excluding it would silently lose audit on a future PUT-using sub-module. The cost of including it is zero for endpoints that never receive `PUT`. |
| `DELETE` | ✅ logged | Resource removal. Must be auditable. |
| `GET` | 🚫 skipped | Reads are noise in an audit trail. |
| `HEAD` | 🚫 skipped | Same as `GET`. |
| `OPTIONS` | 🚫 skipped | CORS preflight; never product traffic. |

The `MUTATING_METHODS` set is hard-coded at line 12 of the source.
Asserted by `AUDIT-T01` (POST emits) and `AUDIT-T02` (GET silent) in
`src/admin/interceptors/audit-log.interceptor.spec.ts`.

---

## 4. Log entry shape

Every entry is a single object passed to `Logger.log(...)` under the
context `'AdminAudit'`. The shape is the union of `AdminAuditMetadata`
(common to all entries) and the outcome-specific fields.

```ts
interface AdminAuditMetadata {
  userId: string;
  userEmail: string;
  roles: string[];
  action: string;
  route: string;
  method: string;
  timestamp: string;
  ip: string;
  userAgent?: string;
}

interface AdminAuditEntry extends AdminAuditMetadata {
  outcome: 'success' | 'error';
  statusCode?: number;  // present on error entries only when thrown is HttpException
}
```

| Field | Source | Notes |
|---|---|---|
| `userId` | `req.user.userId ?? ''` | UUID — set by `JwtStrategy.validate`. Empty string is the defensive fallback when `req.user` is absent (should not happen in admin scope; `JwtAuthGuard` runs first). |
| `userEmail` | `req.user.email ?? ''` | Same fallback pattern. |
| `roles` | `req.user.roles ?? []` | Array of uppercase Prisma `Role` enum values — typically `['ADMIN']`. See [conventions.md §1](./conventions.md#1-role-string-conventions). |
| `action` | `${req.method} ${req.route.path}` | E.g. `"POST /api/v1/admin/categories"`. The matched **pattern**, never the raw URL. |
| `route` | `req.route.path` | E.g. `/api/v1/admin/users/:id`. Includes the `setGlobalPrefix('api/v1')` portion (NestJS folds the prefix into the matched pattern). Parameter values (`:id`, `:slug`) are **not** substituted. |
| `method` | `req.method` | One of `POST`, `PATCH`, `PUT`, `DELETE`. |
| `timestamp` | `new Date().toISOString()` | UTC ISO 8601, e.g. `2026-05-02T12:34:56.789Z`. |
| `ip` | `req.ip ?? ''` | Best-effort. Express resolves this from the connection or trusted proxy headers. |
| `userAgent` | `req.headers['user-agent']` | Optional — may be undefined. If the header arrives as an array (rare), `buildMetadata` picks the first element (line 92). |
| `outcome` | RxJS pipeline branch | `'success'` from `tap.next`, `'error'` from `catchError`. |
| `statusCode` | `err.getStatus()` when `err instanceof HttpException` | Present **only** on error entries, **only** for HTTP exceptions. Non-HTTP errors (e.g. unhandled `TypeError`) emit an error entry without this field. |

### Example success entry

```json
{
  "userId": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f",
  "userEmail": "ops@awamer.com",
  "roles": ["ADMIN"],
  "action": "POST /api/v1/admin/categories",
  "route": "/api/v1/admin/categories",
  "method": "POST",
  "timestamp": "2026-05-02T12:34:56.789Z",
  "ip": "10.0.0.42",
  "userAgent": "Mozilla/5.0 ...",
  "outcome": "success"
}
```

### Example error entry

```json
{
  "userId": "0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f",
  "userEmail": "ops@awamer.com",
  "roles": ["ADMIN"],
  "action": "DELETE /api/v1/admin/users/:id",
  "route": "/api/v1/admin/users/:id",
  "method": "DELETE",
  "timestamp": "2026-05-02T12:35:01.123Z",
  "ip": "10.0.0.42",
  "userAgent": "Mozilla/5.0 ...",
  "outcome": "error",
  "statusCode": 404
}
```

### Forbidden fields

The entry MUST NOT include any of:

- The request body (admin endpoints carry sensitive payloads).
- Request headers other than `User-Agent`.
- The response body.
- Internal exception class names or stack traces.
- Database identifiers other than `userId`.

These exclusions are enforced by virtue of the interceptor only ever
reading the fields listed above. There is no allow-listing or
serialization step that could leak more.

---

## 5. Error handling — RxJS `tap` + `catchError`

The `intercept` pipeline (lines 76–86) is intentionally laid out so that:

- A handler returning normally lands in `tap.next` → one success entry,
  the response value flows through unchanged to the
  `ResponseTransformInterceptor`.
- A handler throwing (or any guard / interceptor downstream of this one
  throwing) lands in `catchError` → one error entry, then the original
  error is re-thrown via `throwError(() => err)`. The global
  `HttpExceptionFilter` formats the response normally; the audit entry
  is the only side effect of running through this interceptor on the
  error path.
- A logger transport throwing is swallowed by `safelyLog` →
  the request response is unaffected. This is the property
  `test/admin.e2e-spec.ts:300–314` asserts by mocking `Logger.log`
  to throw and confirming the `POST` still returns
  `201 + { data: { ok: true }, message: 'Success' }`.

The error path emits **before** re-throwing, so the order in the logs
is: audit-error-entry, then (downstream of the filter) any error log
the filter emits at its own level. There is no double-logging by this
interceptor — exactly one entry per request.

---

## 6. Side effects

| Event | When |
|---|---|
| One `Logger.log(entry)` call under context `'AdminAudit'` | On every mutation request that reaches the interceptor. |
| **No** DB writes | Persistence is explicitly out of scope for this feature. |
| **No** outbound network calls | The Nest `Logger` writes to the configured transports only. |
| **No** modification to the response | The interceptor uses `tap` (observe, do not transform) and `catchError` that re-throws (observe, do not swallow). |

Persistence to a dedicated `audit_log` table is tracked as a follow-up
feature. When it lands, the new persistence will sit alongside the
logger emission, not replace it.

---

## 7. Files involved

| File | Role |
|---|---|
| `src/admin/interceptors/audit-log.interceptor.ts` | The interceptor implementation. |
| `src/admin/common/decorators/admin-endpoint.decorator.ts` | Mounts the interceptor via `@UseInterceptors(AuditLogInterceptor)` inside `@AdminEndpoint()` only. |
| `src/admin/admin.module.ts` | Provides + exports the interceptor as a regular DI provider for `AdminModule`'s own controllers (e.g. `AdminHealthController`). Per-entity sub-modules registered under `AdminModule.imports` should register `AuditLogInterceptor` locally in their own `providers` as a defensive convention — keeps each sub-module self-contained and removes implicit reliance on NestJS's permissive injector resolution. `CategoriesAdminModule` (KAN-82) established this pattern. See `specs/015-categories-admin-crud/research.md` Decision 6 and [conventions.md §2.3](./conventions.md#23-module). |
| `src/auth/strategies/jwt.strategy.ts` | Populates `req.user.userId`, `req.user.email`, `req.user.roles` upstream. |

---

## 8. Tests

| File | Covers |
|---|---|
| `src/admin/interceptors/audit-log.interceptor.spec.ts` | Six unit cases: `AUDIT-T01` (POST → one entry, all fields, no `statusCode`), `AUDIT-T02` (GET → no entry), `AUDIT-T03` (parameterized DELETE on error → matched pattern, no UUIDs in `route`, `statusCode: 404`), `AUDIT-T04` (logger throw swallowed, response intact), `AUDIT-T05` (`req.route` undefined → no entry), `AUDIT-T06` (PUT included in method gate). |
| `test/admin.e2e-spec.ts` | Three end-to-end scenarios (`audit log (US5)` block, lines 254–314): POST emits one structured entry with the matched route pattern, GET emits zero entries, and a synthetic `Logger.log` throw still returns the normal response. |

---

## 9. Things NOT to change without coordination

- **The `MUTATING_METHODS` set.** Adding more methods (e.g. `OPTIONS`)
  pollutes logs with non-mutations; removing methods (e.g. `PUT`)
  silently drops audit on the future PUT-using sub-module that the
  set currently covers defensively.
- **The route gate (`!req.route?.path` short-circuit).** Removing it
  would let requests that 404 before route resolution emit entries
  with `route === undefined`, which corrupts dashboards and breaks
  log queries that select on the field.
- **`tap` + `catchError` (not `tap` + `tap.error` only).** `catchError`
  is what re-throws via `throwError(() => err)` so the global filter
  sees the original error. Using only `tap.error` would observe but
  not propagate, breaking the response.
- **`safelyLog`'s `try/catch`.** Removing it makes the request fail
  whenever the logger transport blips. The whole audit-log feature is
  best-effort by design.
- **The set of fields on `AdminAuditMetadata`.** Adding fields
  invalidates downstream log-aggregation rules; removing fields
  invalidates investigations that depend on them. Either change
  warrants explicit coordination with whoever owns the audit
  pipeline.
- **The logger context `'AdminAudit'`.** Filters and dashboards in
  any future log aggregator will key on this exact string.
- **The interceptor's exclusion from `@AdminEndpointNoAudit()`.**
  That variant exists to keep telemetry endpoints out of the audit
  log; adding the interceptor back would defeat its purpose.
- **Persistence is out of scope.** Adding a Prisma write inline here
  would change the side-effect surface from "logger only" to "logger
  plus DB", which would in turn require a transaction story and an
  error model the current `safelyLog` does not have. Persistence is
  a separate feature.
