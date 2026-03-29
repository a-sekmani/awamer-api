---

description: "Task list for NestJS Project Foundation Setup"
---

# Tasks: NestJS Project Foundation Setup

**Input**: Design documents from `/specs/001-nestjs-project-setup/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Not requested — no test tasks generated.

**Organization**: Tasks grouped by user story to enable independent implementation
and testing of each story.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

## Path Conventions

- Single project: `src/`, `prisma/` at repository root
- No monorepo — `awamer-api` is the sole deployable unit

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Initialize the NestJS project, configure TypeScript, and install
all required dependencies before any feature work begins.

- [x] T001 Initialize NestJS project: run `npm i -g @nestjs/cli && nest new . --package-manager npm --language TypeScript --skip-git` at repository root (or adapt existing `package.json` to NestJS 10 if already present)
- [x] T002 [P] Install runtime dependencies: `npm install @nestjs/config @nestjs/passport @nestjs/jwt @nestjs/throttler passport passport-jwt helmet cookie-parser class-validator class-transformer joi @prisma/client`
- [x] T003 [P] Install dev dependencies: `npm install -D prisma @types/passport-jwt @types/cookie-parser @types/helmet`
- [x] T004 [P] Configure `tsconfig.json`: enable `"strict": true`, `"strictNullChecks": true`, `"noImplicitAny": true`; set `"experimentalDecorators": true` and `"emitDecoratorMetadata": true`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create all shared infrastructure that every user story depends on.
No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: All subsequent phases depend on these files existing.

- [x] T005 [P] Create `src/common/interfaces/api-response.interface.ts`: export `ApiResponse<T>` with fields `data: T` and `message: string`; export `PaginatedApiResponse<T>` extending `ApiResponse<T[]>` with `meta: { total, page, limit, totalPages }`
- [x] T006 [P] Create `src/common/interfaces/api-error.interface.ts`: export `ApiError` with fields `statusCode: number`, `message: string`, `errors?: string[] | Record<string, string[]>[]`
- [x] T007 [P] Create `src/common/decorators/public.decorator.ts`: export `IS_PUBLIC_KEY = 'isPublic'` constant and `@Public()` decorator using `SetMetadata(IS_PUBLIC_KEY, true)`
- [x] T008 [P] Create `src/common/decorators/roles.decorator.ts`: export `ROLES_KEY = 'roles'` constant and `@Roles(...roles: string[])` decorator using `SetMetadata(ROLES_KEY, roles)`
- [x] T009 Create `src/common/filters/http-exception.filter.ts`: implement `ExceptionFilter<HttpException>` decorated with `@Catch(HttpException)`; format response as `{ statusCode, message, errors: validationErrors || [] }`; extract nested `response.message` array from `BadRequestException` for the `errors` field; never expose stack traces
- [x] T010 Create `src/common/interceptors/response-transform.interceptor.ts`: implement `NestInterceptor` that wraps all controller return values in `{ data: <original>, message: 'Success' }` using `map()` on the observable
- [x] T011 Create `.env.example` at repository root with all 17 variables from `data-model.md` env schema, each with a placeholder value and an inline comment explaining its purpose (see `data-model.md` § 4 for the full list)
- [x] T012 Create `src/app.module.ts`: import `ConfigModule.forRoot({ isGlobal: true, validationSchema: Joi schema requiring DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET_NAME, SES_FROM_EMAIL, POSTHOG_API_KEY })`; leave other imports as empty array stubs to be filled in subsequent tasks
- [x] T013 Create `src/main.ts`: bootstrap NestJS app; apply `app.use(helmet())`, `app.use(cookieParser())`; call `app.enableCors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true })`; apply global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; set global prefix `/api/v1`; listen on `process.env.PORT || 3001`

**Checkpoint**: Foundation files exist — user story phases can now proceed.

---

## Phase 3: User Story 1 — Developer Bootstraps a Running API Server (Priority: P1) 🎯 MVP

**Goal**: A developer can clone, install, configure `.env`, and reach a running
server with a passing health check within 10 minutes.

**Independent Test**: `npm run start:dev` → `curl http://localhost:3001/api/v1/health`
returns `{ "data": { "status": "ok" }, "message": "Success" }`.

### Implementation for User Story 1

