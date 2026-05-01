# Admin Endpoint Doc — Pointer Template

> **For:** future per-entity admin endpoints (Categories, Paths, Courses, Sections, Lessons, Content Blocks, Users, Tags, …)
> **Reference style:** [`docs/auth/register.md`](../auth/register.md) — the gold standard for endpoint docs in this repo.

This is a pointer, not a fillable skeleton. The right way to author a
new admin endpoint doc is to **read `register.md` end-to-end and clone
its discipline**, then apply the admin-specific differences listed
below. Maintaining a parallel skeleton here would drift from
`register.md` over time; the template tax is not worth paying.

---

## What to copy from `register.md`

The 11-section structure (in order) and the level of detail. Specifically:

1. Title — `# <Endpoint name> — Backend Spec (awamer-api)`
2. Blockquote metadata block — `Module`, `Endpoint`, `Frontend page` (if any), `Decorator`, `Status code`
3. §1 Summary — what the endpoint does, key invariants
4. §2 Request — HTTP line, body DTO table, example JSON, ValidationPipe note
5. §3 Behavior — `<ServiceClass.method>()` numbered walkthrough with source path + approximate line range
6. §4 Cookies / extra response artifacts — drop if not applicable (most admin endpoints will not set cookies)
7. §5 Rate limiting — explicit `@Throttle(...)` values + per-email/per-IP DB tracking (admin endpoints typically inherit the global default; say so explicitly)
8. §6 Successful response — full HTTP/1.1 wire format + JSON body
9. §7 Error responses — `Status | errorCode | When` table
10. §8 Side effects — `Table | Mutation` rows + outbound calls
11. §9 Downstream flow — drop if there is none (admin CRUD usually has none)
12. §10 Files involved — `File | Role` table
13. §11 Things NOT to change without coordination

Drop sections that have no content (don't pad). Keep numbering and
header text identical for the sections that remain.

---

## Admin-specific differences from `register.md`

These are the deltas that matter when documenting an admin endpoint:

### Metadata block

- `Module:` is the per-entity sub-module — e.g. `CategoriesAdminModule`,
  not `AdminModule`. The sub-module imports into `AdminModule.imports`;
  document the sub-module name.
- `Decorator:` is `@AdminEndpoint()` (or `@AdminEndpointNoAudit()` for
  telemetry). Bundles `JwtAuthGuard`, `RolesGuard`,
  `AuditLogInterceptor`, `@Roles(Role.ADMIN)`. Don't list the four
  primitives separately — list the composite.
- `Frontend page:` rarely applies. Admin endpoints feed the admin
  console, which has its own routing scheme owned by `awamer-web`.
  Drop the field unless there's a clear page-to-endpoint pairing.

### §3 Behavior

- The guard chain is consistent across every admin endpoint:
  `JwtAuthGuard` (global) → `ThrottlerGuard` (global) →
  `JwtAuthGuard` (route-level) → `RolesGuard` (route-level) →
  `ValidationPipe` → handler. Don't re-explain it; cite
  [admin-endpoint-decorator.md §4](./admin-endpoint-decorator.md) for
  the canonical activation order and only call out the parts your
  endpoint adds.
- Service-method walkthroughs follow the same line-numbered prose as
  `register.md`. Cite source lines (`src/admin/<entity>/<entity>-admin.service.ts`
  around lines `N–M`).

### §7 Error responses

- The `RolesGuard`-thrown 403 (`errorCode: INSUFFICIENT_ROLE`) is
  every admin endpoint's contribution to the table. Always include it.
- The `JwtAuthGuard`-thrown 401 has no `errorCode` (Passport's
  `UnauthorizedException` does not set one — see [ping.md §6](./ping.md)).
  Document it as `(unset)` in the `errorCode` column rather than
  inventing a code.
- `VALIDATION_FAILED` covers DTO failures including the shared
  `ReorderItemsDto` if the endpoint accepts it.

### §8 Side effects

- One structured `AdminAudit` log entry per mutation request
  (POST/PATCH/PUT/DELETE). Cite
  [audit-log-interceptor.md §4](./audit-log-interceptor.md) for the
  field shape rather than re-listing the nine fields.
- Read endpoints (GET) emit zero entries. Note this explicitly when
  the endpoint is a GET — readers should not assume.
- Cache invalidation calls (when applicable) follow the `CacheService`
  patterns in [`docs/cache/cache-service.md`](../cache/cache-service.md).

### §11 Things NOT to change without coordination

- The class-level `@AdminEndpoint()` decorator. Always include this as
  the first item — it is the foundation contract every admin endpoint
  inherits.
- Route prefix (`admin/<entities>`, plural kebab-case). Frontend
  consumers and integration tests pin on this exact path.
- DTO shape — explicit field-by-field invariants when relevant.
- Any Prisma transaction scope inside the handler.

---

## What to do before opening a PR

Run through the code-review checklist in
[conventions.md §3](./conventions.md#3-code-review-checklist). The
checklist items are also the items the doc should land — if your doc
cannot truthfully describe each item, the implementation is
incomplete.

---

## Cross-references

- The 11-section reference: [`docs/auth/register.md`](../auth/register.md).
- The simpler reference (when several sections collapse): [`docs/health/get-health.md`](../health/get-health.md).
- The shipped admin example: [`ping.md`](./ping.md). Tightest possible
  prose for the trivial sections; full discipline on §6 / §7 / §10 / §11.
- Project envelope and error rules: [`docs/api-conventions.md`](../api-conventions.md).
