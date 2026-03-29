# Quickstart: Complete Auth Module

**Feature**: 003-auth-module
**Date**: 2026-03-29

## Prerequisites

- Node.js 20 LTS
- PostgreSQL running with `awamer` database (migration from 002-prisma-schema applied)
- `.env` with: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_URL`
- Dependencies installed (`npm install`)
- A default free SubscriptionPlan record seeded in the database

## New Dependencies

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

## Schema Migration

```bash
npx prisma migrate dev --name add-password-reset-fields
npx prisma generate
```

Adds `passwordResetToken` and `passwordResetExpires` to the User model.

## Test the Endpoints

### 1. Register
```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"Test1234","country":"SA"}' \
  -c cookies.txt -v
```
Expected: 201, user data in response, access_token and refresh_token cookies set.

### 2. Login
```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234"}' \
  -c cookies.txt -v
```
Expected: 200, user data, cookies set.

### 3. Refresh
```bash
curl -X POST http://localhost:3001/api/v1/auth/refresh \
  -b cookies.txt -c cookies.txt -v
```
Expected: 200, new cookies set.

### 4. Logout
```bash
curl -X POST http://localhost:3001/api/v1/auth/logout \
  -b cookies.txt -v
```
Expected: 200, cookies cleared.

### 5. Forgot Password
```bash
curl -X POST http://localhost:3001/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```
Expected: 200, same message regardless of email existence.

### 6. Reset Password
```bash
curl -X POST http://localhost:3001/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"<token-from-email>","password":"NewPass123"}'
```
Expected: 200, password updated.

## Verification Checklist

- [ ] Register creates User + UserProfile + UserRole + Subscription in one transaction
- [ ] Login returns user data and sets httpOnly cookies
- [ ] Wrong password returns generic "Invalid credentials" (no enumeration)
- [ ] Refresh rotates the refresh token (old one no longer works)
- [ ] Logout clears cookies and removes refresh token from DB
- [ ] Forgot-password returns 200 for both existing and non-existing emails
- [ ] Reset-password with valid token updates the password
- [ ] Reset-password with expired/used token returns error
- [ ] Validation rejects weak passwords, invalid emails, missing fields
