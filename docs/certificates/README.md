# Certificates — Index

Dual-level certificate issuance — course certificates and path
certificates in a single polymorphic table (see
[../schema/certificate-polymorphic.md](../schema/certificate-polymorphic.md)).

## Endpoints

| File | Purpose |
|------|---------|
| [list-my-certificates.md](./list-my-certificates.md) | `GET /api/v1/certificates/me` — all certificates for the calling user |
| [verify-certificate.md](./verify-certificate.md) | `GET /api/v1/certificates/verify/:code` — public verification with 30/min throttle |

## Flow

| File | Purpose |
|------|---------|
| [dual-level-issuance.md](./dual-level-issuance.md) | How course- and path-level certificates are evaluated and issued inside the progress cascade; the quiz-gate stub; the analytics emission point and its structural idempotency |
