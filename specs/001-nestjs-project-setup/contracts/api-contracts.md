# API Contracts: NestJS Project Foundation Setup

**Feature**: `001-nestjs-project-setup`
**Base URL**: `http://localhost:3001/api/v1`
**Date**: 2026-03-29

---

## Global Conventions

All endpoints follow the conventions from the Awamer API Constitution:

| Aspect | Convention |
|--------|------------|
| URL casing | kebab-case (`/api/v1/lesson-content`) |
| Query params | snake_case (`?sort=created_at`) |
| Body fields | camelCase (`{ "firstName": "..." }`) |
| Auth transport | httpOnly cookie (`access_token`) |
| Success envelope | `{ "data": <T>, "message": "Success" }` |
| Error envelope | `{ "statusCode": N, "message": "...", "errors": [...] }` |
| Pagination | `?page=1&limit=20`, max limit 100 |

---

## Endpoint: Health Check

### `GET /api/v1/health`

Returns the operational status of the HTTP server.

**Authentication**: None (public endpoint, `@Public()` decorator)
**Rate limiting**: Subject to global throttler (100 req/min)

#### Request

```http
GET /api/v1/health HTTP/1.1
Host: localhost:3001
```

No request body or query parameters.

#### Response — 200 OK

```json
{
  "data": {
    "status": "ok"
  },
  "message": "Success"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.status` | `"ok"` | Always `"ok"` in v1 (shallow check only) |
| `message` | string | Always `"Success"` for 2xx responses |

#### Response — 429 Too Many Requests

```json
{
  "statusCode": 429,
  "message": "Too Many Requests",
  "errors": []
}
```

---

## Global Error Responses

These apply to every endpoint in the API.

### 400 Bad Request (Validation Failure)

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "constraints": ["email must be an email"]
    }
  ]
}
```

### 401 Unauthorized (Missing or Invalid JWT)

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "errors": []
}
```

### 403 Forbidden (Insufficient Permissions)

```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "errors": []
}
```

### 403 Forbidden (Subscription Required)

```json
{
  "statusCode": 403,
  "message": "Subscription required",
  "errors": [],
  "reason": "subscription_required",
  "upgradeUrl": "https://awamer.com/upgrade"
}
```

### 404 Not Found

```json
{
  "statusCode": 404,
  "message": "Resource not found",
  "errors": []
}
```

### 429 Too Many Requests

```json
{
  "statusCode": 429,
  "message": "Too Many Requests",
  "errors": []
}
```

### 500 Internal Server Error

```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "errors": []
}
```

**Note**: Stack traces and internal file paths MUST never appear in any error
response body (Principle II — Security-First).

---

## Module Stub Endpoints

The following stub endpoints exist at setup time. They return `{ "data": {},
"message": "Success" }` until their domain feature is implemented. All
non-health endpoints require authentication unless noted.

| Method | Path | Module | Auth |
|--------|------|--------|------|
| GET | `/api/v1/auth/me` | AuthModule | JWT |
| GET | `/api/v1/users/profile` | UsersModule | JWT |
| GET | `/api/v1/paths` | PathsModule | Public |
| GET | `/api/v1/lessons` | LessonsModule | JWT |
| GET | `/api/v1/progress` | ProgressModule | JWT |
| GET | `/api/v1/quizzes` | QuizzesModule | JWT |
| GET | `/api/v1/projects` | ProjectsModule | JWT |
| GET | `/api/v1/subscriptions` | SubscriptionsModule | JWT |
| GET | `/api/v1/payments` | PaymentsModule | JWT |
| GET | `/api/v1/certificates` | CertificatesModule | JWT |
| GET | `/api/v1/admin` | AdminModule | JWT + Admin role |
| GET | `/api/v1/analytics` | AnalyticsModule | JWT + Admin role |

> MailModule and StorageModule expose no direct REST endpoints — they are
> internal service modules consumed by other modules.