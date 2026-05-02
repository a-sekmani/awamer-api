# Admin Conventions — Backend Reference (awamer-api)

> **Audience:** any developer or AI agent adding a new per-entity admin
> sub-module (Categories, Paths, Courses, Sections, Lessons, Content
> Blocks, Users, Tags, …)
> **Companion files:** [README.md](./README.md), [admin-endpoint-decorator.md](./admin-endpoint-decorator.md), [roles-guard.md](./roles-guard.md), [audit-log-interceptor.md](./audit-log-interceptor.md), [reorder-items-dto.md](./reorder-items-dto.md)

This document captures the cross-cutting conventions every admin
sub-module follows. The per-primitive reference docs (linked above)
describe **what** each foundation piece does; this doc describes
**how** to add a new sub-module on top of those pieces, the role-string
casing rule that applies everywhere, and the review checks that catch
the most common authoring mistakes.

---

## 1. Role string conventions

**Rule:** all admin code uses the Prisma `Role` enum's TypeScript
values (uppercase: `ADMIN`, `LEARNER`). Never type the strings as
literals.

### 1.1 Why uppercase

The Prisma schema declares the enum with uppercase TypeScript names
and `@map(...)` to lowercase database values:

```prisma
enum Role {
  LEARNER @map("learner")
  ADMIN   @map("admin")
}
```

The TypeScript-side value Prisma returns is `'LEARNER' | 'ADMIN'`.
That is what `auth.service.ts` writes into the JWT payload's `roles`
array (`src/auth/auth.service.ts` `generateTokens()`), and that is what
`req.user.roles` carries everywhere downstream including `RolesGuard`.
The DB column stays lowercase via `@map`, but no admin code touches
that representation.

### 1.2 Always import the `Role` enum

For consistency, import the enum rather than typing string literals:

```ts
// Re-export inside admin scope:
import { Role } from 'src/admin/common/constants/roles.const';
// or directly from Prisma:
import { Role } from '@prisma/client';
```

The `Role` re-export at `src/admin/common/constants/roles.const.ts`
(lines 16–17) exists only to give admin sub-modules a project-local
import path so a move of the Prisma client (rare, but possible) is a
one-line refactor.

### 1.3 Correct vs incorrect

✅ Correct:

```ts
@Controller('admin/categories')
@AdminEndpoint()                              // bundles @Roles(Role.ADMIN)
export class CategoriesAdminController { … }
```

✅ Correct (multi-role override on a single handler):

```ts
@Get('drafts')
@Roles(Role.ADMIN, 'EDITOR')                  // any-of; EDITOR is a future role
draftsList() { … }
```

❌ Incorrect — case mismatch silently produces 403 for legitimate admins:

```ts
@Roles('admin')                               // 'admin' never matches 'ADMIN' in JWT
@Roles('Admin')                               // mixed case never matches
```

❌ Incorrect — typed string literal drifts from the enum:

```ts
@Roles('ADMIN')                               // works today; if Role values ever
                                              // change the literal will not follow
```

### 1.4 Comparing roles inside services

If service-layer code needs to inspect roles directly (rare — most
checks belong in the guard), use the same enum:

```ts
import { Role } from '@prisma/client';

if (req.user.roles.includes(Role.ADMIN)) { … }
```

---

## 2. Sub-module registration walkthrough

The canonical procedure for adding a new admin entity. Follow it
top-to-bottom; the order is what makes the foundation cascade work.

### 2.1 Folder layout

```
src/admin/<entity>/
├── <entity>-admin.module.ts
├── <entity>-admin.controller.ts
├── <entity>-admin.service.ts
└── dto/
    ├── create-<entity>.dto.ts
    └── update-<entity>.dto.ts
```

Tests:

```
test/<entity>-admin.e2e-spec.ts
```

### 2.2 Controller

