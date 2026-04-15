# Contract — `CacheService`

**File**: `src/common/cache/cache.service.ts`
**Injectable**: yes, via `@Injectable()`; resolved through `@Global()` `CacheModule`.
**Dependencies**: `@Inject(REDIS_CLIENT) redis: Redis`, `Logger` (NestJS).

## Method signatures

```typescript
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null>;
  async set<T>(key: string, value: T, ttlSeconds: number | null): Promise<void>;
  async del(key: string): Promise<boolean>;
  async delByPattern(pattern: string): Promise<number>;
  async invalidateOwner(type: 'path' | 'course', id: string): Promise<void>;
  async isHealthy(): Promise<boolean>;
}
```

## Error-handling contract

| Method | On Redis failure | On serialization failure | Throws? |
|---|---|---|---|
| `get` | returns `null`, logs `warn` | returns `null`, logs `warn` | **never** |
| `set` | no-op, logs `warn` | no-op, logs `warn` | **never** |
| `del` | returns `false`, logs `warn` | n/a | **never** |
| `delByPattern` | returns accumulated count so far, logs `warn` | n/a | **never** |
| `invalidateOwner` | best-effort; each sub-call swallows its own errors | n/a | **never** |
| `isHealthy` | returns `false`, logs `warn` | n/a | **never** |

## Serialization

- `set`: `JSON.stringify(value)`. `undefined` → stored as `"null"`, returned as `null` on read.
- `get`: `JSON.parse(raw)`. On parse error: return `null`, log warn.
- `Date` objects: stored as ISO strings via `JSON.stringify`; callers rehydrate if needed.
- Binary (Buffer) values: **not supported** — pass only JSON-serializable types.

## Concrete behaviors

### `get<T>`

```typescript
async get<T>(key: string): Promise<T | null> {
  try {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    this.logger.warn(`cache.get('${key}') failed: ${(err as Error).message}`);
    return null;
  }
}
```

### `set<T>`

```typescript
async set<T>(key: string, value: T, ttlSeconds: number | null): Promise<void> {
  try {
    const raw = JSON.stringify(value);
    if (ttlSeconds === null) {
      await this.redis.set(key, raw);
    } else {
      await this.redis.set(key, raw, 'EX', ttlSeconds);
    }
  } catch (err) {
    this.logger.warn(`cache.set('${key}') failed: ${(err as Error).message}`);
  }
}
```

### `del`

```typescript
async del(key: string): Promise<boolean> {
  try {
    const removed = await this.redis.del(key);
    return removed > 0;
  } catch (err) {
    this.logger.warn(`cache.del('${key}') failed: ${(err as Error).message}`);
    return false;
  }
}
```

### `delByPattern`

Uses `SCAN` with `COUNT 500` and `UNLINK` in batches of up to 500 keys. Never uses `KEYS`.

```typescript
async delByPattern(pattern: string): Promise<number> {
  let cursor = '0';
  let totalDeleted = 0;
  try {
    do {
      const [nextCursor, found] = await this.redis.scan(
        cursor, 'MATCH', pattern, 'COUNT', 500,
      );
      cursor = nextCursor;
      if (found.length > 0) {
        const removed = await this.redis.unlink(...found);
        totalDeleted += removed;
      }
    } while (cursor !== '0');
  } catch (err) {
    this.logger.warn(`cache.delByPattern('${pattern}') failed: ${(err as Error).message}`);
  }
  return totalDeleted;
}
```

### `invalidateOwner`

```typescript
async invalidateOwner(type: 'path' | 'course', id: string): Promise<void> {
  await this.del(CacheKeys.marketing.features(type, id));
  await this.del(CacheKeys.marketing.faqs(type, id));
  await this.del(CacheKeys.marketing.testimonials(type, id));
  await this.delByPattern(`${type}s:detail:*`);
  await this.delByPattern(`${type}s:list:*`);
}
```

### `isHealthy`

```typescript
async isHealthy(): Promise<boolean> {
  try {
    const pong = await this.redis.ping();
    return pong === 'PONG';
  } catch (err) {
    this.logger.warn(`cache.isHealthy() failed: ${(err as Error).message}`);
    return false;
  }
}
```

## Test assertions (derived from FR-030)

- `get` returns `null` on miss, on Redis error, on corrupted value.
- `get` returns the stored value on hit; Arabic UTF-8 round-trips byte-identical.
- `set` with `null` TTL persists until explicit delete.
- `set` with numeric TTL expires after the TTL (verified via `ioredis-mock`'s fake clock or `EXPIRETIME` read-back).
- `del` returns `true` when the key existed, `false` otherwise.
- `delByPattern` removes exactly the matching set and returns the correct count.
- `delByPattern` on 10k seeded keys completes under 500 ms in the mock (SC-005 proxy).
- `invalidateOwner('path', id)` deletes the three marketing keys and performs two pattern deletes.
- `isHealthy` returns `true` when PING succeeds, `false` otherwise.
- Every method swallows injected Redis errors without throwing.
