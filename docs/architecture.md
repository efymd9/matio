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
| `episodes` | Episode with Mux linkage | `mux_asset_id`, `mux_playback_id`, `mux_playback_policy` (`public`\|`signed`), `status` (`processing`\|`ready`\|`errored`), `intro_start_seconds` + `intro_end_seconds` (nullable; drive the "Skip intro" chip), `(season_id, number)` unique |
| `trial_sessions` | Anonymous-first 60s trial | `(session_token, show_id)` unique, `expires_at`, `user_id` (nullable, set on signup), `converted`, `last_position_seconds` |
| `watch_progress` | Per-user, per-episode resume position | `(user_id, episode_id)` unique |

FK cascade defaults: deleting a `show` removes its `seasons` → `episodes` → `trial_sessions` (via FK CASCADE). `users.id` cascades into `subscriptions` and `watch_progress`; nulls out `trial_sessions.user_id`.

## Auth model

- Clerk owns identity + sessions.
- `users` table mirrors Clerk via `user.created` webhook (`app/api/webhooks/clerk/route.ts`) — handler is idempotent (`onConflictDoNothing` on `users.id`).
- `users.role` is the **only** source of truth for admin — never Clerk metadata alone.
- `proxy.ts` is the first line of defense; pages/actions use `lib/admin.ts` helpers as belt-and-braces:
  - `getCurrentUser()` — pure read, returns the local row or `null`. Use for pages that can tolerate a missing mirror (e.g. analytics-only callsites).
  - `getOrSyncCurrentUser()` — read-or-upsert from `currentUser()` if the local row is missing. Use anywhere a missing mirror would block the user from making progress (e.g. `/subscribe` server action, `/account` page). Closes the race where a brand-new signup hits these surfaces before the `user.created` webhook lands.
  - `getCurrentAdmin()` / `requireAdmin()` — role-gated variants for admin pages and actions.
- `users.email` is required because the promote-to-admin script and Stripe customer lookups both rely on it.

## Trial system (the most subtle piece)

End-to-end:

1. **First `/watch/<slug>` hit**: `proxy.ts` matcher detects `/watch(.*)`. If no `trial_session` cookie, it generates `crypto.randomUUID()` and sets `trial_session` (HTTP-only, secure-in-prod, sameSite=lax, 1y).
2. **Server component (`app/watch/[showSlug]/page.tsx`)**:
   - If signed-in with active subscription → render Player in `subscriber` mode.
   - Otherwise: `getOrCreateTrialSession(sessionToken, show.id)` — `onConflictDoNothing` then SELECT. Returns row.
     - `now > expires_at` → redirect to `/subscribe?show=<slug>&resume=<last_position_seconds>`. `resume` is only included when the row hasn't yet `converted` — for a former subscriber, the trial offset is stale.
     - Else → render in `trial` mode.
   - **Not** a shortcut: `trial.converted = true` does **not** grant subscriber-mode rendering. Access for converted-and-still-paying users is granted via the active-subscription lookup above; converted-but-canceled users get the same trial-expired flow as any anonymous visitor.
3. **Player mounts** (`components/watch/player.tsx`):
   - Outer `Player` picks the initial episode; the inner `EpisodePlayback` (keyed on `current.id`) does the actual playback work.
   - Inner fetches `/api/playback-token?episode_id=<id>` on mount, captures `token` + `expiresIn`, sets `expiresAt = Date.now() + expiresIn*1000`.
   - Renders `<MediaController>` + `<MuxVideo slot="media" playbackId tokens={{ playback }} />` (headless mux-video + media-chrome — not `@mux/mux-player-react`).
   - `setTimeout(expiresAt - now)` fires at expiry → re-fetches token. Subscriber gets new 1h token. Trial gets 403 → `videoRef.current.pause()` + Paywall overlay. This is what stops a buffered-ahead Mux stream from running past the cutoff.
   - Every 10s while playing, writes `last_position_seconds` (trial → `trial_sessions`) or `watch_progress` (subscriber).
