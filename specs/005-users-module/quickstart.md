# Quickstart: Complete Users Module

**Feature**: 005-users-module
**Date**: 2026-03-29

## Prerequisites

- Node.js 20 LTS
- PostgreSQL running with awamer database (migrations from 002 and 003 applied)
- Auth module working (feature 003-auth-module)
- A registered user with access_token cookie
- Dependencies installed (`npm install`)

## No Additional Dependencies Needed

All required packages (bcryptjs, class-validator, etc.) are already installed.

## Test the Endpoints

First, register/login to get cookies:
```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234"}' \
  -c cookies.txt
```

### 1. Get Me
```bash
curl http://localhost:3001/api/v1/users/me -b cookies.txt
```
Expected: 200, user + profile + role + subscription.

### 2. Update User
```bash
curl -X PATCH http://localhost:3001/api/v1/users/me \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Name","locale":"en"}' \
  -b cookies.txt
```
Expected: 200, updated user.

### 3. Update Profile
```bash
curl -X PATCH http://localhost:3001/api/v1/users/me/profile \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Ahmad","goals":"Learn AI"}' \
  -b cookies.txt
```
Expected: 200, updated profile.

### 4. Change Password
```bash
curl -X PATCH http://localhost:3001/api/v1/users/me/password \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Test1234","newPassword":"NewPass456"}' \
  -b cookies.txt
```
Expected: 200, "Password updated".

### 5. Submit Onboarding
```bash
curl -X POST http://localhost:3001/api/v1/users/me/onboarding \
  -H "Content-Type: application/json" \
  -d '{"responses":[{"questionKey":"level","answer":"beginner","stepNumber":1}],"background":"Student","goals":"AI Career","interests":"ML, Cloud"}' \
  -b cookies.txt
```
Expected: 200, updated profile with onboardingCompleted=true.

### 6. Get Onboarding Status
```bash
curl http://localhost:3001/api/v1/users/me/onboarding -b cookies.txt
```
Expected: 200, completed + responses array.

## Verification Checklist

- [ ] GET /me returns user, profile, role, subscription with plan
- [ ] PATCH /me updates only provided fields
- [ ] PATCH /me rejects invalid locale (not "ar" or "en")
- [ ] PATCH /me/profile updates only provided fields
- [ ] PATCH /me/password rejects wrong current password with 400
- [ ] PATCH /me/password updates hash and invalidates refresh token
- [ ] POST /me/onboarding stores individual responses + updates profile
- [ ] POST /me/onboarding sets onboardingCompleted = true
- [ ] GET /me/onboarding returns correct completed flag and responses
- [ ] All endpoints return 401 without authentication
