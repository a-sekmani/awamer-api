# ContentAccessGuard — Backend Reference (awamer-api)

> **Class:** `ContentAccessGuard`
> **Source:** `src/common/guards/content-access.guard.ts`
> **Applied on:** `POST /api/v1/learning/lessons/:lessonId/complete`
> **Runs after:** `EnrollmentGuard`

`ContentAccessGuard` enforces the **constitutional `isFree`
cascade** for any learning route: a lesson is accessible if the
parent `Path` is free, OR the parent `Course` is free, OR the
lesson itself is free, OR the user has an active subscription.
Otherwise: 403 with `reason: 'subscription_required'`.

For **standalone courses** (no parent path), the Path rung is
**skipped** — there is no parent path to inspect. This is FR-026
in the source comment and is the only point where the guard
branches on the course's `pathId`.

---

## 1. Guard order — why after `EnrollmentGuard`

The guard chain on the learning controller is:

```
JwtAuthGuard → EnrollmentGuard → ContentAccessGuard
```

Running `ContentAccessGuard` **after** `EnrollmentGuard` is a
privacy invariant. Consider the alternative:

- Non-enrolled user hits `/learning/lessons/:freeLessonId/complete`.
- Guards run in the wrong order. `ContentAccessGuard` sees
  `lesson.isFree === true`, returns `true`.
- `EnrollmentGuard` then rejects with `Not enrolled`.

The user has now learned that the lesson is free (even though they
cannot consume it). Running enrollment first means the user sees
the same 403 for every lesson in a course they do not own,
regardless of its free/paid state.

---

## 2. `canActivate(context)`

Source: `src/common/guards/content-access.guard.ts`.

1. **Read `:lessonId`** from `req.params`. If absent → return
   `true` — the guard is meaningful only on routes with a lesson
   id, and allowing other routes to pass is the correct default
   (no lesson → nothing to paywall).
2. **Load the lesson** with its section, course, and (via the
   course) the parent path's `isFree` only:
   ```ts
   prisma.lesson.findUnique({
     where: { id: lessonId },
     include: {
       section: {
         include: {
           course: { include: { path: { select: { isFree: true } } } },
         },
       },
     },
   });
   ```
   Missing → `NotFoundException(\`Lesson '${lessonId}' not found\`)`.
3. **Apply the constitutional cascade** in order:
   ```ts
   if (course.pathId && course.path?.isFree) return true;  // Path rung
   if (course.isFree) return true;                         // Course rung
   if (lesson.isFree) return true;                         // Lesson rung
   if (await this.hasActiveSubscription(userId)) return true;
   throw new ForbiddenException({ reason: 'subscription_required', upgradeUrl: '/plus' });
   ```

The Path rung is gated on `course.pathId` being non-null. For a
standalone course, it is skipped automatically. See FR-026.

---

## 3. Constitutional order

The four checks are applied in **this order, always**:

```
Path.isFree  →  Course.isFree  →  Lesson.isFree  →  subscription
```

Two reasons:

1. **Correctness.** A free path grants access to every course and
   lesson under it. A free course grants access to every lesson
   under it. A free lesson grants access to itself only. Checking
   them in order stops at the highest-scope "free" mark.
2. **Cost.** Each check is a cheap field read on data already
   loaded by the `findUnique`. Only the subscription check is a
   separate query, and it runs last.

Do not reorder. The cascade is tagged "Principle VI" in the
source comment and is enforced by code review.

---

## 4. `hasActiveSubscription(userId)` — stub

```ts
private async hasActiveSubscription(_userId: string | undefined): Promise<boolean> {
  // TODO(subscriptions): replace with a real SubscriptionsService.isActive()
  // call once that service exists.
  return true;
}
```

**Currently returns `true` unconditionally.** The paywall is
effectively off: any enrolled user reaching this point is allowed.
The rationale (documented in the source): enrollment discipline is
preserved by `EnrollmentGuard`, which runs first, so non-enrolled
users are still rejected. The subscription check is the only part
that is a pass-through until `SubscriptionsService` lands.

Once the real subscription service is wired, this method becomes
the single swap point.

---

## 5. Error shape

```json
{
  "statusCode": 403,
  "message": "Forbidden",
  "reason": "subscription_required",
  "upgradeUrl": "/plus"
}
```

`reason` and `upgradeUrl` are surfaced by `HttpExceptionFilter`
via the `PASSTHROUGH_KEYS` whitelist — see
[../api-conventions.md §3](../api-conventions.md). The frontend
branches on `reason: 'subscription_required'` and uses
`upgradeUrl` to link to the pricing page.

---

## 6. Tests

| File | Covers |
|------|--------|
| `src/common/guards/content-access.guard.spec.ts` | Path-rung allow (path-owned + `path.isFree`), course-rung allow (course-owned with `course.isFree`), lesson-rung allow, subscription-stub allow, standalone-course skips the path rung even when `course.path` is null, 404 on unknown lesson, route without `:lessonId` returns `true`. |
| `test/content/learning/*.e2e-spec.ts` | End-to-end rejection with the `reason` + `upgradeUrl` envelope once the subscription stub is replaced. |

---

## 7. Files involved

| File | Role |
|------|------|
| `src/common/guards/content-access.guard.ts` | The guard |
| `src/common/filters/http-exception.filter.ts` | Surfaces `reason` + `upgradeUrl` |
| `src/learning/learning.controller.ts` | Applies the guard third in the chain |

---

## 8. Things NOT to change without coordination

- The constitutional order. See §3.
- The "skip the Path rung for standalone courses" branch.
- The always-return-true subscription stub without first wiring
  `SubscriptionsService`. Flipping it to `false` would break every
  learning e2e that currently seeds only an enrollment.
- The guard's position after `EnrollmentGuard`. See §1.
- The `reason` / `upgradeUrl` passthrough fields. The frontend
  hinges its upgrade CTA on these exact names.
