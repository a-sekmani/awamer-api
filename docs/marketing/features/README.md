# Features — Index

Admin CRUD for the `Feature` marketing content attached to paths
and courses. Shared conventions live in
[../polymorphic-ownership.md](../polymorphic-ownership.md) — read
it first.

| File | Purpose |
|------|---------|
| [admin-list-features.md](./admin-list-features.md) | `GET /admin/paths/:ownerId/features` and `GET /admin/courses/:ownerId/features` |
| [admin-create-feature.md](./admin-create-feature.md) | `POST /admin/paths/:ownerId/features` and `POST /admin/courses/:ownerId/features` — auto-assigns `order` via `nextOrder` |
| [admin-update-feature.md](./admin-update-feature.md) | `PATCH /admin/features/:id` — partial update |
| [admin-reorder-features.md](./admin-reorder-features.md) | `PATCH /admin/paths/:ownerId/features/reorder` and `PATCH /admin/courses/:ownerId/features/reorder` — atomic via `ReorderHelper` |
| [admin-delete-feature.md](./admin-delete-feature.md) | `DELETE /admin/features/:id` |
