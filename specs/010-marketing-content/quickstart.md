# Quickstart — Marketing Content Module

**Feature**: 010-marketing-content · **Branch**: `010-marketing-content`

This quickstart is for a developer picking up the feature after `/speckit.plan` and before `/speckit.tasks`. It assumes the repo is on the feature branch with dependencies installed.

---

## 0. Prereqs

- Node 20 LTS, npm
- PostgreSQL running with `DATABASE_URL` and `awamer_test` databases provisioned (KAN-70 setup)
- `.env` populated with JWT secrets
- `npm install` already run

---

## 1. Verify the baseline still builds and tests pass

```bash
npm run build
npx prisma validate
npm run test:schema
npm run test:content:e2e
npm test
```

All must be green before writing any new code. Any failure here is unrelated to this feature and must be investigated first.

---

## 2. Read the source of truth, in order

1. `docs/tickets/KAN-72.md` — the ticket (source of fact)
2. `specs/010-marketing-content/spec.md` — product-level requirements
3. `specs/010-marketing-content/research.md` — 9 implementation decisions
4. `specs/010-marketing-content/data-model.md` — entity contracts + ordering note about missing `createdAt` on Feature/Faq
5. `specs/010-marketing-content/contracts/{features,faqs,testimonials}.md` — HTTP contracts
6. `src/content/tags/**` — the reference module. Mirror its conventions exactly.

---

## 3. Implementation order (recommended)

1. **Helpers first** (`src/content/marketing/helpers/`):
   - `owner-validator.helper.ts` + spec
   - `reorder.helper.ts` + spec (generic over Prisma delegate; one copy, three consumers)
   - `marketing-cleanup.helper.ts` + spec
   - `public-queries.helper.ts`
2. **Features submodule**: DTOs → service → controller → service spec.
3. **Faqs submodule**: same pattern.
4. **Testimonials submodule**: same pattern, plus `UpdateTestimonialStatusDto` and the `/status` route.
5. **`marketing.module.ts`**: wire providers + controllers + exports.
6. **`content.module.ts`**: import `MarketingModule`; re-export the four helpers.
7. **E2E tests** under `test/content/marketing/`.

---

## 4. Run the new tests

```bash
# Unit tests (picked up by the root jest config)
npm test -- --testPathPattern=src/content/marketing

# E2E tests
npm run test:content:e2e
```

The existing `test/content-e2e-jest.config.js` regex `test/content/.*\.e2e-spec\.ts$` picks up `test/content/marketing/` automatically — no script changes.

---

## 5. Smoke test against a running server

```bash
# Seed a path + obtain an admin JWT via existing auth flows
# Then:
curl -X POST http://localhost:3001/api/v1/admin/paths/$PATH_ID/features \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=$ADMIN_JWT" \
  -d '{"icon":"shield","title":"شهادة معتمدة","description":"احصل على شهادة بعد إتمام المسار","order":0}'

curl http://localhost:3001/api/v1/admin/paths/$PATH_ID/features \
  -H "Cookie: access_token=$ADMIN_JWT"
```

Expected: 201 then 200 with the Arabic text round-tripped byte-for-byte.

---

## 6. Definition of Done checklist (from ticket §14)

- [ ] `npm run build` — 0 TS errors
- [ ] `npx prisma validate` — passes (schema unchanged)
- [ ] `npm run test:schema` — green
- [ ] `npm test` — green (all unit tests)
- [ ] `npm run test:content:e2e` — green (all e2e tests)
- [ ] `git diff prisma/` is empty
- [ ] `git diff src/auth src/users src/onboarding src/common src/content/tags` is empty
- [ ] `MarketingModule` imported in `ContentModule`; `ContentModule` still in `AppModule`
- [ ] Four helpers exported from `ContentModule`
- [ ] README Content section updated with a short note on marketing endpoints + helpers
- [ ] Every mutation site has either a live cache invalidation call (if KAN-74 is merged) or a `TODO(KAN-74)` comment

---

## 7. Gotchas

- **Do not add `createdAt` to `Feature`/`Faq`** — schema is frozen (§15). Sort tie-breaker is `id` ASC; document this inline where the sort is declared.
- **Never share DTOs across the three submodules.** Duplicate `ReorderItemsDto` is intentional (Constitution Principle I + Decision 9).
- **`status` on create is silently ignored** — it's not on the create DTO, and `whitelist: true` strips extras. Do not add a 400 check.
- **Public query helpers do not validate the owner.** KAN-26 owns that.
- **Reorder against an empty owner** with a non-empty list is a 400 (set mismatch), not a 404. A 404 is only raised when the owner itself doesn't exist.
