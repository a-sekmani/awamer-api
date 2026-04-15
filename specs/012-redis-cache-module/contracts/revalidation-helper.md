# Contract — `RevalidationHelper`

**File**: `src/common/cache/revalidation.helper.ts`
**Injectable**: yes; provided and exported by the global `CacheModule`.
**Dependencies**: `ConfigService`, NestJS `Logger`.

Purpose: after a content mutation, optionally ask the Next.js frontend to regenerate its ISR cache for the affected public page. The helper ships **dormant** — no outbound HTTP calls — until the frontend ships the consuming endpoint and the operator sets `FRONTEND_REVALIDATE_SECRET` in the environment.

## Signature

```typescript
@Injectable()
export class RevalidationHelper {
  private readonly logger = new Logger(RevalidationHelper.name);

  constructor(private readonly config: ConfigService) {}

  async revalidatePath(path: string): Promise<void>;
}
```

## Behavior

```typescript
async revalidatePath(path: string): Promise<void> {
  const secret = this.config.get<string>('FRONTEND_REVALIDATE_SECRET');
  const frontendUrl = this.config.get<string>('FRONTEND_URL');

  // Dormancy gate keyed on the SECRET, not the URL (FR-026).
  // Reason: audit finding #2 — FRONTEND_URL is already set to http://localhost:3000
  // in the current .env.example, so gating on it would unintentionally activate the
  // helper in every local dev environment.
  if (!secret) {
    this.logger.debug(`revalidatePath skipped (FRONTEND_REVALIDATE_SECRET unset): ${path}`);
    return;
  }

  if (!frontendUrl) {
    this.logger.debug(`revalidatePath skipped (FRONTEND_URL unset): ${path}`);
    return;
  }

  try {
    await fetch(`${frontendUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, path }),
    });
  } catch (err) {
    this.logger.warn(`revalidatePath('${path}') failed: ${(err as Error).message}`);
    // best-effort; never throw
  }
}
```

## HTTP contract (when active)

- **Method**: `POST`
- **URL**: `${FRONTEND_URL}/api/revalidate`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "secret": "<secret>", "path": "<path>" }`
- **Response**: ignored — the helper does not read the response body or status
- **Timeout**: none imposed by the helper itself (Node's default fetch timeout applies)

## Dormancy gate

**The gate is on `FRONTEND_REVALIDATE_SECRET` presence, not `FRONTEND_URL` presence.** This is a deliberate deviation from ticket §9's example (which gated on both) because audit finding #2 established that `FRONTEND_URL` already has a value in `.env.example` today, so a URL-based gate would activate the helper in local dev and produce spurious failed POSTs to `http://localhost:3000/api/revalidate`.

## Error handling

- Any error thrown by `fetch` (connection refused, DNS failure, TLS error, 5xx response with network exception, etc.) is caught, logged at `warn`, and swallowed.
- HTTP error responses (404, 500, etc.) that `fetch` delivers as a successful Promise are **not** treated as errors; the helper intentionally ignores the response. (If the frontend ships a broken endpoint, operator metrics/logs on the frontend side surface the issue.)

## Call sites

Invoked by marketing services after a successful DB mutation AND a successful slug lookup:

```typescript
// Inside FeaturesService.create (post-DB-commit, post-CacheService.invalidateOwner)
const slug = await this.lookupOwnerSlug(ownerType, ownerId); // private helper (Option A)
if (slug) {
  await this.revalidation.revalidatePath(`/${ownerType}s/${slug}`);
}
```

Tags mutations do **not** call the revalidation helper. Ticket §9 specifies "Tags mutation → `/paths` and `/courses` (list pages)" but also scopes tags as having no per-slug detail page. Since list pages are invalidated by `paths:list:*` pattern delete and the Next.js frontend's `/paths` index is expected to be either static with server-side data fetching or ISR with a broader invalidation strategy, tag mutations defer frontend revalidation until the frontend team explicitly requests it in a follow-up. This is consistent with the ticket's "only marketing services inject RevalidationHelper" implication in §11.

## Test assertions (FR-025 – FR-027)

- When `FRONTEND_REVALIDATE_SECRET` is unset, `fetch` is NOT called; a debug log is emitted.
- When `FRONTEND_URL` is unset (regardless of secret), `fetch` is NOT called.
- When both are set, `fetch` is called exactly once with the method, URL, headers, and body shape above.
- A rejected `fetch` promise does not propagate; caller observes a resolved `void`.
- The helper is idempotent in the sense that repeated invocations with the same `path` produce independent POSTs (no deduplication inside the helper).
