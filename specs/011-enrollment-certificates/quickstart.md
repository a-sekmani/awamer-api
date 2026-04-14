# Quickstart — Enrollment + Certificates

**Feature**: 011-enrollment-certificates · **Branch**: `011-enrollment-certificates`

For a developer picking up the feature after `/speckit.plan` and before `/speckit.tasks`.

---

## 0. Prereqs

- Node 20 LTS, npm
- PostgreSQL running with `DATABASE_URL` + `awamer_test` database (KAN-70 setup)
- `npm install` already run
- Working directory on branch `011-enrollment-certificates`

---

## 1. Verify baseline is green

```bash
npm run build
npx prisma validate
npm run test:schema
npm run test:content:e2e     # KAN-71 + KAN-72 e2e
npm test                     # all unit tests
```

Any failure here is unrelated to this feature and must be investigated first. The baseline is ~369 unit + ~107 e2e tests.

---

## 2. Read the source of truth, in order

1. `docs/tickets/KAN-73.md` — the ticket
2. `specs/011-enrollment-certificates/spec.md` — requirements + audit findings + 3 clarifications
3. `specs/011-enrollment-certificates/research.md` — 12 implementation decisions
4. `specs/011-enrollment-certificates/data-model.md` — entity contracts + state machines + idempotency rules
5. `specs/011-enrollment-certificates/contracts/{enrollment,certificates,learning}.md` — HTTP contracts
6. Reference modules for conventions: `src/content/tags/`, `src/content/marketing/`, `src/auth/`

---

## 3. Implementation order (recommended)

1. **DTOs first** for all three modules (pure-data files; no runtime dependencies).
2. **`CertificatesService`** (no dependencies on the other new services). Includes private `issueCertificate` and `verifyByCode`.
3. **`EnrollmentService`** (only depends on `PrismaService`). Includes `hasAccessToCourse` for the guard.
4. **Guards**: rewrite `EnrollmentGuard` and `ContentAccessGuard` in place. Wire them to `EnrollmentService` and (stubbed) subscription check.
5. **`ProgressService`** with the full cascade. Imports `CertificatesService` directly; uses `forwardRef` only if NestJS flags a cycle.
6. **`LearningModule`** + controller (3 guards applied to the single route).
7. **Module wiring**: add `LearningModule` to `AppModule.imports`. Verify `EnrollmentModule`, `ProgressModule`, `CertificatesModule` are imported (they already are, but as stubs).
8. **Delete `src/progress/progress.controller.ts`** (dead code, no endpoints).
9. **Unit tests** for each service and guard.
10. **E2E tests** under `test/enrollment/` and `test/certificates/`, starting with the critical `progress-cascade.e2e-spec.ts` (ticket §11.5 scenarios 1–4).
11. **Extend `test/content-e2e-jest.config.js`** regex to cover the new directories.

---

## 4. Run the new tests

```bash
# Unit tests (picked up by the root jest config)
npm test -- --testPathPattern='src/(enrollment|progress|certificates|learning|common/guards)'

# E2E tests (after widening the regex)
npm run test:content:e2e
```

The last command now runs tests from `test/content/`, `test/enrollment/`, AND `test/certificates/` because of the regex widening from Decision 12.

---

## 5. Smoke test the critical flow (scenario 2)

```bash
# Seed a path with 2 courses × 1 section × 2 lessons via the Nest app or prisma client
# Sign a learner JWT with the test-app helper
# Then:

curl -X POST http://localhost:3001/api/v1/enrollments/paths/$PATH_ID \
  -H "Authorization: Bearer $LEARNER_JWT"
# Expect 201 { data: { id, pathId, status: 'ACTIVE', ... } }

for LESSON_ID in $LESSON_IDS; do
  curl -X POST http://localhost:3001/api/v1/learning/lessons/$LESSON_ID/complete \
    -H "Authorization: Bearer $LEARNER_JWT"
done
# After the last lesson: expect certificatesIssued to include BOTH the last course cert AND the path cert

curl http://localhost:3001/api/v1/certificates/me \
  -H "Authorization: Bearer $LEARNER_JWT"
# Expect exactly 3 certificates: 2 course + 1 path
```

---

## 6. Definition of Done (ticket §12)

- [ ] `npm run build` — 0 TS errors
- [ ] `npx prisma validate` — passes (schema unchanged)
- [ ] `npm run test:schema` — green
- [ ] `npm run test:content:e2e` — green (KAN-71 + KAN-72 + new e2e)
- [ ] `npm test` — green (all unit tests including new ones)
- [ ] All unit tests from ticket §11.1–§11.4 pass
- [ ] All e2e tests from ticket §11.5 pass, including Scenarios 1 and 2 of `progress-cascade.e2e-spec.ts`
- [ ] `git diff prisma/` is empty
- [ ] `git diff src/auth src/users src/content/tags src/content/marketing` is empty
- [ ] `git diff src/common/guards/roles.guard.ts` is empty
- [ ] `EnrollmentModule`, `ProgressModule`, `CertificatesModule`, `LearningModule` all registered in `AppModule`
- [ ] Non-enrolled call to `POST /learning/lessons/:id/complete` returns 403
- [ ] `TODO(KAN-quizzes)` marker exists at the quiz-check site in `CertificatesService`
- [ ] `TODO(subscriptions)` marker exists in `ContentAccessGuard`
- [ ] README Content section updated with a short note on the new modules
- [ ] No new npm dependencies

---

## 7. Gotchas

- **Do not use `prisma.lastPosition.upsert`.** The partial unique indexes aren't visible to Prisma's generated client. Use `findFirst` → `create` | `update` (Decision 4).
- **Do not add a composite unique on `Certificate`.** Schema is frozen. Idempotency is enforced in the service via `findFirst` before issue (Decision 3 / data-model).
- **Do not create `src/common/guards/access.guard.ts`.** Extend `content-access.guard.ts` in place (Decision 1 / clarification).
- **Quiz check returns `true`.** Do not attempt to read `QuizAttempt` — `QuizzesService` has no write flow yet, so the table is always empty. Leave the `TODO(KAN-quizzes)` marker and move on.
- **Subscription check returns `true`.** Same reason. `TODO(subscriptions)` is the escape hatch.
- **Only `ACTIVE` enrollments grant access.** `COMPLETED`, `PAUSED`, `DROPPED` all return 403 via `EnrollmentGuard` (clarification Q3).
- **Holder name is a single `fullName` field.** Do not split `User.name` on whitespace (clarification Q2).
- **Idempotent `completeLesson` short-circuits before `prisma.$transaction`.** A pre-check on `LessonProgress` is the fast path. Do not nest the check inside the transaction — it wastes a transaction for every repeat call.
- **Guard order is fixed**: `JwtAuthGuard → EnrollmentGuard → ContentAccessGuard`. Do not merge Enrollment and Access (Constitution VI).
