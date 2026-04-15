# Health — Index

`GET /health` is the single canary endpoint: database + cache +
uptime, always HTTP 200, with a degraded status field when the DB is
unreachable.

| File | Purpose |
|------|---------|
| [get-health.md](./get-health.md) | `GET /api/v1/health` — parallel DB probe (500ms timeout) and cache probe (PING), response shape, and the "only DB affects status" rule |