```ts
// src/admin/<entity>/<entity>-admin.controller.ts
import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { AdminEndpoint } from 'src/admin/common/decorators/admin-endpoint.decorator';
import { <Entity>AdminService } from './<entity>-admin.service';
import { Create<Entity>Dto } from './dto/create-<entity>.dto';
import { Update<Entity>Dto } from './dto/update-<entity>.dto';

@Controller('admin/<entities>')
@AdminEndpoint()                                  // ← the foundation contract
export class <Entity>AdminController {
  constructor(private readonly service: <Entity>AdminService) {}

  @Get()           list()                                          { return this.service.list(); }
  @Get(':id')      get(@Param('id', ParseUUIDPipe) id: string)     { return this.service.get(id); }
  @Post()          create(@Body() dto: Create<Entity>Dto)          { return this.service.create(dto); }
  @Patch(':id')    update(@Param('id', ParseUUIDPipe) id: string,
                          @Body() dto: Update<Entity>Dto)          { return this.service.update(id, dto); }
  @Delete(':id')   remove(@Param('id', ParseUUIDPipe) id: string)  { return this.service.remove(id); }
}
```

Mandatory at the class level:

- `@Controller('admin/<entities>')` — the route prefix MUST start with
  `admin/`. The slug is plural and kebab-case
  (`admin/content-blocks`, not `admin/contentBlocks` and not
  `admin/contentBlock`).
- `@AdminEndpoint()` — the composite that bundles `JwtAuthGuard`,
  `RolesGuard`, `AuditLogInterceptor`, `@Roles(Role.ADMIN)`. Forgetting
  this decorator silently exposes the route. See §3.

For telemetry-only controllers (probes, version endpoints), use
`@AdminEndpointNoAudit()` instead — same role gate, no interceptor.
See [admin-endpoint-decorator.md §3](./admin-endpoint-decorator.md).

### 2.3 Module

```ts
// src/admin/<entity>/<entity>-admin.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { AuditLogInterceptor } from 'src/admin/interceptors/audit-log.interceptor';
import { <Entity>AdminController } from './<entity>-admin.controller';
import { <Entity>AdminService } from './<entity>-admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [<Entity>AdminController],
  providers: [
    <Entity>AdminService,
    RolesGuard,            // local registration — defensive convention.
    AuditLogInterceptor,   // Keeps the sub-module self-contained;
                           // see specs/015-categories-admin-crud/research.md Decision 6.
  ],
})
export class <Entity>AdminModule {}
```

Register `RolesGuard` and `AuditLogInterceptor` locally in the
sub-module's `providers` array as a defensive convention. This keeps
sub-modules self-contained and removes implicit reliance on NestJS's
permissive injector resolution — which currently does find these
classes through their framework-global dependencies (`Reflector`,
`Logger`), but should not be relied upon as a contract.
`CategoriesAdminModule` (shipped in KAN-82) established this pattern.
Both providers are stateless, so per-module instances cost nothing
functionally. See `specs/015-categories-admin-crud/research.md`
Decision 6 for the diagnostic history.

### 2.4 Wire into `AdminModule.imports`

```ts
// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminHealthController } from './controllers/admin-health.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
import { <Entity>AdminModule } from './<entity>/<entity>-admin.module';   // ← add

@Module({
  imports: [AuthModule, <Entity>AdminModule, /* …other admin sub-modules */ ],
  controllers: [AdminHealthController],
  providers: [RolesGuard, AuditLogInterceptor],
  exports: [RolesGuard, AuditLogInterceptor],
})
export class AdminModule {}
```

