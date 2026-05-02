# Phase 1 Data Model: BE Categories admin CRUD (KAN-82)

**Feature**: 015-categories-admin-crud
**Date**: 2026-05-02
**Spec**: [spec.md](./spec.md)

## 1. Persisted Entity — `Category` (post-migration)

**Table**: `categories`
**Prisma model**: `Category`

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` (UUID v4) | `@id @default(uuid())` | Server-assigned. |
| `name` | `String` | NOT NULL, no DB-level unique constraint. App-layer unique check via `findFirst({ where: { name } })`. | Length cap (200) is DTO-layer only — column is Postgres `text`. KAN-101 will add `@unique` once test fixtures are normalized. |
| `slug` | `String` | NOT NULL, `@unique` (DB-enforced index) | Kebab-case, lowercase. |
| `order` | `Int` | NOT NULL, `@default(0)` | Admin LIST ignores this; public LIST orders by it ASC. |
| `status` | `CategoryStatus` enum | NOT NULL, `@default(ACTIVE)` | Values: `ACTIVE`, `HIDDEN`. |
| `createdAt` | `DateTime` | `@default(now())` | Admin LIST orders by this DESC. |
| `updatedAt` | `DateTime` | `@updatedAt` | Auto-managed by Prisma. |

**Dropped via this PR's migration** (were nullable, never read by any UI surface):
- `description String?`
- `icon String?`

**Relations** (post-migration):
- `paths Path[]` — referencing FK `Path.categoryId` is now `ON DELETE RESTRICT` (was `Cascade`).
- `courses Course[]` — referencing FK `Course.categoryId` keeps existing behavior (no relation action in current schema; remains as default `ON DELETE NO ACTION`). Out of scope for this ticket. The DELETE handler counts `courses` regardless of FK action because user-facing 409 messaging benefits from showing both numbers, and a category referenced by a course will block delete via the `Course.categoryId` constraint.

### Adjacent FK changes (sibling entities, scoped to this PR)

| FK | Old action | New action | Migration step |
|---|---|---|---|
| `Path.categoryId` → `Category.id` | `ON DELETE CASCADE` | `ON DELETE RESTRICT` | DROP+ADD constraint in same migration |
| `Course.pathId` → `Path.id` | `ON DELETE CASCADE` | `ON DELETE RESTRICT` | DROP+ADD constraint in same migration |

Both changes were confirmed against `prisma/schema.prisma` lines 380 and 412 before plan was drafted (see `research.md` Decision 1).

### Lifecycle

```
Category created (status=ACTIVE, order=0)
    ↓ (PATCH name | slug | order | status)
Category mutated
    ↓ (PATCH status=HIDDEN)
Category hidden from public list (still visible in admin list)
    ↓ (DELETE)
