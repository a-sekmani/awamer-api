# API Conventions — Backend Reference (awamer-api)

This document is the single source of truth for the conventions every HTTP
endpoint in `awamer-api` follows. Per-endpoint docs under `docs/` link here
instead of re-explaining these invariants. If the code diverges from this
document, the code wins — fix the doc.

---

## 1. URL versioning and prefix

All routes are served under `/api/v1/`. The prefix is applied globally in
`src/main.ts`:

```ts
app.setGlobalPrefix('api/v1');
```

- **URLs:** kebab-case (`/api/v1/admin/tags`, `/api/v1/enrollments/courses/:courseId`).
- **Route parameters:** camelCase (`:lessonId`, `:ownerId`).
- **Query parameters:** camelCase (`?page=1&limit=20&level=beginner`).
- **Request / response bodies:** camelCase (`{ "firstName": "..." }`).

> The project CLAUDE.md describes query params as snake_case. The code uses
> camelCase (`?page=1`, `?categoryId=...`). The code wins.

---

## 2. Success response envelope

Every handler return value is wrapped by the global
`ResponseTransformInterceptor`
(`src/common/interceptors/response-transform.interceptor.ts`):

```ts
return next.handle().pipe(
  map((data) => ({ data, message: 'Success' })),
);
```

The envelope is:

```json
{ "data": <handler return value>, "message": "Success" }
```

Two implications:

1. The interceptor **always writes `"message": "Success"`**. Any
   per-endpoint success message seen in the existing auth docs
   (e.g. `"Registration successful"`) is produced by the **handler**
   returning an object that already contains a `message` field, which
   then lands inside `data`. There is no per-handler way to override the
   outer `message`.
2. **Paginated responses double-wrap.** A service returning
   `{ data: Path[], meta: { ... } }` becomes
   `{ data: { data: [...], meta: { ... } }, message: "Success" }`.
   Frontend consumers must read `response.data.data` for the array and
   `response.data.meta` for the pagination envelope. This is a known
   quirk; do not "fix" it without coordinating with the frontend.

---

## 3. Error response envelope

All exceptions pass through the global `HttpExceptionFilter`
(`src/common/filters/http-exception.filter.ts`). Its output shape:

```json
{
  "statusCode": 400,
  "message": "...",
  "errorCode": "VALIDATION_FAILED",
  "errors": [ ... ]
}
```

| Field        | Always present | Notes |
|--------------|----------------|-------|
| `statusCode` | yes            | HTTP status from the raised `HttpException`. |
| `message`    | yes            | String message. For class-validator failures the filter replaces the Nest default array with `"Validation failed"` and moves the array to `errors`. |
| `errorCode`  | no             | Present when the exception's response object includes an `errorCode` key, or when the filter detects an array `message` (auto-set to `VALIDATION_FAILED`). |
| `errors`     | no             | Present only when class-validator returned a constraint list. |

### Passthrough keys

The filter whitelists three extra keys that services can surface onto the
top-level error body:

```ts
const PASSTHROUGH_KEYS = ['parentPathId', 'upgradeUrl', 'reason'];
```

- `parentPathId` — set by `EnrollmentService.enrollInCourse()` so the
  frontend can redirect to the parent path enrollment flow when the user
  tries to enroll in a child course directly.
- `upgradeUrl`, `reason` — reserved for `ContentAccessGuard` to tell the
  frontend where to send paywalled users.

Any other key on the exception response is **dropped**. Adding a new
passthrough key requires editing the filter.

### `Retry-After` header

When an exception response object carries a `retryAfter` key (seconds),
the filter sets the HTTP `Retry-After` header. This is how the auth
`checkRateLimit()` throttle surfaces cooldowns.

### Non-`HttpException` failures

Unhandled exceptions are logged with stack and collapsed to:

```json
{
  "statusCode": 500,
  "errorCode": "INTERNAL_ERROR",
  "message": "An unexpected error occurred"
}
```

The real error message and stack never reach the client.

See [error-codes.md](./error-codes.md) for the full catalog.

---

## 4. Pagination envelope

Paginated list endpoints return:

```json
{
  "data": [ ... ],
  "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

After the response interceptor runs the wire shape is:

```json
{ "data": { "data": [ ... ], "meta": { ... } }, "message": "Success" }
```

Conventions enforced by the listing services (`PathsService`,
`CoursesService`, `TagsService`, …):

- `?page` defaults to `1`, minimum `1`.
- `?limit` defaults vary per endpoint (commonly `20`), maximum `100`.
- `page` / `limit` validation lives on the Query DTO with
  `@Type(() => Number)` + `@IsInt` + `@Min(1)` / `@Max(100)`.
- Services **always append `{ id: 'asc' }` as the last sort key** so a
  non-unique primary sort (e.g. `order`) never yields an unstable page
  boundary. Paginated queries that fail to do this are a bug — if you
  see one, fix it.

---

## 5. HTTP status conventions

| Status | When used |
|--------|-----------|
| `200 OK` | Successful `GET` / `PATCH`. Also used for `POST` actions that are not creating a new resource (e.g. `POST /learning/lessons/:lessonId/complete`). |
| `201 Created` | `POST` endpoints that create a new row. Declared via `@HttpCode(HttpStatus.CREATED)` or inherited from Nest's default for `@Post()`. |
| `204 No Content` | `DELETE` endpoints. Declared via `@HttpCode(HttpStatus.NO_CONTENT)`. |
| `400 Bad Request` | DTO validation failure, or a service-layer precondition throw. |
| `401 Unauthorized` | Missing, expired, or invalid access token (raised by `JwtAuthGuard`). |
| `403 Forbidden` | Authenticated but not permitted — wrong role (`RolesGuard`), content locked behind subscription (`ContentAccessGuard`), or not enrolled (`EnrollmentGuard`). |
| `404 Not Found` | Resource does not exist. Raised directly by services via `throw new NotFoundException(...)`. |
| `409 Conflict` | Unique constraint violation surfaced as a domain error (e.g. `EMAIL_ALREADY_EXISTS`, duplicate tag slug). |
| `429 Too Many Requests` | Global `ThrottlerGuard` or service-level `checkRateLimit()` tripped. |
| `500 Internal Server Error` | Unhandled exception — always masked to `"An unexpected error occurred"`. |

---

## 6. Authentication

### Global `JwtAuthGuard`

`JwtAuthGuard` is wired as a global guard in `src/app.module.ts`:

```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard }
```

Every route is protected by default. A route is exempted by decorating
it (or its controller) with `@Public()` — the guard checks for the
`IS_PUBLIC_KEY` reflection metadata and short-circuits when present.

### Cookies

Auth endpoints set two httpOnly cookies. Attributes are asserted by the
e2e tests; do not change them without coordinating.

| Cookie          | Attributes |
|-----------------|------------|
| `access_token`  | `httpOnly: true`, `secure: <NODE_ENV === 'production'>`, `sameSite: 'strict'`, `path: '/'`, `maxAge: 900_000` (15 minutes, hardcoded) |
| `refresh_token` | `httpOnly: true`, `secure: <NODE_ENV === 'production'>`, `sameSite: 'strict'`, `path: '/api/v1/auth'`, `maxAge: 7d default, 30d when rememberMe` |

`JwtStrategy` reads the access token from the `access_token` cookie.
Cookies are parsed by `cookie-parser` middleware wired in `main.ts`.

### JWT payload shape

```ts
{
  sub: string,          // user id
  email: string,
  emailVerified: boolean,
  onboardingCompleted: boolean,
  roles: Role[],        // ['LEARNER'] | ['LEARNER', 'ADMIN']
  iat: number,
  exp: number,
}
```

Consumed by `JwtStrategy`, `EmailVerifiedGuard`, `RolesGuard`, and the
frontend `useAuth` hook. Changing the shape without updating all four is
a breaking change.

---

## 7. Guards

| Guard | Scope | Rejects when |
|-------|-------|--------------|
| `JwtAuthGuard` | Global | Access token missing, expired, or invalid (`401`). Exempted by `@Public()`. |
| `EmailVerifiedGuard` | Route-level | `req.user.emailVerified === false` (`403`). |
| `RolesGuard` | Route-level | User's roles do not include one declared by `@Roles(...)` (`403`). |
| `EnrollmentGuard` | Route-level | User is not enrolled in the path (or the standalone course) that owns the requested resource (`403`). Polymorphic — see [learning/content-access-guard.md](./learning/content-access-guard.md) and [enrollment/enrollment-guard.md](./enrollment/enrollment-guard.md). |
| `ContentAccessGuard` | Route-level | Lesson/course is paywalled and user has no active subscription (`403` with `reason: "subscription_required"` and `upgradeUrl`). Skips the Path.isFree rung when the course has no parent path. |
| `ThrottlerGuard` | Global | Request rate exceeds `@Throttle()` declaration or the global default (`429`). |

---

## 8. Rate limiting

The global throttler is registered in `src/app.module.ts` with Redis
storage:

```ts
ThrottlerModule.forRootAsync({
  useFactory: (config, redis) => ({
    throttlers: [{
      ttl:   config.get('THROTTLE_TTL', 60000),   // default 60s
      limit: config.get('THROTTLE_LIMIT', 100),   // default 100 req
    }],
    storage: new ThrottlerStorageRedisService(redis),
  }),
})
```

Global default: **100 requests / 60 seconds / IP**. Per-route overrides
use `@Throttle({ default: { limit, ttl } })`.

Because storage is Redis, throttler counters **persist across process
restarts** — and across e2e test runs. Any test that hits a throttled
endpoint must call `await redis.flushdb()` in its `beforeEach`, or the
throttle state from a previous run will leak in. See
[development/testing.md](./development/testing.md).

A second, per-row rate-limit system exists for auth (`checkRateLimit()`
backed by the `RateLimitedRequest` table). It is documented in
[auth/verify-email.md §6](./auth/verify-email.md) and is unrelated to
the throttler.

---

## 9. DTO validation

The global validation pipe (`src/main.ts`):

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}));
```