- [x] T014 [US1] Create `src/auth/interfaces/jwt-payload.interface.ts`: export `JwtPayload` interface with `sub: string`, `email: string`, `iat?: number`, `exp?: number`
- [x] T015 [US1] Create `src/auth/strategies/jwt.strategy.ts`: implement `PassportStrategy(Strategy)` using `ExtractJwt.fromExtractors([(req) => req?.cookies?.access_token])`; validate with `JWT_SECRET` from `ConfigService`; `validate()` returns `{ userId: payload.sub, email: payload.email }`
- [x] T016 [US1] Create `src/auth/guards/jwt-auth.guard.ts`: extend `AuthGuard('jwt')`; override `canActivate()` to check `IS_PUBLIC_KEY` metadata via `Reflector` — return `true` immediately if `@Public()` is set, otherwise delegate to `super.canActivate()`
- [x] T017 [US1] Create `src/auth/auth.module.ts`: import `PassportModule`, `JwtModule.registerAsync()` reading `JWT_SECRET` and `JWT_EXPIRATION` from `ConfigService`; declare `JwtStrategy`; export `JwtAuthGuard`
- [x] T018 [US1] Create `src/auth/auth.controller.ts` and `src/auth/auth.service.ts`: stub only — controller has no routes yet; service has no methods; both are valid NestJS injectable classes
- [x] T019 [US1] Create `src/health/health.controller.ts`: `@Controller('health')`, single `@Get()` method decorated with `@Public()`; returns `{ status: 'ok' }` (interceptor wraps it in `{ data, message }` automatically)
- [x] T020 [US1] Create `src/health/health.module.ts`: declare and export `HealthController`
- [x] T021 [US1] Update `src/app.module.ts`: add `AuthModule`, `HealthModule` to imports; add providers `{ provide: APP_GUARD, useClass: JwtAuthGuard }`, `{ provide: APP_FILTER, useClass: HttpExceptionFilter }`, `{ provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor }`

**Checkpoint**: `npm run start:dev` starts cleanly. `GET /api/v1/health` → HTTP 200
with `{ "data": { "status": "ok" }, "message": "Success" }`. US1 is fully testable
independently at this point.

---

## Phase 4: User Story 2 — Developer Connects to the Database (Priority: P2)

**Goal**: A developer with a PostgreSQL instance can run migrations and have Prisma
Client globally available across all modules.

**Independent Test**: `npx prisma migrate dev` completes without errors; app boots
with PrismaService connected.

### Implementation for User Story 2

- [x] T022 [US2] Create `prisma/schema.prisma`: configure `generator client { provider = "prisma-client-js" }` and `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }`; add a comment block listing all future entities to be added (from CLAUDE.md data model)
- [x] T023 [US2] Create `src/prisma/prisma.service.ts`: extend `PrismaClient`; implement `OnModuleInit` calling `this.$connect()` and `OnModuleDestroy` calling `this.$disconnect()`; mark as `@Injectable()`
- [x] T024 [US2] Create `src/prisma/prisma.module.ts`: mark `@Global()` and `@Module({ providers: [PrismaService], exports: [PrismaService] })`
- [x] T025 [US2] Update `src/app.module.ts`: add `PrismaModule` to imports array
- [x] T026 [US2] Run `npx prisma generate` to confirm Prisma Client generates without errors from the schema; commit generated `prisma/schema.prisma`

**Checkpoint**: `npx prisma migrate dev --name init` succeeds. App boots with
PrismaService available. US2 independently testable.

---

## Phase 5: User Story 3 — 14-Module Architecture (Priority: P3)

**Goal**: All 14 domain module directories exist with module/controller/service stubs,
all registered in `AppModule`, and the app compiles with zero errors.

**Independent Test**: `npm run build` succeeds with zero TypeScript errors; all 14
module directories exist under `src/`.

### Implementation for User Story 3

