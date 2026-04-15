# Testing — Backend Reference (awamer-api)

A navigation aid for the three jest configurations in the repo, what
each one runs, and a handful of footguns that new contributors hit.

---

## 1. Three jest configurations

| Config file | What it runs | Purpose |
|-------------|--------------|---------|
| `jest.config.js` (in `package.json`, the Nest default) | `src/**/*.spec.ts` | Unit tests colocated with source files — services, helpers, DTOs, guards. No DB, no HTTP. |
| `test/schema/jest.config.js` | `test/schema/*.spec.ts` | Prisma schema-level integration tests. Each test truncates and re-seeds via `test/schema/setup.ts` and directly calls `prisma.<model>.create(...)`. Verifies uniqueness, relations, cascades, enum mappings. |
| `test/jest-e2e.json` | `test/**/*.e2e-spec.ts` (top-level) | Original auth + onboarding e2e suite — bootstraps the full Nest app with a test database and calls it over HTTP. |
| `test/content-e2e-jest.config.js` | `test/content/**/*.e2e-spec.ts`, `test/enrollment/**/*.e2e-spec.ts`, `test/certificates/**/*.e2e-spec.ts` | Content / enrollment / certificates e2e suite — same shape as the original but scoped to the KAN-70..KAN-26 modules and using a lighter-weight `test-app.ts` bootstrap. |

## 2. npm scripts

```
npm test                  # unit — runs jest with the default config
npm run test:schema       # schema spec suite
npm run test:content:e2e  # content / enrollment / certificates e2e
npm run test:e2e          # original auth + onboarding e2e (test/jest-e2e.json)
npm run test:cov          # unit + coverage
```

There is no single command that runs everything; CI runs the four
suites in parallel.

## 3. Shared bootstrap files

Two helpers build a Nest application instance for e2e tests. They
differ in which modules they mount and in whether they truncate the DB:

- `test/content/test-app.ts` — builds an app with `AppModule` and
  wires the same global pipe/filter/interceptor as production.
  Use for every content / enrollment / certificates e2e spec that
  is **not** hitting the tags-specific bootstrap.
- `test/content/tags/test-app.ts` — tags-specific variant. Exists
  because the tag admin suite needs a slightly different fixture
  shape; do not use it outside `test/content/tags/`.

When writing a new e2e spec, start from an existing file in the same
folder (paths, courses, marketing, enrollment, certificates) and copy
its imports — the bootstrap choice is already correct.

## 4. Footguns

### Redis state leaks across runs

The global throttler now stores counters in Redis
(`@nest-lab/throttler-storage-redis`). Counters survive process death
and therefore survive test runs. Any e2e spec that hits a throttled
endpoint **must** flush Redis before each test:

```ts
beforeEach(async () => {
  await redis.flushdb();
});
```

Without this, a previous run's counters cause the first few requests to
return `429` and the spec fails intermittently. Caches are on the same
Redis instance, so `flushdb()` also clears cache-aside state — which is
almost always what you want in a test.

### `reflect-metadata` in helper specs

Helper specs that import DTO classes (e.g.
`replace-tag-associations.helper.spec.ts`) must start with:

```ts
import 'reflect-metadata';
```

class-validator decorators register with the reflect-metadata polyfill
at import time. Without the import at the top of the spec, the
decorators silently no-op and validation tests pass for the wrong
reason.

Nest provides `reflect-metadata` automatically when the full
`Test.createTestingModule` path is used, so e2e specs do not need the
explicit import. Only helper/unit specs that import DTOs outside a Nest
context need it.

### Schema tests truncate the DB

`test/schema/setup.ts` exports a `truncateAll()` that every schema spec
calls in `beforeEach`. Schema specs should **not** run against a
database you care about; point `DATABASE_URL` at a disposable test
database when invoking `npm run test:schema`.

### Unit specs do not see the global pipe

Services exposed to unit specs are instantiated without the global
`ValidationPipe`. A unit spec that passes a malformed DTO object
directly to a service will not see `VALIDATION_FAILED` — the service
gets the raw object. Tests that need to verify validation behavior
must go through the e2e layer.

---

## 5. Files involved

| File | Role |
|------|------|
| `package.json` | Declares the test scripts |
| `test/jest-e2e.json` | Original e2e config |
| `test/content-e2e-jest.config.js` | Content-domain e2e config |
| `test/schema/jest.config.js` | Schema spec config |
| `test/schema/setup.ts`, `test/schema/global-setup.ts` | Truncation + Prisma client bootstrap |
| `test/content/test-app.ts` | Content e2e Nest-app bootstrap |
| `test/content/tags/test-app.ts` | Tags-specific Nest-app bootstrap |
