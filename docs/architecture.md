# Architecture

How the pieces fit together. Sibling docs: [services](./services.md), [operations](./operations.md), [gotchas](./gotchas.md). For the original product spec see `PROJECT.md` (build phases, gotchas, timeline).

## Request flow at a glance

```
Browser ──► proxy.ts (clerkMiddleware) ──► (gate check) ──► Page / Route Handler
                │                                              │
                ├── /admin/*    : Clerk userId + users.role     ├── Server Component
                │                = "admin" (DB lookup)          │   – reads cookies()
                ├── /account/*  : Clerk userId                  │   – calls db / Clerk
                │   /subscribe/*                                │   – returns JSX
                └── /watch/*    : ensure trial_session cookie   │
                                  (proxy sets if missing)       └── Server Action
                                                                    – "use server"
                                                                    – requireAdmin() etc.
                                                                    – mutates DB
                                                                    – revalidatePath
                                                                    – redirect
```

Server components can **read** cookies but cannot set them — that's why proxy.ts owns trial-cookie issuance. See [gotchas](./gotchas.md#nextjs-cookie-rules).

## Data model

Schemas live in `db/schema/`, one file per logical domain (CLAUDE.md convention). All DB access is through Drizzle — never raw SQL except inside migrations.

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Clerk-id-keyed mirror of Clerk users | `id` (Clerk user id, PK), `email`, `role` (`user`\|`admin`), `stripe_customer_id` |
| `subscriptions` | Stripe-mirrored subscription state | `user_id`, `stripe_subscription_id`, `status`, `plan`, `current_period_end`, `cancel_at_period_end` |
| `shows` | The catalog | `slug` (unique), `genre[]`, `status` (`draft`\|`published`), `deleted_at` (soft-delete) |
| `seasons` | Season per show | `(show_id, number)` unique |
| `episodes` | Episode with Mux linkage | `mux_asset_id`, `mux_playback_id`, `status` (`processing`\|`ready`\|`errored`), `(season_id, number)` unique |
| `trial_sessions` | Anonymous-first 60s trial | `(session_token, show_id)` unique, `expires_at`, `user_id` (nullable, set on signup), `converted`, `last_position_seconds` |
| `watch_progress` | Per-user, per-episode resume position | `(user_id, episode_id)` unique |

FK cascade defaults: deleting a `show` removes its `seasons` → `episodes` → `trial_sessions` (via FK CASCADE). `users.id` cascades into `subscriptions` and `watch_progress`; nulls out `trial_sessions.user_id`.

## Auth model

- Clerk owns identity + sessions.
- `users` table mirrors Clerk via `user.created` webhook (`app/api/webhooks/clerk/route.ts`) — handler is idempotent (`onConflictDoNothing` on `users.id`).
- `users.role` is the **only** source of truth for admin — never Clerk metadata alone.
- `proxy.ts` is the first line of defense; pages/actions use `lib/admin.ts` helpers (`getCurrentUser` / `getCurrentAdmin` / `requireAdmin`) as belt-and-braces.
- `users.email` is required because the promote-to-admin script and Stripe customer lookups both rely on it.

## Trial system (the most subtle piece)

End-to-end:

1. **First `/watch/<slug>` hit**: `proxy.ts` matcher detects `/watch(.*)`. If no `trial_session` cookie, it generates `crypto.randomUUID()` and sets `trial_session` (HTTP-only, secure-in-prod, sameSite=lax, 1y).
2. **Server component (`app/watch/[showSlug]/page.tsx`)**:
   - If signed-in with active subscription → render Player in `subscriber` mode.
   - Otherwise: `getOrCreateTrialSession(sessionToken, show.id)` — `onConflictDoNothing` then SELECT. Returns row.
     - `converted = true` → render in subscriber mode anyway.
     - `now > expires_at` → redirect to `/subscribe?show=<slug>&resume=<last_position_seconds>`.
     - Else → render in `trial` mode.
3. **Player mounts** (`components/watch/player.tsx`):
   - Fetches `/api/playback-token?episode_id=<id>`, captures `token` + `expiresIn`.
   - Sets `expiresAt = Date.now() + expiresIn*1000`.
   - Renders `MuxPlayer` with `tokens={{ playback }}`.
   - `setTimeout(expiresAt - now)` fires at expiry → re-fetches token. Subscriber gets new 1h token. Trial gets 403 → `el.pause()` + Paywall overlay. This is what stops a buffered-ahead Mux stream from running past the cutoff.
   - Every 10s while playing, writes `last_position_seconds` (trial → `trial_sessions`) or `watch_progress` (subscriber).
4. **Token endpoint** (`app/api/playback-token/route.ts`): joins episode → season → show to find the show. If user has `subscriptions.status='active'` → 1h JWT. Else if trial row exists, returns JWT with `ttl = min(remaining, TRIAL_DURATION_SECONDS)`. Else 403.
5. **Conversion linking**:
   - **Page-level** (primary): `/subscribe` server component runs `linkTrialSessionsToCurrentUser()` on render — claims any trial rows with the user's cookie that have `user_id IS NULL`. Catches the common case (user comes from trial → Subscribe → signup → back to /subscribe).
   - **Stripe webhook**: when `customer.subscription.*` lands with active/trialing status, `markUserTrialsConverted(user.id)` flips `converted=true` on all the user's trial rows so playback stops gating.