- [x] T027 [P] [US3] Create `src/users/users.service.ts`, `src/users/users.controller.ts` (stub `@Controller('users')` with `@Get()` returning `{}`), `src/users/users.module.ts` (declares controller and service)
- [x] T028 [P] [US3] Create `src/paths/paths.service.ts`, `src/paths/paths.controller.ts` (stub `@Controller('paths')` with `@Get()` decorated `@Public()` returning `{}`), `src/paths/paths.module.ts`
- [x] T029 [P] [US3] Create `src/lessons/lessons.service.ts`, `src/lessons/lessons.controller.ts` (stub `@Controller('lessons')` with `@Get()` returning `{}`), `src/lessons/lessons.module.ts`
- [x] T030 [P] [US3] Create `src/progress/progress.service.ts`, `src/progress/progress.controller.ts` (stub `@Controller('progress')` with `@Get()` returning `{}`), `src/progress/progress.module.ts`
- [x] T031 [P] [US3] Create `src/quizzes/quizzes.service.ts`, `src/quizzes/quizzes.controller.ts` (stub `@Controller('quizzes')` with `@Get()` returning `{}`), `src/quizzes/quizzes.module.ts`
- [x] T032 [P] [US3] Create `src/projects/projects.service.ts`, `src/projects/projects.controller.ts` (stub `@Controller('projects')` with `@Get()` returning `{}`), `src/projects/projects.module.ts`
- [x] T033 [P] [US3] Create `src/subscriptions/subscriptions.service.ts`, `src/subscriptions/subscriptions.controller.ts` (stub `@Controller('subscriptions')` with `@Get()` returning `{}`), `src/subscriptions/subscriptions.module.ts`
- [x] T034 [P] [US3] Create `src/payments/guards/stripe-webhook.guard.ts` (stub `CanActivate` returning `true`); create `src/payments/payments.service.ts`, `src/payments/payments.controller.ts` (stub `@Controller('payments')` with `@Get()` returning `{}`), `src/payments/payments.module.ts`
- [x] T035 [P] [US3] Create `src/certificates/certificates.service.ts`, `src/certificates/certificates.controller.ts` (stub `@Controller('certificates')` with `@Get()` returning `{}`), `src/certificates/certificates.module.ts`
- [x] T036 [P] [US3] Create `src/admin/admin.service.ts`, `src/admin/admin.controller.ts` (stub `@Controller('admin')` with `@Get()` returning `{}`), `src/admin/admin.module.ts`
- [x] T037 [P] [US3] Create `src/analytics/analytics.service.ts`, `src/analytics/analytics.controller.ts` (stub `@Controller('analytics')` with `@Get()` returning `{}`), `src/analytics/analytics.module.ts`
- [x] T038 [P] [US3] Create `src/mail/mail.service.ts` (injectable stub, no controller) and `src/mail/mail.module.ts` (exports `MailService`)
- [x] T039 [P] [US3] Create `src/storage/storage.service.ts` (injectable stub, no controller) and `src/storage/storage.module.ts` (exports `StorageService`)
- [x] T040 [US3] Update `src/app.module.ts`: add all 13 remaining domain modules (UsersModule, PathsModule, LessonsModule, ProgressModule, QuizzesModule, ProjectsModule, SubscriptionsModule, PaymentsModule, CertificatesModule, AdminModule, AnalyticsModule, MailModule, StorageModule) to the imports array

**Checkpoint**: `npm run build` → zero errors. `npm run start:dev` → server boots
with all 14 modules loaded, no circular dependencies or missing provider errors.

---

## Phase 6: User Story 4 — Security and Rate Limiting Active Out of the Box (Priority: P4)

**Goal**: Every response carries Helmet security headers; requests exceeding 100/min
return HTTP 429; error responses follow the standard envelope without leaking internals.

**Independent Test**: Inspect any response for security headers; loop 101 requests to
`/api/v1/health` and confirm the 101st returns HTTP 429.

### Implementation for User Story 4

- [x] T041 [P] [US4] Create `src/common/guards/roles.guard.ts`: implement `CanActivate`; read `@Roles()` metadata via `Reflector`; return `true` for now (stub — full implementation deferred to AdminModule feature)
- [x] T042 [P] [US4] Create `src/common/guards/content-access.guard.ts`: implement `CanActivate`; return `true` (stub — full implementation deferred to PathsModule/SubscriptionsModule feature)
- [x] T043 [P] [US4] Create `src/common/guards/enrollment.guard.ts`: implement `CanActivate`; return `true` (stub — full implementation deferred to ProgressModule feature)
- [x] T044 [US4] Update `src/app.module.ts`: add `ThrottlerModule.forRootAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => [{ ttl: config.get('THROTTLE_TTL', 60000), limit: config.get('THROTTLE_LIMIT', 100) }] })` to imports; add `{ provide: APP_GUARD, useClass: ThrottlerGuard }` to providers
- [x] T045 [US4] Add `THROTTLE_TTL` and `THROTTLE_LIMIT` entries to `.env.example` with defaults `60000` and `100` and explanatory comments

**Checkpoint**: Response headers include `X-Content-Type-Options`, `X-Frame-Options`.
Exceeding rate limit returns `{ "statusCode": 429, "message": "Too Many Requests", "errors": [] }`.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across all user stories.