Category deleted IFF no Path / Course references exist
```

No state machine beyond `status ∈ {ACTIVE, HIDDEN}`. `HIDDEN` is reversible via PATCH back to `ACTIVE`. Soft delete is explicitly out of scope.

---

## 2. DTOs

All four DTOs live under `src/admin/categories/dto/`. None are shared with the public `CategoriesModule` (Constitution Principle I).

### 2.1 `CreateCategoryDto`

**File**: `src/admin/categories/dto/create-category.dto.ts`

```ts
export class CreateCategoryDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(200)
  @MinLength(1)
  name!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be kebab-case (lowercase letters, digits, single hyphens)',
  })
  slug!: string;
}
```

Notes:
- `order` and `status` are NOT accepted on create; they default at the column level (`order: 0`, `status: ACTIVE`).
- Whitespace-only inputs are rejected by `@MinLength(1)` after trim.

### 2.2 `UpdateCategoryDto`

**File**: `src/admin/categories/dto/update-category.dto.ts`

```ts
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(200)
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be kebab-case (lowercase letters, digits, single hyphens)',
  })
  slug?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsEnum(CategoryStatus, { message: 'status must be one of: ACTIVE, HIDDEN' })
  status?: CategoryStatus;
}
```

Notes:
- All four fields optional. PATCH performs a sparse update — undefined keys are ignored.
- `status` validated against the Prisma enum (case-sensitive, uppercase only).
- An empty body (`{}`) is allowed and is a no-op update (returns the unchanged row); this matches PATCH semantics elsewhere in the codebase.

### 2.3 `ListCategoriesQueryDto`

**File**: `src/admin/categories/dto/list-categories-query.dto.ts`

```ts
export class ListCategoriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsEnum(CategoryStatus, { message: 'status must be one of: ACTIVE, HIDDEN' })
  status?: CategoryStatus;
}
```

Notes:
- `page` defaults to 1, `limit` to 20, max 100 (matches Constitution § "Pagination defaults").
- `search` is matched case-insensitively against `name` AND `slug` via Prisma `OR + contains + mode: 'insensitive'`.
- `status` is the clarification-driven filter; absent → all statuses.

### 2.4 `CategoryAdminResponseDto`

**File**: `src/admin/categories/dto/category-admin-response.dto.ts`

```ts
export class CategoryAdminResponseDto {
  id!: string;
  name!: string;
  slug!: string;
  order!: number;
  status!: CategoryStatus;
  createdAt!: string;     // ISO 8601
  updatedAt!: string;     // ISO 8601
  pathCount!: number;
  courseCount!: number;
}
```

Notes:
- This is an admin-only shape; the public `CategoryResponseDto` (modified separately to drop `description` + `icon`) stays public-facing.
- `createdAt` and `updatedAt` are ISO strings (Prisma `Date` → `toISOString()` via NestJS default serialization).

---

## 3. Service interface (contract — types only, no impl)

**File**: `src/admin/categories/categories-admin.service.ts`

```ts
@Injectable()
export class CategoriesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateCategoryDto): Promise<CategoryAdminResponseDto>;

  async list(query: ListCategoriesQueryDto): Promise<{
    data: CategoryAdminResponseDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }>;

  async get(id: string): Promise<CategoryAdminResponseDto>;

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryAdminResponseDto>;

  async remove(id: string): Promise<{ ok: true }>;
}
```

Method-level error contract (delegates to `HttpExceptionFilter` for shape):

| Method | 400 | 404 | 409 (errorCode) | Other |
|---|---|---|---|---|
| `create` | `VALIDATION_FAILED` (DTO) | — | `CATEGORY_NAME_EXISTS` (name first) → `CATEGORY_SLUG_EXISTS` | — |
| `list` | `VALIDATION_FAILED` (query DTO) | — | — | — |
| `get` | — | `CATEGORY_NOT_FOUND` | — | — |
| `update` | `VALIDATION_FAILED` (DTO) | `CATEGORY_NOT_FOUND` | `CATEGORY_NAME_EXISTS` (name first) → `CATEGORY_SLUG_EXISTS` | — |
| `remove` | — | `CATEGORY_NOT_FOUND` | `CATEGORY_IN_USE` | — |

Cache invalidation on every successful `create`/`update`/`remove` — single line: `await this.cache.del(CacheKeys.categories.all())` before returning.

---

## 4. Controller routes

**File**: `src/admin/categories/categories-admin.controller.ts`

```ts
@Controller('admin/categories')
@AdminEndpoint()
export class CategoriesAdminController {
  constructor(private readonly service: CategoriesAdminService) {}

  @Post()
  create(@Body() dto: CreateCategoryDto) { return this.service.create(dto); }

  @Get()
  list(@Query() q: ListCategoriesQueryDto) { return this.service.list(q); }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.service.get(id); }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) { return this.service.update(id, dto); }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.service.remove(id); }
}
```

`ParseUUIDPipe` rejects non-UUID `:id` params with 400 before the service is invoked.

---

## 4a. Module skeleton

**File**: `src/admin/categories/categories-admin.module.ts`

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { CacheModule } from 'src/common/cache/cache.module';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogInterceptor } from '../interceptors/audit-log.interceptor';
import { CategoriesAdminController } from './categories-admin.controller';
import { CategoriesAdminService } from './categories-admin.service';

@Module({
  imports: [PrismaModule, CacheModule, AuthModule],
  controllers: [CategoriesAdminController],
  providers: [
    CategoriesAdminService,
    RolesGuard,           // local — required for @AdminEndpoint() to resolve via module DI
    AuditLogInterceptor,  // local — same reason
  ],
})
export class CategoriesAdminModule {}
```

