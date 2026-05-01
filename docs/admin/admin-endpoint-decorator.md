# `@AdminEndpoint()` — Backend Reference (awamer-api)

> **Decorators:** `AdminEndpoint`, `AdminEndpointNoAudit`
> **Source:** `src/admin/common/decorators/admin-endpoint.decorator.ts`
> **Applied at:** the controller class level, on every controller mounted under `AdminModule`

`@AdminEndpoint()` is the single decorator every per-entity admin
controller (Categories, Paths, Courses, Sections, Lessons, Content
Blocks, Users, …) applies. It bundles four cross-cutting concerns into
one annotation so the foundation cannot be partially adopted, and so
forgetting any one piece is impossible without forgetting the whole
decorator (which the code-review checklist catches — see
[conventions.md §3](./conventions.md#3-code-review-checklist)).

---

## 1. Summary

`@AdminEndpoint()` is a `applyDecorators(...)` composite. It applies, in
order, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@UseInterceptors(AuditLogInterceptor)`,
and `@Roles(Role.ADMIN)`. The variant `@AdminEndpointNoAudit()` drops the
interceptor and is reserved for telemetry / health-check controllers
(e.g. a future `/admin/version` probe).

The composite is the contract. Per-entity controllers do not import
`JwtAuthGuard`, `RolesGuard`, `AuditLogInterceptor`, or
`@Roles(Role.ADMIN)` directly — they import `@AdminEndpoint()` only.
This is intentional: the canonical admin behavior lives in one symbol
that the code-review checklist can search for, and every change to that
behavior is a single file edit.

> **Why a decorator and not `APP_GUARD` / `APP_INTERCEPTOR` providers?**
> The original spec (KAN-78) proposed registering `RolesGuard` and
> `AuditLogInterceptor` as `APP_GUARD` / `APP_INTERCEPTOR` providers
> inside `AdminModule.providers`, expecting the providers to be scoped
> to that module. NestJS does not work that way: `APP_*` tokens are
> always app-global regardless of which module declares them. The
> regression e2e suite proved this — every non-admin endpoint started
> returning `403` because the "admin-scoped" guard was firing
> everywhere. The composite decorator is the resolution: activation
> is opt-in per controller, the foundation primitives stay regular
> exported providers, and the "import once, inherit everything"
> developer-experience goal is preserved at the decorator level
> instead of the module level. See `specs/014-admin-foundation/spec.md`
> § "Implementation correction — 2026-05-01".

---

## 2. What it bundles

Source: `src/admin/common/decorators/admin-endpoint.decorator.ts`
(lines 30–35 for `AdminEndpoint`, lines 47–48 for `AdminEndpointNoAudit`).

```ts
export const AdminEndpoint = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard, RolesGuard),
    UseInterceptors(AuditLogInterceptor),
    Roles(Role.ADMIN),
  );

export const AdminEndpointNoAudit = () =>
  applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), Roles(Role.ADMIN));
```

| Concern | Implemented by | Documented at |
|---|---|---|
| Authentication | `JwtAuthGuard` (route-level — global guard already runs first; this one is idempotent and makes the contract self-contained at the call site) | `src/auth/guards/jwt-auth.guard.ts` |
| Authorization | `RolesGuard` reads the metadata set by the bundled `@Roles(Role.ADMIN)` and intersects with `req.user.roles` | [roles-guard.md](./roles-guard.md) |
| Audit logging | `AuditLogInterceptor` emits one structured log line per mutation; skips reads via its method gate | [audit-log-interceptor.md](./audit-log-interceptor.md) |
| Required-role metadata | `@Roles(Role.ADMIN)` — uppercase per the role-string convention | [conventions.md §1](./conventions.md#1-role-string-conventions), and `src/common/decorators/roles.decorator.ts` |

---

## 3. When to use which

| Decorator | Use when |
|---|---|
| `@AdminEndpoint()` | **Default for all admin controllers.** Read or write, simple or complex — every product-facing admin route uses this. The audit interceptor is method-gated to mutations (POST/PATCH/PUT/DELETE), so applying the decorator at the class level is safe even on read-only controllers; reads simply skip the emission. |
| `@AdminEndpointNoAudit()` | **Telemetry only.** Reserved for routes whose audit lines would be pure noise — e.g. health checks, version probes, debug introspection. Exclude `/admin/__ping` from this list deliberately: the project's foundation smoke test uses `@AdminEndpoint()` (with audit) on its `POST` so the audit interceptor itself is exercised against a known route. |

The default-when-in-doubt is `@AdminEndpoint()`. The interceptor is
cheap (a single `set.has(req.method)` check + a possible `Logger.log`
call); the cost of forgetting audit on a write is much higher.

---

## 4. Activation order

NestJS runs guards before interceptors, and global registrations before
route-level ones. Combined with the global `JwtAuthGuard` /
`ThrottlerGuard` already registered in `AppModule` and the global
`ResponseTransformInterceptor` / `HttpExceptionFilter`, the full chain
on a hypothetical `POST /api/v1/admin/categories` is:

```
1. JwtAuthGuard           (global APP_GUARD)        → 401 if no/invalid JWT;
                                                      sets req.user