Constants in `lib/trial.ts`: `TRIAL_DURATION_SECONDS = 60`. `/api/playback-token` imports this as `TRIAL_TTL_CAP` so the JWT can never outlive the row.

## Playback pipeline

```
Admin uploads via @mux/upchunk (components/admin/upload-widget.tsx)
        │
        ▼ (Server Action createMuxUpload)
mux.video.uploads.create({ playback_policies: ["signed"], passthrough: episode.id })
        │
        ▼ (browser uploads chunks directly to Mux)
Mux processes (transcodes etc.)
        │
        ▼ (video.asset.ready webhook → app/api/webhooks/mux/route.ts)
episodes.mux_asset_id / mux_playback_id / duration_seconds / status="ready"
        │
        ▼ (user visits /watch/<slug>)
Player fetches /api/playback-token → RS256 JWT (lib/mux-token.ts)
        │
        ▼
<MuxPlayer playbackId={...} tokens={{ playback: jwt }} />
```

`passthrough` carries the episode id through Mux → webhook → our DB without needing an extra column. Webhook uses `mux.webhooks.unwrap(body, headers, secret)` for signature verification.

**Caveat**: existing assets uploaded before the policy switch have **public** playback IDs and play without a token. Re-upload to gate them.

## Subscription pipeline

```
/subscribe (signed-in, gated by proxy.ts)
   │
   ▼ <form action={startCheckout}>
startCheckout (app/subscribe/actions.ts)
   │
   ├── linkTrialSessionsToCurrentUser ran on /subscribe page render before this
   ├── findOrCreate Stripe customer (stores stripe_customer_id on users)
   ├── checkout.sessions.create with success_url = /watch/<slug>?resume=<n> (if from trial)
   └── redirect(session.url)
   │
   ▼ Stripe Checkout (hosted)
   │
   ▼ (customer.subscription.created webhook → app/api/webhooks/stripe/route.ts)
mirrorSubscription:
   - lookup user by stripe_customer_id
   - upsert subscriptions row keyed on stripe_subscription_id
   - markUserTrialsConverted (active/trialing only)
   │
   ▼ redirect to success_url
/watch/<slug>?resume=<n>  or  /account?welcome=1
```

`subscriptions.cancel_at_period_end` is OR'd from both `sub.cancel_at_period_end` and `sub.cancel_at != null` because the Customer Portal sets the timestamp form, not the boolean. See [gotchas](./gotchas.md#stripe-portal-cancel).

## Route protection (proxy.ts)

```ts
isAdminRoute   = createRouteMatcher(["/admin(.*)"]);
isAuthRoute    = createRouteMatcher(["/account(.*)", "/subscribe(.*)"]);
isWatchRoute   = createRouteMatcher(["/watch(.*)"]);
```

- `/admin/*`: Clerk userId required, then DB lookup `users.role='admin'`. Non-admin → redirect `/`.
- `/account/*`, `/subscribe/*`: Clerk userId required. Anonymous → `redirectToSignIn({ returnBackUrl })`.
- `/watch/*`: public. Sets `trial_session` cookie if missing.
- Everything else: passes through.

Public catalog (`/`, `/shows/[slug]`) isn't gated — it surfaces only `status='published' AND deleted_at IS NULL` rows.

## Route groups

- `app/(public)/` — `/`, `/shows/[slug]` — root layout, no auth
- `app/(account)/account/` — `/account` — root layout, auth required (proxy)
- `app/admin/` — admin panel (not in a group, has its own `layout.tsx`)
- `app/watch/[showSlug]/` — public + cookie-managed
- `app/subscribe/` — checkout form
- `app/api/webhooks/{clerk,mux,stripe}/` — external webhooks (`runtime = "nodejs"`, raw body verification)
- `app/api/playback-token/` — token issuer

## Server actions vs route handlers (CLAUDE.md convention)

- **Server actions**: app mutations (admin CRUD, startCheckout, openBillingPortal, saveWatchProgress, saveTrialPosition).
- **Route handlers**: webhooks from external services (Clerk/Mux/Stripe) and the JWT issuer (`/api/playback-token`).

Webhook handlers always declare `export const runtime = "nodejs";` — the SDK signature verifiers need raw bytes and don't run on the Edge.

## Why these specific choices

- **`postgres-js` over `neon-http`**: lets us run from any Node runtime (Vercel Functions + scripts) with one driver. `prepare: false` is required for Neon's pooled endpoint (pgbouncer transaction mode).
- **Drizzle over Prisma**: type-safe SQL, no engine binary, fast cold start.
- **shadcn over component library**: full source in `components/ui/` — modifiable, no upgrade churn. New shadcn uses Base UI (not Radix); `Button` lacks `asChild`. For "link styled as button" use `buttonVariants()`.
- **Mux signed playback (new uploads)**: `playback_policies: ["signed"]` + JWT enforces server-side gating. Public IDs are still played by mux-player (token ignored) — old assets remain accessible unless re-uploaded.
- **Trial cookie + table**: `cookie` survives across signed-out → signed-up → subscribed without losing the user's place. `trial_sessions.user_id` is nullable until signup; webhook flips `converted` once they pay.
