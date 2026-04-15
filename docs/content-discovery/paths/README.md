# Paths (Public Discovery) — Index

Public discovery endpoints for learning paths. Everything under
`src/content/paths/` on the HTTP side — the legacy `src/paths/`
stub was **deleted** during KAN-26, so there is exactly one
`PathsService` in the tree.

## Endpoints

| File | Purpose |
|------|---------|
| [list-paths.md](./list-paths.md) | `GET /api/v1/paths` — paginated list with filters, cache-aside on `paths:list:<queryHash>` (5 min TTL) |
| [get-path-by-slug.md](./get-path-by-slug.md) | `GET /api/v1/paths/:slug` — full detail with curriculum + marketing, 404 on missing or non-published slug |

## Helpers

| File | Purpose |
|------|---------|
| [path-stats-helper.md](./path-stats-helper.md) | `computePathStats`, `applyIsFreeOverride`, `normalizeLevel`, `buildOrderBy` — the derived-values module |
| [path-mapper.md](./path-mapper.md) | `toPathSummaryDto`, `toPathDetailDto`, `buildPathCertificate`, plus the fixed `PATH_CERTIFICATE_TEXT` constant |
| [query-hash-helper.md](./query-hash-helper.md) | `computeQueryHash` — shared with courses; default-omission rules for stable cache keys |
| [marketing-mapper.md](./marketing-mapper.md) | `toFeatureDto` / `toFaqDto` / `toTestimonialDto` — shared with courses; field renames to DTO shape |

## Notes

- `src/paths/` (legacy) **does not exist** in the current tree.
  It was a stub removed during the KAN-26 reshape. If you see a
  reference to it in a historical ticket, the replacement lives
  here under `src/content/paths/`.
- The `certificate` block in the detail response is derived
  from a fixed Arabic text constant — see
  [path-mapper.md §1](./path-mapper.md) for the TODO pointing at
  the future schema change.
