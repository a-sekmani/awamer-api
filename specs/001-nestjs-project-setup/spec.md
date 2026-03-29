# Feature Specification: NestJS Project Foundation Setup

**Feature Branch**: `001-nestjs-project-setup`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "I need to configure a complete NestJS project for the backend."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Bootstraps a Running API Server (Priority: P1)

A backend developer clones the repository, installs dependencies, copies `.env.example`
to `.env`, fills in the required values, and runs the development server. Within minutes
the API is reachable and the health check endpoint responds with a success status,
confirming the server is correctly configured.

**Why this priority**: This is the entry point for every developer and every deployment.
Nothing else can be built, tested, or deployed until the server starts cleanly.

**Independent Test**: Run `npm install && npm run start:dev` with a valid `.env` file
and verify that `GET /api/v1/health` returns `{ "data": { "status": "ok" }, "message": "Success" }`.

**Acceptance Scenarios**:

1. **Given** a fresh clone and a correctly populated `.env` file, **When** the developer
   starts the development server, **Then** the server starts without errors on port 3001.
2. **Given** the server is running, **When** a request is made to `GET /api/v1/health`,
   **Then** the response is HTTP 200 with `{ "data": { "status": "ok" }, "message": "Success" }`.
3. **Given** the server is running, **When** a request with an invalid body is sent,
   **Then** the global validation layer rejects it with a structured error response.
4. **Given** the server is running, **When** a request originates from `http://localhost:3000`,
   **Then** cross-origin headers allow the request; requests from other origins are blocked.

---

### User Story 2 - Developer Connects to the Database (Priority: P2)

A developer sets up Prisma with a local PostgreSQL instance. They run the migration
command and confirm that the database client can connect, introspect, and query the
database without errors. The project schema file exists and is ready to receive entity
definitions.

**Why this priority**: All 14 domain modules depend on the data layer for persistence.
Establishing the database connection layer is the second critical foundation step.

**Independent Test**: Run `npx prisma migrate dev` with a valid `DATABASE_URL` and
confirm the client generates without errors and the database schema is applied.

**Acceptance Scenarios**:

1. **Given** a valid `DATABASE_URL` in `.env`, **When** the migration command is run,
   **Then** the migration completes without errors and the client is generated.
2. **Given** the client is generated, **When** the application boots, **Then**
   the database service connects and is available for injection in all modules.
3. **Given** an invalid `DATABASE_URL`, **When** the application boots, **Then**
   a clear connection error is thrown and the app does not start silently.

---

### User Story 3 - Developer Navigates the 14-Module Architecture (Priority: P3)

A developer joining the project opens the source tree and immediately finds a clear,
predictable module layout. Each of the 14 domain modules has a dedicated directory with
at minimum a module file, controller, and service stub, all wired into the root module.
The developer can add a new endpoint to any module without confusion about where files
belong.

**Why this priority**: The module structure governs all future feature work. Getting it
right at setup time prevents structural debt across the entire project.

**Independent Test**: Verify all 14 module directories exist under `src/`, each containing
a module, controller, and service file, and the application compiles and starts with all
modules registered.

**Acceptance Scenarios**:

1. **Given** the project is set up, **When** the developer lists `src/`, **Then** they
   find exactly 14 domain module directories: auth, users, paths, lessons, progress,
   quizzes, projects, subscriptions, payments, certificates, admin, analytics, mail,
   storage — plus shared infrastructure directories.
2. **Given** all modules are wired into the root module, **When** the application
   compiles, **Then** no circular dependency or missing provider errors are thrown.
3. **Given** a module directory, **When** the developer opens it, **Then** they find
   at minimum: `*.module.ts`, `*.controller.ts`, `*.service.ts`.

---

### User Story 4 - Security and Rate Limiting Active Out of the Box (Priority: P4)

An operations engineer verifies that every response from the API includes standard
security headers, repeated rapid requests to any endpoint are throttled after a
configured threshold, and the application does not expose sensitive internal details
in error responses.

**Why this priority**: Security hardening and rate limiting must be present from day one —
retrofitting them later risks misconfigured windows.

**Independent Test**: Send more requests than the configured threshold within one minute
and confirm HTTP 429 is returned. Inspect any response and confirm security headers are
present on all responses.

**Acceptance Scenarios**:

1. **Given** the server is running, **When** the developer inspects any HTTP response,
   **Then** standard HTTP security headers are present on all responses.
2. **Given** a rate limit is configured, **When** a client exceeds the request threshold
   within the time window, **Then** the server responds with HTTP 429 and a structured
   error body.