4. **Token endpoint** (`app/api/playback-token/route.ts`): joins episode → season → show to find the show. If user has `subscriptions.status='active'` → 1h JWT. Else if trial row exists, returns JWT with `ttl = min(remaining, TRIAL_DURATION_SECONDS)`. Else 403.
5. **Conversion linking**:
   - **Page-level** (primary): `/subscribe` server component runs `linkTrialSessionsToCurrentUser()` on render — claims any trial rows with the user's cookie that have `user_id IS NULL`. Catches the common case (user comes from trial → Subscribe → signup → back to /subscribe).
   - **Stripe webhook**: when `customer.subscription.*` lands with active/trialing status, `markUserTrialsConverted(user.id)` flips `converted=true` on all the user's trial rows. This is an **analytics-only** marker (powers the trial→paid metric on the admin dashboard). It does not affect playback — gating is purely based on `subscriptions.status='active'` and the trial expiry timestamp.

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
episodes.mux_asset_id / mux_playback_id / mux_playback_policy /
duration_seconds / status="ready"
        │
        ▼ (user visits /watch/<slug>)
Player fetches /api/playback-token → RS256 JWT (lib/mux-token.ts)
        │
        ▼
<MediaController>
  <MuxVideo slot="media" playbackId tokens={{ playback }} />
  <!-- custom chrome (media-chrome React primitives) -->
</MediaController>
```

`passthrough` carries the episode id through Mux → webhook → our DB without needing an extra column. Webhook uses `mux.webhooks.unwrap(body, headers, secret)` for signature verification.

**Caveat**: existing assets uploaded before the policy switch have **public** playback IDs and play without a token. Re-upload to gate them — or run `pnpm backfill:mux-policy` if the script applies.

## Player architecture

The watch surface uses **headless `<mux-video>` + media-chrome** for full visual control. `@mux/mux-player-react` is retained only for the auto-playing hero preview on `/`.

**File layout:**
- `components/watch/watch-shell.tsx` — fullscreen black canvas, cursor auto-hide on idle. No max-width; player sizes itself.
- `components/watch/player.tsx` — split into two components in one file:
  - **`Player` (outer)** — owns state that should survive episode swaps: `currentEpisodeId`, overlay visibility, lock toggle, and the `swap` callback that updates the URL.
  - **`EpisodePlayback` (inner, `key={current.id}`)** — owns per-episode state: token, expiresAt, paywall, aspect ratio, captions detection, skip-intro chip, last-saved position. The `key` prop is what makes this work: every episode swap unmounts and remounts the inner, so all per-episode state resets to its initial value naturally. This pattern is required by React 19's `react-hooks/set-state-in-effect` rule — see [gotchas → React 19 hooks rules](./gotchas.md#react-19-hooks-rules).
- `components/watch/episodes-overlay.tsx` — season-grouped episode picker. Portal'd to `document.body` (see [gotchas → media-chrome overlays](./gotchas.md#media-chrome)). Uses `useSyncExternalStore` for an SSR-safe "are we on the client" check (not `useState + useEffect(setMounted)` — see gotchas).
- `components/watch/up-next-overlay.tsx` — bottom-right slide-in card with 7-second auto-advance. Same `useSyncExternalStore` SSR pattern.
- `components/watch/paywall.tsx` — soft-sidekick bottom sheet shown on trial expiry / token 403.

**Chrome layout (all positioned relative to `MediaController`):**
- Top scrim — back button, `S<n>·E<n>` mono kicker, show — title, AirPlay, captions, quality menu trigger
- Center — `MediaSeekBackwardButton` (10s) / `MediaPlayButton` (72px frosted disc) / `MediaSeekForwardButton` (10s)
- Bottom — `MediaTimeRange` (red bar, halo thumb), `MediaTimeDisplay` × 2, mute, lock, playback rate, Episodes, Up Next, gear (quality), fullscreen
- Skip-intro chip (bottom-right) — visible only when `currentTime ∈ [intro_start, intro_end]`
- Quality menu — `<MediaRenditionMenu anchor="auto">`, pinned at `right-5 bottom-[92px]` so it can't be clipped by the player edge

**Chrome auto-hide:** driven by media-chrome's `media-ui-inactive` attribute on `<media-controller>`. Tailwind selectors target it: `group-[[media-ui-inactive]]/player:opacity-0`.

**Aspect ratio:** read off the underlying `<video>` element on `loadedmetadata`. Defaults to 16:9 until metadata arrives (~200ms flash on first frame). Applied to `MediaController` as `aspectRatio` plus `maxWidth: min(100vw, calc(100vh * <ratio>))` so portrait assets fill phone portrait viewports instead of being letterboxed into a 16:9 rectangle. Reset on episode swap.

**Episode swap (`?ep=<id>` URL sync):**

1. User clicks Episodes → overlay shows season-grouped list with real Mux thumbnails.
2. Selecting an episode → outer `Player` calls `setCurrentEpisodeId(id)` + closes overlay + `router.replace(?ep=<id>, { scroll: false })`. `?resume=` is stripped on swap so stale offsets don't replay.
3. The outer's `current.id` flips → the inner `EpisodePlayback` (keyed on `current.id`) unmounts and remounts. Token state, paywall flag, aspect ratio, caption detection, skip-intro chip, and last-saved position all start fresh — no manual resets in effect bodies.
4. The new inner's token-fetch effect fires on mount → pulls a JWT for the new episode. During the fetch the inner renders the "Loading" splash (`token === null`).
5. Subscriber: cross-session resume from `watch_progress` only applies to the initial episode (server-rendered); subsequent swaps start from 0 by design.
6. Trial: `trial_sessions` is keyed at the show level, so any episode in the show plays during the active trial window.

The downside of the keyed-remount pattern is a brief Loading splash on every swap (the `<MediaController>` + `<MuxVideo>` are torn down and rebuilt rather than reusing the same element with a new `playbackId`). The trade-off is that React 19's hook-rule lint passes cleanly and the per-episode state model stays simple — no `useEffect(() => setX(initial), [current.id])` reset patterns.

**Up Next:** the `<MuxVideo onEnded>` handler saves completion to progress and, if a next episode exists in the `episodes` list, sets `overlay="upnext"`. The card shows the next episode poster + label + 7-second countdown progress bar; **Watch now** swaps immediately, **Cancel** dismisses.

**Skip intro:** Player watches `timeupdate` and toggles a `showSkipIntro` state when `currentTime ∈ [intro_start, intro_end]`. Click → `video.currentTime = intro_end`. Markers are set in the admin episode-edit form (admin/shows/[id]/seasons/[seasonId]/episodes/[episodeId]) — both blank ⇒ chip hidden.

**Quality picker:** `<MediaRenditionMenuButton>` + `<MediaRenditionMenu>` from `media-chrome/react/menu`. The menu auto-populates from the active stream's HLS renditions (Auto + each variant) and dispatches `mediaratechangerequest` to lock to a level. Themed via `--media-menu-*` CSS variables on `MediaController`.

**Lock toggle:** sets a `locked` boolean; all chrome layers get `!opacity-0 !pointer-events-none` and a single "🔒 Tap to unlock" pill renders center. Tap unlocks.

**Token expiry:** subscriber gets a fresh 1h token via re-fetch; trial gets 403 → `videoRef.current.pause()` + `paywall=true`. This is what stops buffered-ahead chunks from running past the trial cutoff.

## Mux thumbnail signing

`lib/mux-token.ts` exposes both signers:

```ts
signMuxPlaybackToken(playbackId, ttl)   // aud='v' (video)
signMuxThumbnailToken(playbackId, ttl)  // aud='t' (image)
```

Plus a `muxThumbnailUrl(playbackId, policy, opts)` helper that builds `https://image.mux.com/<id>/thumbnail.jpg?width=…&height=…&fit_mode=smartcrop[&token=<jwt>]`. Token is included only when the asset's `mux_playback_policy === "signed"`. TTL is 1h — long enough for typical sessions, short enough to avoid leaking long-lived URLs.