**Note on DI propagation.** Adding `<Entity>AdminModule` to
`AdminModule.imports` is the right wiring direction — the sub-module is
a child of `AdminModule`, which gives the route the correct admin scope
and makes the choke point visible to reviewers. The `providers` /
`exports` of `RolesGuard` and `AuditLogInterceptor` on `AdminModule`
above only serve `AdminModule`'s own controllers (e.g.
`AdminHealthController`). For the sub-module itself, follow
[§2.3](#23-module) and register both providers locally as a defensive
convention — the sub-module stays self-contained rather than implicitly
relying on NestJS's permissive injector resolution. See
`specs/015-categories-admin-crud/research.md` Decision 6.

**Forbidden:** importing `<Entity>AdminModule` into `AppModule.imports`
instead. Sub-modules MUST be children of `AdminModule` for the
`/admin/<entities>` route prefix to be unambiguously admin-scoped and so
that `AdminModule` is the single discoverable choke point listing every
admin sub-module in the codebase. (The local-providers pattern from
[§2.3](#23-module) is what makes the sub-module's own DI scope
self-contained either way.)

### 2.5 Service

Standard NestJS service; uses `PrismaService` directly. Follow existing
patterns for transactions and cache invalidation — see
`src/content/courses/courses.service.ts` for a reference shape.

### 2.6 DTOs

Each sub-module owns its DTOs (per Constitution Principle I — Module
Isolation). Use `class-validator` decorators on every field; the global
`ValidationPipe` (configured `whitelist: true, forbidNonWhitelisted: true,
transform: true` in `src/main.ts`) rejects unknown fields.

For bulk reorder operations, import `ReorderItemsDto` from
`src/admin/common/dto/reorder-items.dto` rather than redefining it.
See [reorder-items-dto.md](./reorder-items-dto.md).

### 2.7 E2E spec

Mirror `test/admin.e2e-spec.ts` for the foundation scenarios:

| Scenario | Expected |
|---|---|
| Anonymous request | `401`, body has no stack/cause/exception names |
| Learner JWT | `403`, `errorCode: 'INSUFFICIENT_ROLE'` |
| Admin JWT, happy path | `200/201`, `{ data: …, message: 'Success' }` |
| Admin POST/PATCH/DELETE | one structured `AdminAudit` log entry per request |
| Admin GET | zero audit entries |

Then layer entity-specific assertions on top (validation, conflict,
not-found, …).

### 2.8 Validate end-to-end

```bash
# 401 — no token
curl -i http://localhost:3001/api/v1/admin/<entities>

# 403 — learner JWT
curl -i -H "Cookie: access_token=<learner JWT>" \
  http://localhost:3001/api/v1/admin/<entities>

# 200 — admin JWT
curl -i -H "Cookie: access_token=<admin JWT>" \
  http://localhost:3001/api/v1/admin/<entities>
# → {"data":[…],"message":"Success"}
```

If your endpoint returns `200` to a learner JWT, you skipped §2.4 —
the sub-module is registered in `AppModule` instead of `AdminModule`.

---

## 3. Code-review checklist

Reviewers MUST confirm before approving any PR adding a new admin
controller:

- [ ] Controller file lives under `src/admin/<entity>/`.
- [ ] Class is decorated with `@AdminEndpoint()` (or
      `@AdminEndpointNoAudit()` for telemetry-only endpoints) at the
      **class level**, not per-method.
- [ ] Module is imported into `AdminModule.imports`, not
      `AppModule.imports`.
- [ ] Route prefix follows `/admin/<entities>` convention; slug is
      plural kebab-case.
- [ ] Role strings are uppercase via `Role.ADMIN`, never literal
      `'admin'` or `'Admin'`.
- [ ] DTOs use `class-validator` decorators on every field
      (Constitution Principle V).
- [ ] If the controller mutates `sortOrder`, it imports
      `ReorderItemsDto` from `src/admin/common/dto/reorder-items.dto`
      rather than redefining the shape.
- [ ] No file in `src/admin/**` is imported from any public /
      learner-facing module.
- [ ] E2E spec covers the four foundation scenarios listed in §2.7.
- [ ] No additional `APP_GUARD` / `APP_INTERCEPTOR` providers were
      added in the new sub-module — the composite decorator is the
      only canonical activation site.

The first two items are the foremost: forgetting the class-level
`@AdminEndpoint()` is the single failure mode that exposes the route
to anyone, and importing into the wrong module is the failure mode
that breaks DI resolution at boot. Both are catchable in review.

---

## 4. Future ESLint enhancement

A custom ESLint rule should enforce that every controller class
declared in `src/admin/**` has either `@AdminEndpoint()` or
`@AdminEndpointNoAudit()` applied at the class level. The rule
prevents the "forgot the decorator" failure mode that the
code-review checklist catches manually.

This is **tracked as a follow-up enhancement, not a blocker for
KAN-78 acceptance.** The shape of the rule:

- Trigger on any `@Controller(...)` decorator inside `src/admin/**`.
- Pass when the class also carries one of `@AdminEndpoint()` or
  `@AdminEndpointNoAudit()` directly above the class declaration.
- Fail otherwise; the auto-fix can insert `@AdminEndpoint()`
  immediately above `@Controller(...)`.

`AdminHealthController` and any future admin controllers must
satisfy the rule the same way. There is no allow-list.

Until the rule ships, the code-review checklist in §3 is the line of
defense.