3. **Given** any validation error occurs, **Then** the error response follows
   `{ "statusCode": 400, "message": "...", "errors": [...] }` and does not leak
   stack traces or internal file paths.

---

### Edge Cases

- What happens when `DATABASE_URL` is missing from `.env`? The application MUST fail
  fast at startup with a descriptive error, not crash silently at first query.
- What happens when a request body has unexpected extra fields? The validation layer MUST
  strip unknown properties and reject requests with non-whitelisted keys.
- What happens when the JWT secret environment variables are missing? The application MUST
  refuse to start rather than running with an undefined secret.
- What happens when a non-existent route is called? The server MUST return a structured
  404 matching the standard error envelope, not an HTML error page.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose a health check endpoint at `GET /api/v1/health` that
  returns HTTP 200 with `{ "data": { "status": "ok" }, "message": "Success" }`.
- **FR-002**: The system MUST apply a global API prefix of `/api/v1` to all routes.
- **FR-003**: The system MUST apply a global request validation layer with strict mode:
  unknown properties are stripped and requests with non-whitelisted fields are rejected.
- **FR-004**: The system MUST enable cross-origin access for `http://localhost:3000` only;
  the allowed origin MUST be configurable via an environment variable.
- **FR-005**: The system MUST apply security header middleware to every response.
- **FR-006**: The system MUST enforce rate limiting — no more than 100 requests per minute
  per client IP on all endpoints by default; threshold MUST be configurable via environment
  variables.
- **FR-007**: The system MUST provide a globally available database service that
  establishes a connection on startup and is injectable across all 14 domain modules.
- **FR-008**: The system MUST scaffold 14 domain modules — auth, users, paths, lessons,
  progress, quizzes, projects, subscriptions, payments, certificates, admin, analytics,
  mail, storage — each registered in the root application module.
- **FR-009**: The system MUST configure a JWT authentication strategy using access tokens,
  with an auth guard available for protecting any endpoint.
- **FR-010**: The system MUST provide a `.env.example` file listing every required
  environment variable with placeholder values and inline comments explaining each.
- **FR-011**: All error responses MUST follow the standard envelope:
  `{ "statusCode": <number>, "message": "<string>", "errors": [...] }`.
- **FR-012**: The application MUST fail to start if any required environment variable
  (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`) is absent.

### Key Entities

- **Root Module**: Imports and registers all 14 domain modules plus shared infrastructure
  (database module, rate-limit module, configuration module).
- **Database Module / Service**: Singleton connection wrapper, globally available,
  exposes the data client to the entire application.
- **JWT Strategy / Auth Guard**: Validates JWT tokens extracted from httpOnly cookies;
  the guard can be applied to any endpoint declaratively.
- **Domain Modules (×14)**: Each encapsulates its own controller, service, and DTO
  directory. Stub implementations are sufficient at setup — no business logic required.
- **Health Module**: Lightweight module exposing `GET /api/v1/health` with no
  authentication requirement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with the repository and a running PostgreSQL instance can go
  from cloning the repo to a health-check-passing server in under 10 minutes.
- **SC-002**: The application compiles with zero type errors and zero linting errors
  out of the box.
- **SC-003**: All 14 module directories are present and the application boots successfully
  with all modules registered — verified by the absence of any startup error.
- **SC-004**: Requests exceeding the rate limit threshold receive HTTP 429 within the
  configured time window — verifiable with a simple manual request loop.
- **SC-005**: Every HTTP response carries the expected security headers — verifiable by
  inspecting any response with browser dev tools or a command-line HTTP client.
- **SC-006**: The `.env.example` file is complete — every variable referenced in the
  codebase has a corresponding entry in `.env.example`.

## Assumptions

- A PostgreSQL instance (local or Docker) is available to the developer running the setup.
- The project is bootstrapped into the existing repository root, not as a subdirectory
  inside a monorepo — consistent with the current `awamer-api` structure.
- JWT tokens are transported via httpOnly cookies, not Authorization headers, as specified
  in `CLAUDE.md`.
- Rate limit default is 100 requests per minute per IP; exact values are configurable via
  environment variables but the middleware MUST be active at setup time.
- The 14 module stubs do not need business logic at this stage — controllers and services
  can return placeholder responses. Full implementation follows in subsequent features.
- The health endpoint does not perform a deep database connectivity check in v1; it
  confirms only that the HTTP server is responding. A database ping check is a future
  enhancement.
- The `FRONTEND_URL` environment variable drives the CORS allowed-origins list, defaulting
  to `http://localhost:3000`, so deployment environments can override it without code changes.
- Passport refresh token rotation logic is out of scope for this setup feature; only the
  JWT access token strategy and guard need to be wired up at this stage.