Consumed by: episodes overlay, up-next card, public show-detail episode rows. All pre-computed server-side in the route handlers / page components.

## Admin analytics

`app/admin/analytics/page.tsx` is a server component that fires eight parallel Drizzle queries via `Promise.all`:

- Users: total + 30-day count
- Active subscriptions by plan (for MRR + active count)
- Cancellations in the last 30 days (for churn approximation)
- Trials started in the last 30 days + how many converted
- Top 10 shows by `SUM(watch_progress.position_seconds)` joined episodes → seasons → shows
- Daily signup buckets (`TO_CHAR(... AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)

Rendered as metric cards + a 30-bar histogram + a normalized horizontal bar list. No Recharts dep — Tailwind/CSS only.

Approximations called out in code comments:
- Churn = cancellations / (cancellations + still-active). True churn needs a snapshot of "active at start of window," which we don't maintain.
- Watch time = sum of last-known position; doesn't account for repeat watching.

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
- `app/admin/` — admin panel (own `layout.tsx`). Pages: `/`, `shows/new`, `shows/[id]`, `shows/[id]/seasons/[seasonId]`, `shows/[id]/seasons/[seasonId]/episodes/[episodeId]`, `analytics`
- `app/watch/[showSlug]/` — public + cookie-managed. Accepts `?ep=<id>` to start on a specific episode, `?resume=<seconds>` for cross-session resume.
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
