# Quickstart: Adding a New Per-Entity Admin Sub-Module

**Feature**: 014-admin-foundation
**Audience**: backend developers about to land a per-entity admin CRUD (e.g., Categories, Paths, Tags) under `/admin/<entity>`.

This is the canonical procedure. It is also the artifact that satisfies User Story 4 ("future developer adds new admin entity with zero re-wiring").

> **Estimated time**: under 30 minutes for a developer already familiar with the codebase. Target measured by SC-008.

---

## TL;DR

1. Create `src/admin/<entity>/` with `<entity>-admin.module.ts` + `<entity>-admin.controller.ts` + `<entity>-admin.service.ts`.
2. Decorate the controller class with `@Controller('admin/<entity>')` AND `@AdminEndpoint()` (the composite class-level decorator that bundles `JwtAuthGuard`, `RolesGuard`, `AuditLogInterceptor`, and `@Roles(Role.ADMIN)`).
3. Add `<Entity>AdminModule` to `AdminModule.imports`.
4. Add an e2e spec at `test/<entity>-admin.e2e-spec.ts` verifying 401 / 403 / 200.

You inherit role gating, audit logging on mutations, the platform success envelope, and the platform error shape — all from one decorator. The audit interceptor's method gate skips GET / HEAD / OPTIONS internally (FR-023), so reads do not pollute logs.

> **Why a decorator and not a module-imports cascade?** NestJS `APP_GUARD` / `APP_INTERCEPTOR` providers are always app-global regardless of which module declares them — they cannot actually be scoped to a sub-tree of the app. The `@AdminEndpoint()` decorator preserves the "import once, inherit everything" goal while matching how NestJS actually scopes guards. See `spec.md` § "Implementation correction — 2026-05-01".

---

## Step 1 — Folder layout

```text
src/admin/categories/
├── categories-admin.module.ts
├── categories-admin.controller.ts
├── categories-admin.service.ts
└── dto/
    ├── create-category.dto.ts
    └── update-category.dto.ts
```

(For a sub-module that mutates `sortOrder`, e.g. Sections, also `import { ReorderItemsDto } from 'src/admin/common/dto/reorder-items.dto';` instead of redefining it.)

## Step 2 — Controller

```ts
// src/admin/categories/categories-admin.controller.ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AdminEndpoint } from 'src/admin/common/decorators/admin-endpoint.decorator';
import { CategoriesAdminService } from './categories-admin.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('admin/categories')
@AdminEndpoint()
export class CategoriesAdminController {
  constructor(private readonly service: CategoriesAdminService) {}

  @Get()       list()                                         { return this.service.list(); }
  @Get(':id')  get(@Param('id', ParseUUIDPipe) id: string)    { return this.service.get(id); }
  @Post()      create(@Body() dto: CreateCategoryDto)         { return this.service.create(dto); }
  @Patch(':id')update(@Param('id', ParseUUIDPipe) id: string,
                      @Body() dto: UpdateCategoryDto)         { return this.service.update(id, dto); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.service.remove(id); }
}
```

**Mandatory** — both decorators on the controller class:

- `@Controller('admin/categories')` — route prefix MUST start with `admin/`.
- `@AdminEndpoint()` — composite class-level decorator that applies `JwtAuthGuard`, `RolesGuard`, `AuditLogInterceptor`, and `@Roles(Role.ADMIN)` in one shot. Forgetting this decorator silently exposes the route to anyone — code review MUST verify it is present (see `docs/admin-foundation.md` §5.2 checklist).

For telemetry-only controllers (health probes, debug pings) where audit log entries would be noise, use `@AdminEndpointNoAudit()` instead — same role gate, no interceptor.

## Step 3 — Module

```ts
// src/admin/categories/categories-admin.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CategoriesAdminController } from './categories-admin.controller';
import { CategoriesAdminService } from './categories-admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [CategoriesAdminController],
  providers: [CategoriesAdminService],
})
export class CategoriesAdminModule {}
```

Note: do NOT register `RolesGuard` or the audit interceptor here. They are exported from `AdminModule` and consumed by your controller via `@AdminEndpoint()`.

## Step 4 — Wire into `AdminModule.imports`

```ts
// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminHealthController } from './controllers/admin-health.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
import { CategoriesAdminModule } from './categories/categories-admin.module';   // ← ADD

@Module({
  imports: [
    AuthModule,
    CategoriesAdminModule,                                                       // ← ADD
    // ...other admin sub-modules
  ],
  controllers: [AdminHealthController],
  providers: [RolesGuard, AuditLogInterceptor],
  exports: [RolesGuard, AuditLogInterceptor],
})
export class AdminModule {}
```

