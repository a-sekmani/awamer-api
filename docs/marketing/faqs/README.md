# FAQs — Index

Admin CRUD for the `Faq` marketing content attached to paths and
courses. Shared conventions live in
[../polymorphic-ownership.md](../polymorphic-ownership.md).

| File | Purpose |
|------|---------|
| [admin-list-faqs.md](./admin-list-faqs.md) | `GET /admin/paths/:ownerId/faqs` and `GET /admin/courses/:ownerId/faqs` |
| [admin-create-faq.md](./admin-create-faq.md) | `POST /admin/paths/:ownerId/faqs` and `POST /admin/courses/:ownerId/faqs` |
| [admin-update-faq.md](./admin-update-faq.md) | `PATCH /admin/faqs/:id` — partial update |
| [admin-reorder-faqs.md](./admin-reorder-faqs.md) | `PATCH /admin/paths/:ownerId/faqs/reorder` and `PATCH /admin/courses/:ownerId/faqs/reorder` |
| [admin-delete-faq.md](./admin-delete-faq.md) | `DELETE /admin/faqs/:id` |