2. ThrottlerGuard         (global APP_GUARD)        → 429 if rate-limited
3. JwtAuthGuard           (route-level via @AdminEndpoint, idempotent)
4. RolesGuard             (route-level via @AdminEndpoint)
                                                    → 403 INSUFFICIENT_ROLE
                                                      if req.user.roles
                                                      lacks 'ADMIN'
5. ValidationPipe         (global)                  → 422/400 if DTO invalid
6. ResponseTransformInterceptor (global, before)    → no-op pre-handler
7. AuditLogInterceptor    (route-level, before)     → captures req.user, route,
                                                      method, ip, userAgent
8. handler executes
9. AuditLogInterceptor    (route-level, after)      → emits one structured log
                                                      line via tap/catchError
10. ResponseTransformInterceptor (global, after)    → wraps as
                                                      { data, message: 'Success' }
11. HttpExceptionFilter   (global APP_FILTER)       → on error, formats as
                                                      { statusCode, errorCode,
                                                        message, errors? }
```

Step 7's "captures" is implicit: `AuditLogInterceptor.intercept()` reads
the request fields up front via `buildMetadata` (lines 89–105 of
`src/admin/interceptors/audit-log.interceptor.ts`) before `next.handle()`
is subscribed. The actual log line is emitted in step 9 from inside the
RxJS `tap`/`catchError` so both the success and the error outcomes are
recorded.

The route-level `JwtAuthGuard` in step 3 fires after the global one in
step 1. Re-running it is idempotent — `req.user` is already populated;
the second pass walks the same Passport flow and arrives at the same
result. The redundancy is intentional: the composite decorator is
self-contained, so a reader looking at a controller can verify it is
admin-protected without checking what `AppModule` happens to register.

---

## 5. Files involved

| File | Role |
|---|---|
| `src/admin/common/decorators/admin-endpoint.decorator.ts` | The composite definition — `AdminEndpoint`, `AdminEndpointNoAudit`. |
| `src/auth/guards/jwt-auth.guard.ts` | The authentication guard wrapped by both variants. |
| `src/common/guards/roles.guard.ts` | The authorization guard wrapped by both variants. See [roles-guard.md](./roles-guard.md). |
| `src/admin/interceptors/audit-log.interceptor.ts` | The interceptor wrapped by `@AdminEndpoint()` only. See [audit-log-interceptor.md](./audit-log-interceptor.md). |
| `src/common/decorators/roles.decorator.ts` | `@Roles(...)` — produces the `ROLES_KEY` metadata that `RolesGuard` reads. |
| `src/admin/common/constants/roles.const.ts` | Re-exports `Role` from `@prisma/client` so admin code never types role strings as literals. See [conventions.md §1](./conventions.md#1-role-string-conventions). |
| `src/admin/admin.module.ts` | Exports `RolesGuard` and `AuditLogInterceptor` so per-entity sub-modules can resolve them via DI. |

---

## 6. Things NOT to change without coordination

- **The decorator's wrapped set.** Adding/removing a guard or
  interceptor here changes the contract for **every** admin endpoint
  in the codebase. Any change must be paired with an updated review of
  every admin controller plus an e2e regression run.
- **Class-level application.** Applying `@AdminEndpoint()` per-method
  instead of at the class level is the most common silent-exposure
  failure mode (sibling methods inherit nothing). The code-review
  checklist in [conventions.md §3](./conventions.md#3-code-review-checklist) requires class-level usage.
- **The order of decorators inside `applyDecorators(...)`.**
  `@UseGuards(JwtAuthGuard, RolesGuard)` is two args in one call so the
  guards run in order; splitting them across calls or reordering could
  change which guard surfaces the error first (e.g. a non-authenticated
  request would hit `RolesGuard`'s `!user` branch and surface `401`
  via that path instead of the cleaner `JwtAuthGuard` 401).
- **`@AdminEndpointNoAudit()` exists for a reason — keep its surface
  area small.** Adding it to a product controller is almost always
  wrong. Use `@AdminEndpoint()` and let the method gate skip emission
  on reads.
- **Do not register `AuditLogInterceptor` or `RolesGuard` as
  `APP_GUARD` / `APP_INTERCEPTOR` providers anywhere.** The composite
  decorator is the only canonical activation site. See the rationale
  block in §1.
