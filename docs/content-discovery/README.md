# Content Discovery — Index

Public, unauthenticated discovery endpoints for the learning
catalog: categories, paths, and courses. All endpoints are
cache-aside on Redis. List endpoints use a 5-minute TTL; detail
endpoints have no expiry and rely on mutation invalidation.

| Folder | Purpose |
|--------|---------|
| [categories/](./categories/) | `GET /api/v1/categories` — active categories with published path/course counts |
| [paths/](./paths/) | `GET /api/v1/paths`, `GET /api/v1/paths/:slug`, helpers (stats, mapper, query-hash, marketing-mapper) |
| [courses/](./courses/) | `GET /api/v1/courses`, `GET /api/v1/courses/:slug`, helpers (stats, mapper) — reuses query-hash and marketing-mapper from paths |

## Cross-cutting

- **Pagination tiebreaker**: every list query ends its `orderBy`
  with `{ id: 'asc' }` — see
  [paths/path-stats-helper.md §4](./paths/path-stats-helper.md).
- **Query hash caching**: list endpoints build a deterministic
  SHA-256 prefix of the normalized query — see
  [paths/query-hash-helper.md](./paths/query-hash-helper.md).
- **`isFree` cascade**: a free path/course mutates every nested
  lesson's `isFree` to `true` before mapping — see
  [paths/path-stats-helper.md §2](./paths/path-stats-helper.md).
- **Marketing composition**: both detail endpoints run
  `Promise.all` on three parallel `PublicMarketingQueries` calls.
- **Certificate blocks**: derived from a fixed Arabic text
  constant per domain — see
  [paths/path-mapper.md §1](./paths/path-mapper.md) and
  [courses/course-mapper.md §1](./courses/course-mapper.md).
  Both have a TODO pointing at a future schema change.
- **Response envelope double-wrap**: paginated list responses
  come out as `{ data: { data: [...], meta: {...} }, message }`.
  See [../api-conventions.md §2](../api-conventions.md).