**FORBIDDEN**: do NOT add `CategoriesAdminModule` to `AppModule.imports`. The composite `@AdminEndpoint()` decorator depends on `RolesGuard` and `AuditLogInterceptor` being exported from `AdminModule`; sub-modules MUST be children of `AdminModule` so DI resolves them.

## Step 5 — Service

Standard NestJS service. Uses `PrismaService` directly. Cache invalidation, transactions, etc. follow the existing project patterns (see `src/content/courses/courses.service.ts` for reference).

## Step 6 — DTOs

Each sub-module owns its DTOs (per Constitution Principle I). Use `class-validator` decorators. For bulk reorder operations, import `ReorderItemsDto` from `src/admin/common/dto/reorder-items.dto`:

```ts
import { ReorderItemsDto } from 'src/admin/common/dto/reorder-items.dto';

@Patch('reorder')
reorder(@Body() dto: ReorderItemsDto) { return this.service.reorder(dto.items); }
```

## Step 7 — E2E spec

```ts
// test/categories-admin.e2e-spec.ts
describe('Categories Admin (e2e)', () => {
  it('GET /api/v1/admin/categories returns 401 without JWT', async () => { /* ... */ });
  it('GET /api/v1/admin/categories returns 403 with learner JWT', async () => { /* ... */ });
  it('GET /api/v1/admin/categories returns 200 with admin JWT', async () => { /* ... */ });
  it('POST /api/v1/admin/categories emits one audit log entry', async () => { /* spy on Logger */ });
});
```

(Mirror `test/admin.e2e-spec.ts` from this feature for the foundation tests; layer entity-specific tests on top.)

---

## What you do NOT need to do

| Concern | Where it lives | Why |
|---|---|---|
| Apply `RolesGuard` per controller | Bundled in `@AdminEndpoint()` | Single composite decorator at the class level. |
| Apply audit interceptor per controller | Bundled in `@AdminEndpoint()` | Same. |
| Apply `@Roles(Role.ADMIN)` per controller | Bundled in `@AdminEndpoint()` | Same. |
| Wrap responses as `{ data, message }` | Global `ResponseTransformInterceptor` | Already runs for every endpoint in the API. |
| Format errors as `{ statusCode, errorCode, message, errors? }` | Global `HttpExceptionFilter` | Already runs for every endpoint. |
| Apply `JwtAuthGuard` | Global `APP_GUARD` in `AppModule` (also re-applied by `@AdminEndpoint()` for explicitness; idempotent) | Already runs for every non-`@Public()` endpoint. |
| Manage trust-proxy / IP extraction for audit log | Express + `req.ip` | Existing wiring. |
| Scrub UUIDs out of audit `route` field | Express `req.route.path` | Already gives the matched pattern. |

If you find yourself writing any of the above inside a per-entity admin module, stop and re-read this doc — you are duplicating foundation work.

---

## Validating your wiring

After adding your sub-module, you can sanity-check end-to-end with the existing test admin route:

```bash
# 401 — no token
curl -i http://localhost:3001/api/v1/admin/__ping

# 403 — learner JWT
curl -i -H "Cookie: access_token=<learner JWT>" http://localhost:3001/api/v1/admin/__ping

# 200 — admin JWT
curl -i -H "Cookie: access_token=<admin JWT>" http://localhost:3001/api/v1/admin/__ping
# → {"data":{"ok":true},"message":"Success"}
```

If your new sub-module's routes behave the same way (401/403/200), you're wired correctly. If a route returns 200 to a learner JWT, you skipped Step 4 — `AdminModule.imports` registration.

---

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Imported sub-module into `AppModule.imports` instead of `AdminModule.imports`. | Sub-module loses access to `RolesGuard` / `AuditLogInterceptor` providers exported by `AdminModule`; `@AdminEndpoint()` fails DI resolution at boot. | Move the import. |
| Used `@Controller('categories')` instead of `@Controller('admin/categories')`. | Endpoint reachable at the wrong URL; collides with public `/categories` if it exists. | Add the `admin/` prefix. |
| Re-implemented `ReorderItemsDto` instead of importing from `src/admin/common/dto/`. | Lint duplication; drift over time. | Replace with the shared import. |
| Forgot `@AdminEndpoint()` on the controller. | **The route is exposed without authorization.** Anyone with or without a JWT can call it. | Add `@AdminEndpoint()` at the class level. The code-review checklist in `docs/admin-foundation.md` §5.2 catches this. |
| Used lowercase string literal `@Roles('admin')`. | 403 for legitimate admins because the JWT `roles` array carries uppercase `'ADMIN'` (Prisma enum value). | Use `@AdminEndpoint()` (which always uses `Role.ADMIN`). |
| Applied `@AdminEndpoint()` at the method level instead of the class level. | Other methods on the same controller are unprotected. | Apply at the class level so every handler is covered. |
