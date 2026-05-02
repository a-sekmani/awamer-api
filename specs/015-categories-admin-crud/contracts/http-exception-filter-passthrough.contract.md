# Contract: `HttpExceptionFilter` object-shaped `errors` pass-through

**Owner**: KAN-82 (the cross-cutting fix benefits KAN-85, KAN-88, KAN-91, KAN-94, KAN-97)
**Implementer**: `src/common/filters/http-exception.filter.ts`
**Test file**: `src/common/filters/http-exception.filter.spec.ts`

## Why this contract exists

The current filter only emits `body.errors` when `resp.message` is an array (the validation-failure pattern). Any other `errors` payload shape — most importantly, the object-shaped `{ pathCount, courseCount }` payload that this PR's `CATEGORY_IN_USE` 409 needs — is silently dropped. The fix is generic; downstream admin tickets need it too.

## What the filter MUST do after this change

Inside the existing `if (typeof exceptionResponse === 'object' && exceptionResponse !== null) { ... }` branch, after the existing array-handling code path for `resp.message`, add exactly this logic:

```ts
if (
  resp.errors !== null &&
  resp.errors !== undefined &&
  typeof resp.errors === 'object' &&
  !Array.isArray(resp.errors)
) {
  body.errors = resp.errors;
}
```

The block runs whether or not the array path also fired. If the array path fired (validation), `body.errors` is already populated; the block above MUST NOT overwrite it (current code sets `body.errors` from the array first via `body.errors = errors;` on line 71-73; the new block runs after that assignment but only if `body.errors` was not already set — guaranteed by the `errors.length > 0` gate, since on validation flows there is no separate `resp.errors` object). To be explicit and unambiguous, the new block should ONLY assign when `body.errors` was not already set:

```ts
if (
  body.errors === undefined &&
  resp.errors !== null &&
  resp.errors !== undefined &&
  typeof resp.errors === 'object' &&
  !Array.isArray(resp.errors)
) {
  body.errors = resp.errors;
}
```

This guarantees the legacy array path takes precedence (regression-safe) when both shapes are somehow present.

## What the filter MUST NOT do after this change

- MUST NOT overwrite `body.errors` if the validation array path already populated it.
- MUST NOT modify `PASSTHROUGH_KEYS` (unchanged: `['parentPathId', 'upgradeUrl', 'reason']`).
- MUST NOT drop primitive `errors` (e.g., `errors: 'some string'`, `errors: 42`) silently in a way that emits warnings — they are dropped silently as before (treated as not-an-object).
- MUST NOT pass through `errors: null` as `body.errors = null` — null is treated as "not present".
- MUST NOT pass through `errors: undefined`.

## Required test coverage

Add **5 unit tests** to `http-exception.filter.spec.ts`. All five share a common Arrange harness already present in the file (creates an Express-like `host` with a mock `getResponse()` that records `.json()` payloads).

| # | Test name | Input | Expected `body.errors` |
|---|---|---|---|
| 1 | `passes through object-shaped errors` | `throw new ConflictException({ errorCode: 'CATEGORY_IN_USE', message: 'in use', errors: { pathCount: 2, courseCount: 5 } })` | `{ pathCount: 2, courseCount: 5 }` |
| 2 | `[regression] still produces array errors from message-array (validation flow)` | `throw new BadRequestException({ message: ['name must be a string', 'slug must match pattern'] })` | `['name must be a string', 'slug must match pattern']` |
| 3 | `does not pass through null errors` | `throw new ConflictException({ errorCode: 'X', message: 'm', errors: null })` | `body.errors` is `undefined` (key absent) |
| 4 | `does not pass through undefined errors` | `throw new ConflictException({ errorCode: 'X', message: 'm' })` | `body.errors` is `undefined` (key absent) |
| 5 | `does not pass through primitive errors` | `throw new ConflictException({ errorCode: 'X', message: 'm', errors: 'a string' })` | `body.errors` is `undefined` (key absent) |

A 6th test is recommended but optional:

| 6 | `array errors win when both shapes present` | `throw new BadRequestException({ message: ['v1'], errors: { foo: 1 } })` | `['v1']` (legacy precedence) |

## Cross-cutting impact

Tickets KAN-85 (Paths admin), KAN-88 (Courses admin), KAN-91 (Sections admin), KAN-94 (Lessons admin), KAN-97 (Content Blocks admin) all need to surface object-shaped `errors` payloads on conflict / in-use responses. They inherit this fix automatically — no per-module work required for any of them, beyond using the filter as-is.
