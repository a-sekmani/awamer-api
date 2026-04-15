# Cache — Index

Redis-backed cache layer introduced by KAN-74. Covers the singleton
`CacheService`, the cache key/TTL reference, the Redis provider, the
dormant ISR revalidation helper, the throttler storage migration, and
the cross-cutting invalidation flow.

| File | Purpose |
|------|---------|
| [cache-service.md](./cache-service.md) | `CacheService` class — never-throw contract, SCAN+UNLINK delete, `invalidateOwner`, `slugFor` |
| [cache-keys.md](./cache-keys.md) | `CacheKeys` + `CacheTTL` constants and the full key/TTL/invalidator reference table |
| [redis-provider.md](./redis-provider.md) | `REDIS_CLIENT` DI token and the ioredis configuration |
| [revalidation-helper.md](./revalidation-helper.md) | Dormant Next.js ISR trigger and the FRONTEND_REVALIDATE_SECRET dormancy gate |
| [throttler-storage.md](./throttler-storage.md) | Migration from in-memory to `@nest-lab/throttler-storage-redis`; test-time `flushdb()` requirement |
| [invalidation-flow.md](./invalidation-flow.md) | Full map of every cache invalidation call site across tags, marketing, and categories |
