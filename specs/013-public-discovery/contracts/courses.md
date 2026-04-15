# Contract — Courses

Public. No authentication. App-level throttle (100/min).

---

## `GET /api/v1/courses`

### Query parameters

All `GET /paths` parameters PLUS:

| Param | Type | Default | Validation |
|---|---|---|---|
| `pathId` | UUID v4 | — | `@IsUUID(4)` |
| `standalone` | boolean | — | presence-based; `true` only |

`pathId` and `standalone` are **mutually exclusive**. Supplying both → 400.

### Response 200

```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "git-basics",
      "title": "Git Basics",
      "subtitle": "string | null",
      "level": "beginner | intermediate | advanced | null",
      "thumbnail": "string | null",
      "category": { "id": "uuid", "name": "DevOps", "slug": "devops" },
      "path": { "id": "uuid", "slug": "...", "title": "..." } || null,
      "tags": [],
      "isFree": true,
      "isNew": false,
      "stats": {
        "sectionCount": 4,
        "lessonCount": 16,
        "totalDurationMinutes": 240
      }
    }
  ],
  "meta": { "total": 8, "page": 1, "limit": 20, "totalPages": 1 },
  "message": "Success"
}
```

### Behavior

- Filter: `status = PUBLISHED`.
- `standalone=true` → adds `WHERE pathId IS NULL`.
- `pathId=<uuid>` → adds `WHERE pathId = <uuid>`.
- `course.path` is `null` when standalone, `{ id, slug, title }` otherwise.
- `level` already enum-backed; lowercase for the DTO.
- Cache key: `CacheKeys.courses.list(queryHash)`.
- Cache TTL: `CacheTTL.LIST` (300s).

### Errors

| Status | Cause |
|---|---|
| 400 | Invalid query, OR `pathId` + `standalone` both supplied (`Cannot supply both pathId and standalone`) |
| 500 | DB unreachable |

---

## `GET /api/v1/courses/:slug`

### Path params

- `slug` — string, must match an existing `Course.slug` with `status = PUBLISHED`. (Slug is globally unique — verified by audit.)

### Response 200

```json
{
  "data": {
    "course": {
      "id": "uuid",
      "slug": "git-basics",
      "title": "Git Basics",
      "subtitle": "string | null",
      "description": "string | null",
      "level": "beginner | intermediate | advanced | null",
      "thumbnail": "string | null",
      "isFree": true,
      "isNew": false,
      "status": "PUBLISHED",
      "skills": ["git", "github"],
      "category": { "id": "uuid", "name": "DevOps", "slug": "devops" },
      "parentPath": { "id": "uuid", "slug": "...", "title": "..." } || null,
      "tags": [],
      "stats": {
        "sectionCount": 4,
        "lessonCount": 16,
        "totalDurationMinutes": 240,
        "projectCount": 2
      },
      "certificate": {
        "enabled": true,
        "requiresAwamerPlus": false,
        "text": "..."
      }
    },
    "curriculum": [
      {
        "id": "uuid",
        "title": "Setup",
        "order": 1,
        "lessons": [
          {
            "id": "uuid",
            "title": "Install git",
            "type": "video",
            "order": 1,
            "estimatedMinutes": 8,
            "isFree": true
          }
        ]
      }
    ],
    "features": [],
    "faqs": [],
    "testimonials": []
  },
  "message": "Success"
}
```

### Behavior

- Filter: `slug = :slug AND status = PUBLISHED`.
- Curriculum is `Section[]` (one level shallower than Path detail).
- `parentPath`: `null` if `course.pathId IS NULL`, else fetched from the joined Path row.
- `course.level` is enum-backed — lowercase only (no `normalizeLevel` needed, but the helper accepts it harmlessly).
- If `course.isFree = true`, every nested `lesson.isFree` is forced to `true`.
- `stats.projectCount` from `_count.projects` on the course.
- Marketing fetched via THREE parallel calls with `MarketingOwnerType.COURSE` (Decision B).
- Cache key: `CacheKeys.courses.detail(slug)`.
- Cache TTL: `CacheTTL.DETAIL` (null).

### Errors

| Status | Cause |
|---|---|
| 404 | Slug not found OR `status != PUBLISHED`. Message: `Course with slug "<slug>" not found` |
| 500 | DB unreachable |