**Why `RolesGuard` and `AuditLogInterceptor` are providers locally** (not just inherited from `AdminModule`): NestJS module `imports` are unidirectional — `AdminModule.imports = [CategoriesAdminModule]` makes `CategoriesAdminModule`'s exports visible **inside** `AdminModule`, not the reverse. So even though `AdminModule` exports both providers, `CategoriesAdminModule` does not see them and `@AdminEndpoint()` would fail to resolve at controller construction time. Both providers are stateless (`Reflector` / `Logger` are framework-provided), so a per-module instance has zero functional cost. The foundation docs in `docs/admin/` claim otherwise; that guidance is incorrect and will be fixed by KAN-100. See `research.md` Decision 6.

**Wiring into `AdminModule.imports`**: `src/admin/admin.module.ts` adds exactly one line — `imports: [AuthModule, CategoriesAdminModule]` — to make this module a child of the admin tree (still the agreed code-review choke point for "what is admin-protected"). The DI cascade is **not** what makes the decorator work; the local providers above are.

---

## 5. Migration outline

**Path**: `prisma/migrations/<timestamp>_drop_category_columns_and_restrict_content_fks/migration.sql`

```sql
-- Drop unused nullable columns from Category
ALTER TABLE "categories" DROP COLUMN "description";
ALTER TABLE "categories" DROP COLUMN "icon";

-- Tighten Path.categoryId FK from CASCADE to RESTRICT
ALTER TABLE "paths" DROP CONSTRAINT "paths_categoryId_fkey";
ALTER TABLE "paths" ADD CONSTRAINT "paths_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tighten Course.pathId FK from CASCADE to RESTRICT
ALTER TABLE "courses" DROP CONSTRAINT "courses_pathId_fkey";
ALTER TABLE "courses" ADD CONSTRAINT "courses_pathId_fkey"
    FOREIGN KEY ("pathId") REFERENCES "paths"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
```

Generated automatically by `prisma migrate dev --name drop_category_columns_and_restrict_content_fks` after editing `schema.prisma`. No manual SQL editing required — but verify the generated SQL matches this outline exactly before commit.

**Reversibility**: The down direction (re-adding columns + reverting to Cascade) is straightforward but not provided as a separate migration; rollback in dev is `prisma migrate reset` + reapply.

---

## 6. New `ErrorCode` enum members

**File**: `src/common/error-codes.enum.ts`

```ts
// Categories (admin)
CATEGORY_NOT_FOUND = 'CATEGORY_NOT_FOUND',
CATEGORY_NAME_EXISTS = 'CATEGORY_NAME_EXISTS',
CATEGORY_SLUG_EXISTS = 'CATEGORY_SLUG_EXISTS',
CATEGORY_IN_USE = 'CATEGORY_IN_USE',
```

Added to the existing enum block; no other changes.

---

## 7. Files modified outside the new module

| File | Change |
|---|---|
| `prisma/schema.prisma` | Drop `description`, `icon` from `Category`; change `Path.category` and `Course.path` to `onDelete: Restrict` |
| `prisma/seed.ts` | Remove `description` and `icon` keys from category seed records (around line 140) |
| `src/admin/admin.module.ts` | Add `CategoriesAdminModule` to `imports` |
| `src/common/error-codes.enum.ts` | Add four new members |
| `src/common/filters/http-exception.filter.ts` | Pass through object-shaped `errors` |
| `src/common/filters/http-exception.filter.spec.ts` | Add 4–5 unit tests |
| `src/content/categories/categories.service.ts` | Drop `description`/`icon` from mapper; update TODO comment to reference KAN-82 |
| `src/content/categories/categories.service.spec.ts` | Update assertions to match trimmed shape |
| `src/content/categories/dto/category-response.dto.ts` | Drop `description` and `icon` fields |

These are all surgical; no file is restructured.
