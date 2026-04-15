# Contract — Paths

Public. No authentication. App-level throttle (100/min).

---

## `GET /api/v1/paths`

### Query parameters

| Param | Type | Default | Validation |
|---|---|---|---|
| `categoryId` | UUID v4 | — | `@IsUUID(4)` |
| `tagId` | UUID v4 | — | `@IsUUID(4)` |
| `level` | enum | — | `@IsEnum(['beginner','intermediate','advanced'])` |
| `search` | string (1–100) | — | `@MinLength(1) @MaxLength(100)`, trimmed |
| `sort` | enum | `'order'` | `@IsEnum(['order','created_at','title'])` |
| `order` | enum | `'asc'` | `@IsEnum(['asc','desc'])` |
| `page` | int | `1` | `@Min(1) @Max(1000)` |
| `limit` | int | `20` | `@Min(1) @Max(100)` |

### Response 200

```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "ai-fundamentals",
      "title": "AI Fundamentals",
      "subtitle": "string | null",
      "level": "beginner | intermediate | advanced | null",
      "thumbnail": "string | null",
      "category": { "id": "uuid", "name": "AI", "slug": "ai" },
      "tags": [{ "id": "uuid", "name": "Python", "slug": "python" }],
      "isFree": false,
      "isNew": true,
      "stats": {
        "courseCount": 4,
        "lessonCount": 32,
        "totalDurationMinutes": 480
      }
    }
  ],
  "meta": {
    "total": 12,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  },
  "message": "Success"
}
```

### Behavior

- Filter: `status = PUBLISHED`.
- `search`: case-insensitive `ILIKE %search%` on `title` AND `subtitle`.
- `tagId`: filters via `path_tags` join.
- Tags inside each item ordered by `tag.name asc`.
- Pagination: `meta.totalPages = Math.ceil(total / limit)`. Page beyond range → `data: []`, NOT 404.
- Cache key: `CacheKeys.paths.list(queryHash)` where `queryHash` is the deterministic 16-char SHA-256 of the canonicalized, sorted-key, default-omitting query.
- Cache TTL: `CacheTTL.LIST` (300s).
- Invalidation: handled by KAN-74 sweep (`TagsService` + admin path/course mutations).

### Errors

| Status | Cause |
|---|---|
| 400 | Invalid query parameter |
| 500 | DB unreachable |

---

## `GET /api/v1/paths/:slug`

### Path params

- `slug` — string, must match an existing `Path.slug` with `status = PUBLISHED`.

### Response 200

```json
{
  "data": {
    "path": {
      "id": "uuid",
      "slug": "ai-fundamentals",
      "title": "AI Fundamentals",
      "subtitle": "string | null",
      "description": "string | null",
      "level": "beginner | intermediate | advanced | null",
      "thumbnail": "string | null",
      "promoVideo": { "url": "...", "thumbnail": "..." } || null,
      "isFree": false,
      "isNew": true,
      "status": "PUBLISHED",
      "skills": ["python", "linear-algebra"],
      "category": { "id": "uuid", "name": "AI", "slug": "ai" },
      "tags": [{ "id": "uuid", "name": "Python", "slug": "python" }],
      "stats": {
        "courseCount": 4,
        "lessonCount": 32,
        "totalDurationMinutes": 480,
        "projectCount": 6
      },
      "certificate": {
        "enabled": true,
        "requiresAwamerPlus": true,
        "text": "..."
      }
    },
    "curriculum": [
      {
        "id": "uuid",
        "slug": "intro-to-ai",
        "order": 1,
        "title": "Intro to AI",
        "subtitle": "string | null",
        "description": "string | null",
        "isFree": false,
        "stats": { "sectionCount": 3, "lessonCount": 12, "totalDurationMinutes": 180 },
        "sections": [
          {
            "id": "uuid",
            "title": "What is AI",
            "order": 1,
            "lessons": [
              {
                "id": "uuid",
                "title": "History",
                "type": "video",
                "order": 1,
                "estimatedMinutes": 12,
                "isFree": true
              }
            ]
          }
        ]
      }
    ],
    "features": [{ "id": "uuid", "title": "...", "order": 1 }],
    "faqs": [{ "id": "uuid", "question": "...", "answer": "...", "order": 1 }],
    "testimonials": [
      { "id": "uuid", "author": "...", "body": "...", "order": 1 }
    ]
  },
  "message": "Success"
}
```

### Behavior

- Filter: `slug = :slug AND status = PUBLISHED`.
- Curriculum: courses where `pathId = path.id AND status = PUBLISHED`, ordered by `Course.order asc, Course.id asc`. Sections ordered by `Section.order asc`. Lessons ordered by `Lesson.order asc`.
- `path.level` normalized via `normalizeLevel()` (Decision D).
- If `path.isFree = true`, every nested `lesson.isFree` is forced to `true`.
- `stats.projectCount` aggregated via `_count.projects` summed across courses.
- Marketing data fetched via THREE parallel calls to `PublicMarketingQueries.getFeaturesByOwner`, `getFaqsByOwner`, `getApprovedTestimonialsByOwner` with `MarketingOwnerType.PATH` (Decision B).
- Cache key: `CacheKeys.paths.detail(slug)`.
- Cache TTL: `CacheTTL.DETAIL` (null).
- Invalidation: handled by KAN-74 marketing/admin sweep.

### Errors

| Status | Cause |
|---|---|
| 404 | Slug not found OR `status != PUBLISHED`. Message: `Path with slug "<slug>" not found` |
| 500 | DB unreachable |
