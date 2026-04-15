# Testimonials — Index

Admin CRUD for the `Testimonial` marketing content. The only
marketing sub-module with a lifecycle — testimonials are created
as `PENDING` and must be explicitly moderated to `APPROVED` or
`HIDDEN`. Shared conventions live in
[../polymorphic-ownership.md](../polymorphic-ownership.md).

| File | Purpose |
|------|---------|
| [admin-list-testimonials.md](./admin-list-testimonials.md) | `GET /admin/paths/:ownerId/testimonials` and `GET /admin/courses/:ownerId/testimonials` — all statuses |
| [admin-create-testimonial.md](./admin-create-testimonial.md) | `POST /admin/paths/:ownerId/testimonials` and `POST /admin/courses/:ownerId/testimonials` — defaults to `PENDING` |
| [admin-update-testimonial.md](./admin-update-testimonial.md) | `PATCH /admin/testimonials/:id` — content fields only |
| [admin-update-testimonial-status.md](./admin-update-testimonial-status.md) | `PATCH /admin/testimonials/:id/status` — moderation transitions |
| [admin-reorder-testimonials.md](./admin-reorder-testimonials.md) | `PATCH /admin/paths/:ownerId/testimonials/reorder` and `PATCH /admin/courses/:ownerId/testimonials/reorder` — includes all statuses |
| [admin-delete-testimonial.md](./admin-delete-testimonial.md) | `DELETE /admin/testimonials/:id` |
