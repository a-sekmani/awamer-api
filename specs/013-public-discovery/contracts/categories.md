# Contract — Categories

## `GET /api/v1/categories`

Public. No authentication. App-level throttle (100/min).

### Request

No path params. No query params.

### Response 200

Wrapped by `ResponseTransformInterceptor`:

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Cybersecurity",
      "slug": "cybersecurity",
      "description": "string | null",
      "icon": "shield | null",
      "order": 0,
      "pathCount": 5,
      "courseCount": 12
    }
  ],
  "message": "Success"
}
```

### Behavior

- Filter: `status = ACTIVE`.
- Order: `order asc`.
- `pathCount`: count of `Path` rows with `status = PUBLISHED` and `categoryId = this.id`.
- `courseCount`: count of `Course` rows with `status = PUBLISHED` and `categoryId = this.id` (standalone + path-attached both count).
- Cache key: `CacheKeys.categories.all()`.
- Cache TTL: `CacheTTL.CATEGORIES` (null — invalidated only on mutation).
- Invalidation: **manual until admin Categories CRUD module exists** (Decision F TODO marker on `CategoriesService`).

### Errors

| Status | Cause |
|---|---|
| 500 | DB unreachable (handled by global filter) |

No 400 (no inputs). No 401 (public). No 404 (always returns array, even empty).
