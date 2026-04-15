# Tags — Index

Tag taxonomy introduced by KAN-71. A single cross-cutting tag model
associated to both paths and courses via independent join tables
(see [../schema/tag.md](../schema/tag.md)).

## Public endpoint

| File | Purpose |
|------|---------|
| [list-public-tags.md](./list-public-tags.md) | `GET /api/v1/tags` — active tags with published path/course counts; Redis cache + HTTP `Cache-Control: max-age=60` |

## Admin endpoints

| File | Purpose |
|------|---------|
| [admin-list-tags.md](./admin-list-tags.md) | `GET /api/v1/admin/tags` — all tags including `HIDDEN`, with `status` and `createdAt` |
| [admin-create-tag.md](./admin-create-tag.md) | `POST /api/v1/admin/tags` — new tag, slug-pattern + unique, invalidate-before-write |
| [admin-update-tag.md](./admin-update-tag.md) | `PATCH /api/v1/admin/tags/:id` — partial update, at-least-one-field required |
| [admin-delete-tag.md](./admin-delete-tag.md) | `DELETE /api/v1/admin/tags/:id` — cascade delete of join rows |

## Helpers

| File | Purpose |
|------|---------|
| [replace-tag-associations-helper.md](./replace-tag-associations-helper.md) | `ReplaceTagAssociationsHelper` — atomic replacement of tag associations for a path or course with validation |
