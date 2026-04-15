# Quickstart — KAN-74 Redis CacheModule

End-to-end local bring-up and verification for the cache layer. Assumes Docker is installed and the repo is checked out on branch `012-redis-cache-module`.

## 1. Install new dependencies

```bash
npm install ioredis @nest-lab/throttler-storage-redis
npm install --save-dev ioredis-mock
```

## 2. Update environment

Append to `.env` (copy from `.env.example` if missing):

```bash
REDIS_URL=redis://localhost:6379
FRONTEND_REVALIDATE_SECRET=            # leave empty — helper stays dormant
```

## 3. Start Postgres + Redis

```bash
docker-compose up -d
docker-compose ps   # both services should be "healthy"
```

Expected services: `awamer-postgres` (5432), `awamer-redis` (6379). Volumes: `postgres_data`, `redis_data`.

## 4. Apply Prisma migrations and seed

Unchanged from KAN-73 flow:

```bash
npx prisma migrate deploy
npm run seed
```

No new migrations are added in this ticket.

## 5. Boot the API

```bash
npm run start:dev
```

Logs should show: `RedisClient connected to redis://localhost:6379` and no warnings from `CacheService`.

## 6. Verify the health endpoint

```bash
curl -s http://localhost:3001/api/v1/health | jq
```

Expected response:

```json
{
  "status": "ok",
  "database": "connected",
  "cache": "connected",
  "uptime": 12
}
```

Stop Redis and verify graceful degradation:

```bash
docker-compose stop redis
curl -s http://localhost:3001/api/v1/health | jq
# → { "status": "ok", "database": "connected", "cache": "disconnected", "uptime": ... }
docker-compose start redis
```

## 7. Verify the TODO sweep

```bash
grep -rn "TODO(KAN-74)" src/
# → (no output — zero matches)
```

SC-001 gate.

## 8. Verify key helpers are the only source of cache keys

```bash
grep -rn "'tags:" src/ | grep -v cache-keys.ts
grep -rn "'paths:" src/ | grep -v cache-keys.ts
grep -rn "'courses:" src/ | grep -v cache-keys.ts
grep -rn "'marketing:" src/ | grep -v cache-keys.ts
```

All four must return zero matches outside `src/common/cache/cache-keys.ts`. DoD §14.16 gate.

## 9. Run the test suites

```bash
# Unit tests (uses ioredis-mock)
npm test

# Schema tests (KAN-70, untouched)
npm run test:schema

# Content e2e (KAN-71/72/73, untouched in behavior)
npm run test:content:e2e

# New cache e2e tests (real Redis)
npm run test:e2e -- --testPathPattern='test/common/cache'
```

All four commands must exit green. DoD §14.3 – §14.5.

## 10. Verify throttler Redis backing (two-client scenario)

Spin two supertest agents against `/certificates/verify/any-code` (rate-limited at 30/60s per KAN-73):

```bash
npm run test:e2e -- --testPathPattern='throttler-redis'
```

The test drives 30 requests from client A and 30 from client B in rapid succession and expects HTTP 429 on the 31st aggregate request. Proves the shared Redis counter.

## 11. Verify the tag cache-aside

```bash
redis-cli -u redis://localhost:6379 KEYS 'tags:*'
# → (empty)

curl -s http://localhost:3001/api/v1/tags | jq length
# → some count

redis-cli -u redis://localhost:6379 KEYS 'tags:*'
# → 1) "tags:all"

# Mutate a tag as admin (replace <token> with a valid admin JWT)
curl -s -X POST http://localhost:3001/api/v1/admin/tags \
  -H 'Content-Type: application/json' \
  -H 'Cookie: access_token=<token>' \
  -d '{"name":"Quickstart","slug":"quickstart"}'

redis-cli -u redis://localhost:6379 KEYS 'tags:*'
# → (empty — invalidated)
```

Matches User Story 2 acceptance scenario 1.

## 12. Shutdown

```bash
docker-compose down          # keeps volumes
docker-compose down -v       # removes volumes, fresh start next time
```

## Troubleshooting

- **`cache: "disconnected"` at boot** → Redis container not up; `docker-compose ps`.
- **`redis-cli: command not found`** → run inside the container: `docker exec -it awamer-redis redis-cli`.
- **Tag mutations don't clear cache** → the `_` placeholder shell is still live; confirm the sweep (step 7) returned zero.
- **Throttler e2e test flaky** → the `flushdb()` in `beforeEach` may be racing with an active client; increase the wait between the two supertest agents.
- **`ioredis-mock` TypeScript errors** → ensure `@types/ioredis-mock` is not installed; the package ships its own types in recent versions.
