# Docker Compose — Local Development (awamer-api)

> **Source:** `docker-compose.yml` at the repo root

The project ships a minimal `docker-compose.yml` that brings up the
two runtime dependencies — Postgres and Redis — for local
development. The NestJS API itself is **not** in the compose file; it
runs on the host with `npm run start:dev`.

---

## 1. Services

### `postgres`

```yaml
image: postgres:16-alpine
container_name: awamer-postgres
restart: unless-stopped
environment:
  POSTGRES_USER: user
  POSTGRES_PASSWORD: password
  POSTGRES_DB: awamer
ports:
  - '5432:5432'
volumes:
  - postgres_data:/var/lib/postgresql/data
healthcheck:
  test: ['CMD-SHELL', 'pg_isready -U user -d awamer']
  interval: 5s
  timeout: 3s
  retries: 5
```

- Postgres 16 on alpine.
- User / password / db baked in as `user` / `password` / `awamer`.
  Match `DATABASE_URL=postgresql://user:password@localhost:5432/awamer`
  in your `.env`.
- Port `5432` forwarded to the host so the API (running on the host)
  can reach it.
- Data persisted in the named volume `postgres_data`. `docker compose
  down -v` wipes it.
- Health check runs `pg_isready` every 5s.

### `redis`

```yaml
image: redis:7-alpine
container_name: awamer-redis
restart: unless-stopped
ports:
  - '6379:6379'
volumes:
  - redis_data:/data
command: redis-server --appendonly yes
healthcheck:
  test: ['CMD', 'redis-cli', 'ping']
  interval: 5s
  timeout: 3s
  retries: 5
```

- Redis 7 on alpine.
- Append-only persistence enabled (`--appendonly yes`) so counters
  and cache state survive a `restart` (but not a `down -v`).
- Port `6379` forwarded to the host. Match
  `REDIS_URL=redis://localhost:6379` in your `.env`.
- Data persisted in the named volume `redis_data`.
- Health check pings every 5s.

---

## 2. What compose does **not** provide

- **The API itself.** Run it on the host with `npm run start:dev`
  after `npm install` and `npx prisma migrate deploy`.
- **Seed data.** Run `npx ts-node prisma/seed.ts` (or whatever the
  seed script is named) against the running Postgres once migrations
  have applied.
- **The Next.js frontend.** It lives in a separate repo
  (`awamer-web`).

The scope is intentionally minimal: one command brings up the two
stateful dependencies, nothing else.

---

## 3. Common commands

```
docker compose up -d          # start both services in the background
docker compose ps             # show status and health
docker compose logs -f redis  # tail redis logs
docker compose exec redis redis-cli  # open a redis shell
docker compose exec postgres psql -U user -d awamer
docker compose down           # stop + remove containers, keep volumes
docker compose down -v        # stop + remove containers AND volumes (destroys data)
```

### Wiping state between debug sessions

The two most common resets:

```
# Wipe cache / throttler state only
docker compose exec redis redis-cli FLUSHDB

# Wipe the database only
docker compose exec postgres psql -U user -d awamer -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
# then re-run prisma migrate deploy
```

---

## 4. Relationship to tests

The test suites use the same local Postgres and Redis. Running
`npm run test:schema` or `npm run test:content:e2e` against live
containers is safe — the schema specs call `truncateAll()` in
`beforeEach` and the content e2e specs call `redis.flushdb()`. See
[../development/testing.md](../development/testing.md).

Do **not** run tests against a production Postgres/Redis; the
truncation and flushdb calls will destroy data.

---

## 5. Files involved

| File | Role |
|------|------|
| `docker-compose.yml` | Service definitions |
| `.env` | `DATABASE_URL` / `REDIS_URL` — must match the compose port forwards |

---

## 6. Things NOT to change without coordination

- Adding more services (API, frontend, pgadmin). The current
  minimal scope is a deliberate choice to keep compose
  dev-friendly.
- The `postgres:16-alpine` / `redis:7-alpine` images. Minor-version
  upgrades are fine; major-version upgrades require a migration
  plan.
- The default credentials `user` / `password`. They are fine for
  local development; do not reuse them in any shared environment.
- The persistence strategy (named volumes, `appendonly yes`). It is
  chosen so that `restart: unless-stopped` survives machine
  reboots.
