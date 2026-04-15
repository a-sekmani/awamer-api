# RevalidationHelper — Backend Reference (awamer-api)

> **Class:** `RevalidationHelper`
> **Source:** `src/common/cache/revalidation.helper.ts`
> **Module:** `CacheModule` (exported globally)
> **Status:** dormant — no production deployment uses it yet

`RevalidationHelper` posts a trigger to the Next.js frontend
(`POST ${FRONTEND_URL}/api/revalidate`) to ask it to regenerate a
cached ISR page. It is the backend end of a future Next.js
On-Demand ISR flow. Today it is wired into `CacheModule` so consumers
can call it, but in every live environment it is **dormant**: it
skips silently unless a secret is configured.

---

## 1. The method

```ts
async revalidatePath(path: string): Promise<void>
```

1. Read `FRONTEND_REVALIDATE_SECRET` from config. **If unset, return
   without logging at `warn`** (debug-level skip).
2. Read `FRONTEND_URL` from config. If unset, same.
3. `POST ${frontendUrl}/api/revalidate` with
   `{ "secret": "...", "path": "<path>" }`.
4. Any network/HTTP error → log warning and swallow.

The helper never throws. A revalidation failure must never cause an
admin mutation to fail.

---

## 2. Dormancy gate — why on the secret, not the URL

The check is on `FRONTEND_REVALIDATE_SECRET`, not `FRONTEND_URL`.
Reason: `FRONTEND_URL` is already set to `http://localhost:3000` in
every dev environment (it is required by the Joi schema and has a
default), so gating on the URL would wake up the helper on every
local machine — every tag edit would try to POST to `localhost:3000`
whether or not the frontend was running. Gating on the secret keeps
the helper fully silent until someone explicitly provisions it. See
spec FR-026.

> To "wake up" the helper in a test environment, set
> `FRONTEND_REVALIDATE_SECRET=<anything>` in `.env` and make sure
> the Next.js frontend is reachable at `FRONTEND_URL`.

---

## 3. Call sites

The helper is imported by the marketing services and by the discovery
services to revalidate the public pages whose content just changed.
Since the helper is dormant, the calls are effectively no-ops in
every live environment; the full wiring exists so the activation
can be a pure env-var change.

Typical shape, from a marketing service mutation:

```ts
const slug = await this.cache.slugFor(ownerType, ownerId);
if (slug) {
  await this.revalidationHelper.revalidatePath(
    ownerType === 'path' ? `/paths/${slug}` : `/courses/${slug}`,
  );
}
```

The `slugFor` hop (see [cache-service.md §7](./cache-service.md))
exists entirely to build the URL the frontend will regenerate.

---

## 4. What the frontend must do

The Next.js frontend is expected to expose
`POST /api/revalidate` that:

1. Validates `req.body.secret === process.env.FRONTEND_REVALIDATE_SECRET`.
2. Calls `res.revalidate(req.body.path)`.
3. Returns 200/500 accordingly.

The backend does not read the response body; it only logs on network
failure.

---

## 5. Tests

| File | Covers |
|------|--------|
| `src/common/cache/revalidation.helper.spec.ts` | Dormant skip when secret unset; dormant skip when URL unset; POST shape when both set; fetch-failure is swallowed with a warn log. |

---

## 6. Things NOT to change without coordination

- The dormancy gate on the secret, not the URL. See §2.
- The "never throw" contract. A revalidate failure in production
  must not fail the admin mutation that triggered it.
- The `POST` shape (`{ secret, path }`). The frontend route expects
  those two fields verbatim.
