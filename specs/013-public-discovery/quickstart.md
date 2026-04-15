# Quickstart — Public Discovery (manual smoke)

```bash
docker-compose up -d
npm run start:dev

# 1) Categories
curl -s http://localhost:3001/api/v1/categories | jq

# 2) Paths list (paginated, filtered, searched)
curl -s 'http://localhost:3001/api/v1/paths?limit=5' | jq
curl -s 'http://localhost:3001/api/v1/paths?categoryId=<uuid>&level=beginner&search=cyber' | jq

# 3) Path detail (single SSR payload)
curl -s http://localhost:3001/api/v1/paths/<published-slug> | jq

# 4) Courses list with mutual-exclusion check
curl -s 'http://localhost:3001/api/v1/courses?standalone=true' | jq
curl -s 'http://localhost:3001/api/v1/courses?pathId=<uuid>' | jq
curl -s 'http://localhost:3001/api/v1/courses?pathId=<uuid>&standalone=true' | jq   # → 400

# 5) Course detail
curl -s http://localhost:3001/api/v1/courses/<published-slug> | jq

# 6) Tags (KAN-71 — verification only)
curl -s http://localhost:3001/api/v1/tags | jq

# Cache verification (verify Redis is being used)
docker exec awamer-redis redis-cli KEYS 'paths:list:*'
docker exec awamer-redis redis-cli KEYS 'paths:detail:*'
docker exec awamer-redis redis-cli KEYS 'courses:list:*'
docker exec awamer-redis redis-cli KEYS 'courses:detail:*'
docker exec awamer-redis redis-cli KEYS 'categories:all'

# Cache hit/miss timing — second call should be much faster
time curl -s http://localhost:3001/api/v1/paths/<slug> > /dev/null
time curl -s http://localhost:3001/api/v1/paths/<slug> > /dev/null
```

## Categories cache invalidation (manual — Decision F)

Until an admin Categories CRUD module exists, after a manual DB change to a category run:

```bash
docker exec awamer-redis redis-cli DEL categories:all
```
