# Marketing — Index

Three parallel polymorphic sub-modules — Features, FAQs, and
Testimonials — that share the same ownership model, helpers, and
cache invalidation shape.

Start with [polymorphic-ownership.md](./polymorphic-ownership.md)
— every endpoint doc in the sub-modules assumes its conventions.

## Shared flow + helpers

| File | Purpose |
|------|---------|
| [polymorphic-ownership.md](./polymorphic-ownership.md) | The shared ownership convention — `(ownerType, ownerId)` with no FK; `OwnerValidator` checks; `MarketingCleanupHelper` as the FK stand-in; cache invalidation shape |
| [owner-validator.md](./owner-validator.md) | `OwnerValidator` — single existence-check helper for paths and courses |
| [reorder-helper.md](./reorder-helper.md) | `ReorderHelper` — shared atomic reorder with set-equality validation, used by all three sub-modules |
| [marketing-cleanup-helper.md](./marketing-cleanup-helper.md) | `MarketingCleanupHelper` — polymorphic FK-replacement cleanup, awaiting a caller |
| [public-marketing-queries.md](./public-marketing-queries.md) | `PublicMarketingQueries` — read-only helper used by the public discovery endpoints; `APPROVED`-only filter on testimonials |

## Sub-modules (5 endpoints each, except testimonials which has 6)

| Folder | Purpose |
|--------|---------|
| [features/](./features/) | `Feature` CRUD — list / create / update / reorder / delete |
| [faqs/](./faqs/) | `Faq` CRUD — list / create / update / reorder / delete |
| [testimonials/](./testimonials/) | `Testimonial` CRUD — list / create / update / **updateStatus** / reorder / delete |
