# API Contract: Auth Module

**Base URL**: `/api/v1/auth`
**Content-Type**: `application/json`
**Authentication**: httpOnly cookies (access_token, refresh_token)

---

## POST /register

**Access**: Public

**Request Body**:
```json
{
  "name": "Ahmad Sekmani",
  "email": "ahmad@example.com",
  "password": "MyP@ss123",
  "country": "SA"
}
```

**Success Response** (201):
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "Ahmad Sekmani",
      "email": "ahmad@example.com",
      "country": "SA",
      "locale": "ar",
      "status": "active"
    }
  },
  "message": "Registration successful"
}
```
**Cookies Set**: `access_token` (15min), `refresh_token` (7 days)

**Error Responses**:
- 400: Validation errors (invalid email, weak password, missing fields)
- 409: Email already registered

---

## POST /login

**Access**: Public

**Request Body**:
```json
{
  "email": "ahmad@example.com",
  "password": "MyP@ss123"
}
```

**Success Response** (200):
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "Ahmad Sekmani",
      "email": "ahmad@example.com",
      "country": "SA",
      "locale": "ar",
      "status": "active"
    }
  },
  "message": "Login successful"
}
```
**Cookies Set**: `access_token` (15min), `refresh_token` (7 days)

**Error Responses**:
- 400: Validation errors (missing fields)
- 401: Invalid credentials (generic — same for wrong email or wrong password)
- 403: Account inactive or suspended

---

## POST /logout

**Access**: Authenticated (requires valid access_token cookie)

**Request Body**: None

**Success Response** (200):
```json
{
  "data": null,
  "message": "Logout successful"
}
```
**Cookies Cleared**: `access_token`, `refresh_token`

**Error Responses**:
- 401: Not authenticated

---

## POST /refresh

**Access**: Public (uses refresh_token cookie, not access_token)

**Request Body**: None

**Success Response** (200):
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "Ahmad Sekmani",
      "email": "ahmad@example.com",
      "country": "SA",
      "locale": "ar",
      "status": "active"
    }
  },
  "message": "Token refreshed"
}
```
**Cookies Set**: New `access_token` (15min), new `refresh_token` (7 days)

**Error Responses**:
- 401: Missing, expired, or invalid refresh token
- 403: Account inactive or suspended

---

## POST /forgot-password

**Access**: Public

**Request Body**:
```json
{
  "email": "ahmad@example.com"
}
```

**Success Response** (200) — ALWAYS returned, even if email not found:
```json
{
  "data": null,
  "message": "If an account with that email exists, a password reset link has been sent"
}
```

**Error Responses**:
- 400: Validation errors (invalid email format)

---

## POST /reset-password

**Access**: Public

**Request Body**:
```json
{
  "token": "abc123hextoken...",
  "password": "NewP@ss456"
}
```

**Success Response** (200):
```json
{
  "data": null,
  "message": "Password reset successful"
}
```

**Error Responses**:
- 400: Validation errors (weak password, missing token)
- 400: Invalid or expired reset token

---

## Cookie Configuration

| Cookie | MaxAge | httpOnly | Secure | SameSite | Path |
|--------|--------|----------|--------|----------|------|
| access_token | 15 minutes | true | true (false in dev) | Lax | / |
| refresh_token | 7 days | true | true (false in dev) | Lax | /api/v1/auth |

## Common Error Format

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "password",
      "message": "Password must be at least 8 characters and contain uppercase, lowercase, and a number"
    }
  ]
}
```
