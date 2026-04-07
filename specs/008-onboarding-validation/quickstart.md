# Quickstart: Onboarding Validation Enforcement

**Feature**: 008-onboarding-validation
**Branch**: `008-onboarding-validation`

## Prerequisites

- Node.js 20 LTS
- PostgreSQL running with `awamer` database
- `.env` configured (see `.env.example`)
- Dependencies installed (`npm install`)
- Database migrated (`npx prisma migrate dev`)

## Implementation Order

```
1. src/common/error-codes.enum.ts         — add ONBOARDING_ALREADY_COMPLETED (if not already present)
2. src/users/dto/onboarding.dto.ts        — replace with strict validation + constants
3. src/users/dto/index.ts                 — verify exports
4. src/users/users.service.ts             — replace submitOnboarding() with validation logic
5. src/users/dto/users.dto.spec.ts        — add ~17 new DTO tests
6. src/users/users.service.spec.ts        — add ~27 new service tests
```

## Verification

```bash
# Build — must compile with zero errors
npm run build

# Tests — ALL must pass (existing + new)
npm run test

# Lint — no new errors
npm run lint
```

## Manual Testing

```bash
# Valid submission
curl -X POST http://localhost:3001/api/v1/users/me/onboarding \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=<your-token>" \
  -d '{
    "responses": [
      {"questionKey": "background", "answer": "student", "stepNumber": 1},
      {"questionKey": "interests", "answer": "[\"ai\",\"programming\"]", "stepNumber": 2},
      {"questionKey": "goals", "answer": "learn_new_skill", "stepNumber": 3}
    ]
  }'

# Expected: 200 with profile data, onboardingCompleted: true

# Duplicate submission (should fail)
# Run the same curl again
# Expected: 400 with ONBOARDING_ALREADY_COMPLETED
```

## Files NOT to Modify

- `prisma/schema.prisma` — no migration
- `src/users/users.controller.ts` — routes and guards are correct
- `src/users/users.service.ts:getOnboardingStatus()` — works correctly
- `src/users/users.module.ts` — no changes
- Any auth or middleware files
