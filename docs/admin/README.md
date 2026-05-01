# Admin — Index

Foundation layer for every per-entity admin endpoint. Introduced by
KAN-78. Every per-entity admin sub-module (Categories, Paths, Courses,
Sections, Lessons, Content Blocks, Users, Tags, …) sits on top of this
foundation via the composite `@AdminEndpoint()` decorator.

## Endpoint

| File | Purpose |
|------|---------|
| [ping.md](./ping.md) | `GET /api/v1/admin/__ping`, `POST /api/v1/admin/__ping` — wiring smoke test. The only endpoint shipped by KAN-78. |

## Primitives

| File | Purpose |
|------|---------|
| [admin-endpoint-decorator.md](./admin-endpoint-decorator.md) | `@AdminEndpoint()` and `@AdminEndpointNoAudit()` — composite class-level decorators that bundle `JwtAuthGuard`, `RolesGuard`, `AuditLogInterceptor`, `@Roles(Role.ADMIN)`. |
| [roles-guard.md](./roles-guard.md) | `RolesGuard` — `@Roles(...)` metadata × `req.user.roles` intersection check; `INSUFFICIENT_ROLE` / `UNAUTHORIZED` decision matrix. |
| [audit-log-interceptor.md](./audit-log-interceptor.md) | `AuditLogInterceptor` — one structured `AdminAudit` log entry per mutation; method gate, field shape, failure isolation. |
| [reorder-items-dto.md](./reorder-items-dto.md) | `ReorderItemsDto` — shared bulk reorder DTO (`{ items: [{ id, sortOrder }] }`) with the full `class-validator` matrix. |

## Conventions

| File | Purpose |
|------|---------|
| [conventions.md](./conventions.md) | Role-string conventions (uppercase Prisma `Role` enum), the sub-module registration walkthrough, the code-review checklist, and the future ESLint enhancement note. |

## Authoring new admin endpoints

| File | Purpose |
|------|---------|
| [_template.md](./_template.md) | Pointer template for new admin endpoint docs. Read [`docs/auth/register.md`](../auth/register.md) for the gold structure; this file lists the admin-specific deltas. |