- [x] T046 [P] Run `npm run build` and confirm zero TypeScript compilation errors; fix any type errors found
- [x] T047 [P] Run `npm run lint` and confirm zero ESLint errors; fix any linting issues
- [x] T048 Audit `.env.example` against all `process.env.*` and `configService.get()` calls in codebase; add any missing entries
- [x] T049 Run integration check per `quickstart.md`: start server → `curl /api/v1/health` → verify JSON envelope → verify Helmet headers → verify CORS allows `localhost:3000` → verify 429 on rate limit exceeded

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 completion — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — provides MVP (running server + health check)
- **Phase 4 (US2)**: Depends on Phase 2 — can start in parallel with Phase 3 after Phase 2
- **Phase 5 (US3)**: Depends on Phase 3 (AuthModule must exist before AppModule wires all modules)
- **Phase 6 (US4)**: Depends on Phase 2 (ThrottlerModule config) and Phase 3 (server running to test)
- **Phase 7 (Polish)**: Depends on all prior phases complete

### User Story Dependencies

- **US1 (P1)**: Requires Phase 2 complete. No dependency on US2/US3/US4. MVP deliverable.
- **US2 (P2)**: Requires Phase 2 complete. No dependency on US1/US3/US4. Can run in parallel with US1.
- **US3 (P3)**: Requires US1 complete (AuthModule must exist before wiring all modules in AppModule).
- **US4 (P4)**: Requires Phase 2 complete. No hard dependency on US1/US2/US3, but testing requires the server to be running (US1).

### Within Each User Story

- Models/interfaces → strategies/services → guards/modules → AppModule registration
- Always: T040 (register all modules) runs last in US3 after all module files exist (T027–T039)
- T044 (ThrottlerModule async config) must follow T012 (initial AppModule creation)

### Parallel Opportunities

```bash
# Phase 1 — run all in parallel after T001:
T002 & T003 & T004

# Phase 2 — run in parallel after Phase 1:
T005 & T006 & T007 & T008   # interfaces + decorators
# then:
T009 & T010 & T011 & T012   # filter, interceptor, .env.example, AppModule
# T013 after T012

# Phase 3 (US1) — sequential dependency chain:
T014 → T015 → T016 → T017 → T018 → T019 → T020 → T021

# Phase 4 (US2) — sequential within story, parallel with US1:
T022 → T023 → T024 → T025 → T026

# Phase 5 (US3) — parallel module creation, then single registration:
T027 & T028 & T029 & T030 & T031 & T032 & T033 & T034 & T035 & T036 & T037 & T038 & T039
# then:
T040

# Phase 6 (US4) — parallel stubs, then AppModule update:
T041 & T042 & T043
# then:
T044 → T045
```

---

## Parallel Example: User Story 3 (14 Module Stubs)

```bash
# Launch all 13 module stubs in parallel (all different directories):
Task T027: "Create UsersModule in src/users/"
Task T028: "Create PathsModule in src/paths/"
Task T029: "Create LessonsModule in src/lessons/"
Task T030: "Create ProgressModule in src/progress/"
Task T031: "Create QuizzesModule in src/quizzes/"
Task T032: "Create ProjectsModule in src/projects/"
Task T033: "Create SubscriptionsModule in src/subscriptions/"
Task T034: "Create PaymentsModule in src/payments/"
Task T035: "Create CertificatesModule in src/certificates/"
Task T036: "Create AdminModule in src/admin/"
Task T037: "Create AnalyticsModule in src/analytics/"
Task T038: "Create MailModule in src/mail/"
Task T039: "Create StorageModule in src/storage/"

# Then register all in app.module.ts:
Task T040: "Register all 13 remaining modules in src/app.module.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 2: Foundational (T005–T013)
3. Complete Phase 3: US1 (T014–T021)
4. **STOP and VALIDATE**: `curl http://localhost:3001/api/v1/health` returns correct JSON
5. Deployable/demonstrable health check server

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation ready
2. Phase 3 (US1) → Running server with health check (MVP ✅)
3. Phase 4 (US2) → Database connected and injectable
4. Phase 5 (US3) → Full 14-module architecture present
5. Phase 6 (US4) → Security hardened + rate limited
6. Phase 7 (Polish) → Production-ready scaffold

---

## Notes

- `[P]` tasks in the same phase write to different files and can run in parallel
- `[US#]` label maps each task to its user story for traceability
- T040 (AppModule final wiring) MUST run after all T027–T039 complete
- T021 (AppModule US1 providers) and T040 (AppModule US3 module list) both modify
  `app.module.ts` — execute sequentially, never in parallel
- No business logic anywhere — controllers return `{}` or a minimal stub object;
  services have no methods beyond the class declaration
- Commit after each phase checkpoint to preserve independently working increments