- **`whitelist: true`** strips any body/query field not declared on the
  DTO.
- **`forbidNonWhitelisted: true`** then rejects the request with
  `VALIDATION_FAILED` if unknown fields were present. The two together
  mean a typo in a field name is a 400, not a silent drop.
- **`transform: true`** runs class-transformer on incoming payloads.
  Query strings arrive as strings; use `@Type(() => Number)` /
  `@Type(() => Boolean)` on the DTO field to coerce.

### Two-layer validation pattern

New modules in the content domain (tags, marketing, paths, courses) layer
validation in two places:

1. **DTO layer** — structural checks that are safe to run before the
   request reaches the service: types, lengths, patterns, array bounds,
   `@IsEnum()`.
2. **Service layer** — business checks that need a DB read: slug
   uniqueness, foreign-key existence, ownership checks, transition
   legality, etc.

When you add a new field, put the check at the right layer. Putting a DB
lookup in a DTO is not possible; putting a simple length check in a
service is pointless duplication.

---

## 10. Transactional writes

All multi-step mutations go through `prisma.$transaction`:

```ts
await this.prisma.$transaction(async (tx) => {
  // step 1
  // step 2
});
```

This is enforced by code review, not by a lint rule. The existing
hot spots are:

- Auth register (User + UserProfile + UserRole + Subscription).
- Onboarding submit (UserProfile updateMany lock + OnboardingResponse
  rewrite + refresh-token rotation).
- Progress cascade (LessonProgress → SectionProgress → CourseProgress →
  PathProgress, optionally certificate issue — all in one transaction).
- Enrollment (CourseEnrollment/PathEnrollment + seed progress rows).
- Tag association replacement (`ReplaceTagAssociationsHelper`).

Conditional `updateMany` is the project's standard TOCTOU defense when a
state transition must only happen once (see
[auth/verify-email.md](./auth/verify-email.md) and
[onboarding/submit-onboarding.md](./onboarding/submit-onboarding.md)).

---

## 11. Cache conventions

Public read endpoints use a cache-aside pattern on top of Redis:

```
lookup by cache key
 ├─ hit  → return deserialised JSON
 └─ miss → query DB → serialise → SET key with TTL → return
```

Admin mutations that affect a cached view invalidate the relevant keys
via `CacheService.del()` / `delByPattern()` / `invalidateOwner()`. See
[cache/cache-keys.md](./cache/cache-keys.md) for the full key/TTL/
invalidator reference table and
[cache/invalidation-flow.md](./cache/invalidation-flow.md) for the
complete map of every invalidation site.

The cache layer **never throws** on read/write failures; it logs a
warning and degrades to a direct DB read. See
[cache/cache-service.md](./cache/cache-service.md).

---

## 12. Files involved

| File | Role |
|------|------|
| `src/main.ts` | Global pipe, global prefix, CORS, helmet, cookie-parser, bootstrap |
| `src/app.module.ts` | Global guards, filters, interceptors, throttler config, env validation |
| `src/common/filters/http-exception.filter.ts` | Error normalization |
| `src/common/interceptors/response-transform.interceptor.ts` | Success envelope wrapper |
| `src/common/error-codes.enum.ts` | `ErrorCode` enum — see [error-codes.md](./error-codes.md) |
| `src/auth/guards/jwt-auth.guard.ts` | Global auth guard with `@Public()` exemption |
| `src/auth/strategies/jwt.strategy.ts` | Reads `access_token` cookie, verifies JWT |
| `src/common/guards/email-verified.guard.ts` | Blocks unverified users on protected routes |
| `src/auth/decorators/roles.decorator.ts` + `src/auth/guards/roles.guard.ts` | Admin-only routes |

---

## 13. Things NOT to change without coordination

- The response envelope shape (`{ data, message }`) — the frontend
  hard-codes the unwrap in its fetch wrapper and the e2e suite asserts
  it.
- The error envelope shape — same reason, plus the `errorCode` enum is
  consumed by frontend form logic.
- The `PASSTHROUGH_KEYS` list in `HttpExceptionFilter`. Adding a key is a
  coordinated change across backend + frontend.
- The cookie names (`access_token`, `refresh_token`) and their
  attributes.
- The JWT payload shape.
- The `{ id: 'asc' }` pagination tiebreaker rule.
- The global pipe configuration (`whitelist`, `forbidNonWhitelisted`,
  `transform`).
- The `THROTTLE_TTL` / `THROTTLE_LIMIT` defaults without a capacity
  review.
