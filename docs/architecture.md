# Architecture

How the pieces fit together. Sibling docs: [services](./services.md), [operations](./operations.md), [gotchas](./gotchas.md). For the original product spec see `PROJECT.md` (build phases, gotchas, timeline).

## Request flow at a glance

```
Browser ──► proxy.ts (clerkMiddleware) ──► (gate check) ──► Page / Route Handler
                │                                              │
                ├── /admin/*    : Clerk userId + users.role     ├── Server Component
                │                = "admin" (DB lookup, 5s       │   – reads cookies()
                │                module-cached); anonymous →    │   – calls db / Clerk
                │                redirectToSignIn               │   – returns JSX
                ├── /subscribe/*: Clerk userId; anonymous →     │
                │                redirectToSignUp (paywall      │
                │                conversion path defaults to    │
                │                creating an account)           │
                └── everything else: passes through             │
                                                                └── Server Action
                                                                    – "use server"
                                                                    – requireAdmin() etc.
                                                                    – mutates DB
                                                                    – revalidatePath
                                                                    – redirect
```

Server components can **read** cookies but cannot set them — that's why the `trial_session` cookie is issued by the `/api/playback-token` route handler (which is also the gate that verifies the show is real + published + ready before persisting any state). See [gotchas](./gotchas.md#nextjs-cookie-rules).

## Data model

Schemas live in `db/schema/`, one file per logical domain (CLAUDE.md convention). All DB access is through Drizzle — never raw SQL except inside migrations.

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Clerk-id-keyed mirror of Clerk users | `id` (Clerk user id, PK), `email`, `role` (`user`\|`admin`), `stripe_customer_id` |
| `subscriptions` | Stripe-mirrored subscription state | `user_id`, `stripe_subscription_id`, `status`, `plan`, `current_period_end`, `cancel_at_period_end`, `created_at` (independent of `updated_at` so churn analytics don't drift on later webhook updates) |
| `stripe_events` | Webhook idempotency log | `event_id` (PK, the Stripe event id) — claimed via INSERT … ON CONFLICT DO NOTHING before the handler runs; conflicts return 200 OK with no work. Rolled back (DELETE) on handler exception so Stripe's retry can re-attempt |
| `shows` | The catalog | `slug` (unique), `genre[]`, `status` (`draft`\|`published`), `deleted_at` (soft-delete) |
| `seasons` | Season per show | `(show_id, number)` unique |
| `episodes` | Episode with Mux linkage | `mux_asset_id`, `mux_playback_id`, `mux_playback_policy` (`public`\|`signed`), `status` (`processing`\|`ready`\|`errored`), `intro_start_seconds` + `intro_end_seconds` (nullable; drive the "Skip intro" chip), `(season_id, number)` unique |
| `trial_sessions` | Anonymous-first 60s trial | `(session_token, show_id)` unique, `expires_at`, `user_id` (nullable, set on signup), `converted`, `last_position_seconds`, `ip_hash` (HMAC-SHA256 of `x-vercel-forwarded-for`; drives per-(IP, show) trial rate-limit), `attribution_{first,last}_{source,medium,campaign}` (UTM snapshot at row creation) |
| `watch_progress` | Per-user, per-episode resume position | `(user_id, episode_id)` unique |

Attribution columns (`attribution_first_*` / `attribution_last_*` triples) also live on `users` (stamped at `/subscribe` render) and `subscriptions` (stamped at Stripe Checkout creation via metadata, never overwritten on renewal). See [Campaign attribution](#campaign-attribution).

FK cascade defaults: deleting a `show` removes its `seasons` → `episodes` → `trial_sessions` (via FK CASCADE). `users.id` cascades into `subscriptions` and `watch_progress`; nulls out `trial_sessions.user_id`.

Hot-path indexes (migration 0010): `subscriptions(user_id, updated_at DESC)` for AlreadySubscribed / history reads, `watch_progress(episode_id)` for the episodes→progress join in admin analytics, `trial_sessions(show_id)` + `trial_sessions(user_id)` for cascade deletes + signup linking. Postgres doesn't auto-index FK columns; without these, every hot read does a sequential scan at scale.

## Auth model

- Clerk owns identity + sessions.
- `users` table mirrors Clerk via `user.created` webhook (`app/api/webhooks/clerk/route.ts`) — handler is idempotent (`onConflictDoNothing` on `users.id`).
- `users.role` is the **only** source of truth for admin — never Clerk metadata alone.
- Clerk's hosted UI (sign-in modal, sign-up modal, UserButton dropdown, validation copy) is localized to match the site dictionary via `ClerkProvider`'s `localization` prop in `app/layout.tsx` — `esES` by default, `enUS` when the locale cookie flips. Adding a locale to the site = also add its `@clerk/localizations` bundle to the `CLERK_LOCALIZATIONS` map.
- `proxy.ts` is the first line of defense; pages/actions use `lib/admin.ts` helpers as belt-and-braces:
  - `getCurrentUser()` — pure read, returns the local row or `null`. Use for pages that can tolerate a missing mirror (e.g. analytics-only callsites).
  - `getOrSyncCurrentUser()` — read-or-upsert from `currentUser()` if the local row is missing. Use anywhere a missing mirror would block the user from making progress (e.g. `/subscribe` page render before `linkTrialSessionsToCurrentUser`, `startCheckout` server action, `/api/billing-portal` route). Closes the race where a brand-new signup hits these surfaces before the `user.created` webhook lands.
  - `getCurrentAdmin()` / `requireAdmin()` — role-gated variants for admin pages and actions.
- `users.email` is required because the promote-to-admin script and Stripe customer lookups both rely on it.

## Trial system (the most subtle piece)

End-to-end:

1. **Visiting `/watch/<slug>`** (`app/watch/[showSlug]/page.tsx`):
   - The show must be `status='published' AND deleted_at IS NULL`, else `notFound()`.
   - Signed-in + active subscription → render Player in `subscriber` mode.
   - Else: read the `trial_session` cookie (may be absent). `findTrialSession(cookie, show.id)` is a **read-only** lookup that returns the row if one exists for this (cookie, show).
     - Row found and `now > expires_at` → redirect to `/subscribe?show=<slug>&resume=<last_position_seconds>`. `resume` is only included when the row hasn't yet `converted` — for a former subscriber, the trial offset is stale.
     - Row found and active, OR no row yet → render Player in `trial` mode. The trial 60-second clock has **not** started — it begins when the player actually requests a token.
   - **Not** a shortcut: `trial.converted = true` does **not** grant subscriber-mode rendering. Access for converted-and-still-paying users is granted via the active-subscription lookup above; converted-but-canceled users get the same trial-expired flow as any anonymous visitor.
2. **Player mounts** (`components/watch/player.tsx`):
   - Outer `Player` picks the initial episode; the inner `EpisodePlayback` (keyed on `current.id`) does the actual playback work.
   - Inner fetches `/api/playback-token?episode_id=<id>` on mount with an `AbortController` guard — checks `typeof AbortController !== 'undefined'` and falls back to a `cancelled` flag for iOS < 12.2 (see [gotchas → AbortController](./gotchas.md#abortcontroller-ios-122)). Cancels in-flight on episode swap so a slow response can't race the new fetch. Captures `token` + `expiresIn`, sets `expiresAt = Date.now() + expiresIn*1000`.
   - Renders `<MediaController>` + `<MuxVideo slot="media" playbackId tokens={{ playback }} />` (headless mux-video + media-chrome — not `@mux/mux-player-react`).
   - `setTimeout((expiresAt - now) - 60_000)` fires **60s before** expiry → re-fetches token. Early rotation is required because Mux validates the JWT `exp` per-segment-request — a refresh at the boundary races segments that go out a hair late. 5xx and network errors retry with exponential backoff (1s/2s/4s, 4 attempts total) before falling through to the `unavailable` end-state; the existing token keeps playing through the retry window so a transient network blip doesn't black out the player. Non-success responses are still classified into distinct end-states via `classifyTokenStatus(r.status)`:
     - **403** → `Paywall` overlay (trial preview ended naturally — "Sign up to keep watching"). Trial users land here at the natural expiry.
     - **429** → `RateLimitedNotice` overlay (trial cap hit for this network — "Too many previews this hour", still offers subscribe)
     - **5xx / network / JSON parse failure / `<video>` decode error** → `PlaybackUnavailable` overlay with a retry button; the retry bumps `fetchKey` so the token-fetch effect re-runs without unmounting the controller
   - On the trial 403 (paywall), `videoRef.current.pause()` is called alongside the end-state flip so the buffered-ahead Mux stream stops at the cutoff. The refresh path no longer calls `pause()` on transient 5xx — the existing token may still have headroom.
   - The `<video>` `onError` handler uses a rolling 10-second / 3-error window before flipping to `PlaybackUnavailable`. `MediaError.code` 3 (`MEDIA_ERR_DECODE`) and 4 (`MEDIA_ERR_SRC_NOT_SUPPORTED`) flip immediately; code 1 (`MEDIA_ERR_ABORTED`) is ignored; code 2 (`MEDIA_ERR_NETWORK`) counts toward the threshold but lets Mux/HLS retry first. A single rendition-switch hiccup on cellular previously killed the player permanently.
   - Every 10s **while visible and playing**, writes `last_position_seconds` (trial → `trial_sessions`) or `watch_progress` (subscriber). The interval is gated on `document.visibilityState === "visible"` and a final flush fires on `visibilitychange` (hide) and `pagehide` — without it, mobile users lost up to 10s every time they backgrounded the app. Both writes clamp the position to `[0, 24h]` server-side; the trial path additionally verifies the episode is `status='ready'` on a `published`, non-deleted show.
3. **Token endpoint** (`app/api/playback-token/route.ts`) — this is the actual gate. The handler:
   - Joins episode → season → show and filters on `episodes.status='ready' AND shows.status='published' AND shows.deleted_at IS NULL`. A leaked draft episode id returns 404 here, regardless of any cookie.
   - Signed-in user with `subscriptions.status='active'` → 1h subscriber JWT.
   - Otherwise enters the trial path:
     - Reads the `trial_session` cookie (may be absent — that's normal for a first-time visitor since proxy.ts no longer mints it).
     - If a trial row exists for (cookie, show) and `remaining > 0` → JWT with `ttl = min(remaining, TRIAL_DURATION_SECONDS)`.
     - If a trial row exists and is expired → 403 (no re-trial on the same cookie/show).
     - If no row yet → `mintTrialSession({ sessionToken, showId, ipHash })`: enforces a per-(`ip_hash`, `show_id`) cap of `TRIAL_RATELIMIT_PER_HOUR = 3` trial creations / hour, inserts the row, sets the `trial_session` cookie if it was missing, and returns the JWT. Cap exceeded → 429.
4. **IP rate-limit details**:
   - `hashClientIp(ip)` returns `HMAC-SHA256(MUX_SIGNING_KEY_PRIVATE_KEY, ip)` so the bucket is stable across requests but unrecoverable without the Mux signing key (no raw IPs in the DB).
   - Client IP is sourced **only** from `x-vercel-forwarded-for` — Vercel sets it to a single, untainted client IP. The standard `x-forwarded-for` is appended-to (not replaced) at the edge, so its leftmost entry is whatever the client sent; using it let an attacker rotate IPs by varying the header. If the trusted header is missing (e.g. local dev), the bucket key falls back to a constant `"unknown"`, which puts all unidentified requests into one shared bucket — fail-CLOSED under abuse, painless in dev.
   - The cap is **per-(IP, show)** — a household watching a different show on the same IP isn't disrupted.
   - 429 responses include `Retry-After: 3600` and a generic body (no "from this network" framing — no need to confirm to an adversary that they hit a per-network bucket).
5. **Conversion linking**:
   - **Page-level** (primary): `/subscribe` server component runs `linkTrialSessionsToCurrentUser()` on render — claims any trial rows with the user's cookie that have `user_id IS NULL`. Catches the common case (user comes from trial → Subscribe → signup → back to /subscribe).
   - **Stripe webhook**: when `customer.subscription.*` lands with active/trialing status, `markUserTrialsConverted(user.id)` flips `converted=true` on all the user's trial rows. This is an **analytics-only** marker (powers the trial→paid metric on the admin dashboard). It does not affect playback — gating is purely based on `subscriptions.status='active'` and the trial expiry timestamp.

Constants in `lib/trial.ts`: `TRIAL_DURATION_SECONDS = 60`, `TRIAL_RATELIMIT_PER_HOUR = 3`. `/api/playback-token` imports the duration as `TRIAL_TTL_CAP` so the JWT can never outlive the row.

## Playback pipeline

```
Admin uploads via @mux/upchunk (components/admin/upload-widget.tsx)
        │
        ▼ (Server Action createMuxUpload)
mux.video.uploads.create({ playback_policies: ["signed"], passthrough: episode.id })
        │  (no DB writes here — see "re-upload safety" below)
        ▼ (browser uploads chunks directly to Mux)
upchunk fires `success` → client calls markEpisodeReprocessing(episodeId)
        │
        ▼ (DB: status="processing", mux_asset_id=NULL, mux_playback_id=NULL, …)
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

**Re-upload safety**: `createMuxUpload` deliberately doesn't touch the episode row — it only mints the upload URL. The DB clearing happens in `markEpisodeReprocessing`, which the upload widget calls **after** upchunk's `success` event fires (i.e., the browser → Mux upload has actually completed). Previously `createMuxUpload` cleared playback fields preemptively, which meant a cancelled mid-upload left the row stuck in `status='processing'` with no path back: the Mux webhook's `resolveEpisodeFromPassthrough` refuses to overwrite a different existing `mux_asset_id` (anti-spoofing — see [gotchas → Mux SDK](./gotchas.md#mux-sdk-14)), so no later upload could rescue it. With the clear-on-success ordering, a cancelled upload simply leaves the previous asset live.

**Caveat**: existing assets uploaded before the policy switch have **public** playback IDs and play without a token. Re-upload to gate them — or run `pnpm backfill:mux-policy` if the script applies.

## Player architecture

The watch surface uses **headless `<mux-video>` + media-chrome** for full visual control. `@mux/mux-player-react` is retained only for the auto-playing hero preview on `/`.

**File layout:**
- `components/watch/watch-shell.tsx` — fullscreen black canvas, cursor auto-hide on idle (`mousemove`/`mousedown`/`touchstart` listeners throttled via `requestAnimationFrame` to avoid re-rendering on every pixel of mouse movement). No max-width; player sizes itself.
- `components/watch/player.tsx` — split into two components in one file:
  - **`Player` (outer)** — owns state that should survive episode swaps: `currentEpisodeId`, overlay visibility, lock toggle, and the `swap` callback that updates the URL.
  - **`EpisodePlayback` (inner, `key={current.id}`)** — owns per-episode state: token, expiresAt, paywall, aspect ratio, captions detection, skip-intro chip, last-saved position. The `key` prop is what makes this work: every episode swap unmounts and remounts the inner, so all per-episode state resets to its initial value naturally. This pattern is required by React 19's `react-hooks/set-state-in-effect` rule — see [gotchas → React 19 hooks rules](./gotchas.md#react-19-hooks-rules).
  - **Overlays are `next/dynamic` imports** (`ssr: false`): `Paywall`, `PlaybackUnavailable`, `RateLimitedNotice`, `EpisodesOverlay`, and `UpNextOverlay` are all loaded via `next/dynamic` with `ssr: false`. This keeps ~30KB+ of overlay code (and their transitive deps) out of the initial player bundle — none of these render on first paint. The dynamic boundary also means their portal'd `document.body` references are safe without the `useSyncExternalStore` mounted guard at the import site.
- `components/watch/episodes-overlay.tsx` — season-grouped episode picker. Portal'd to `document.body` (see [gotchas → media-chrome overlays](./gotchas.md#media-chrome)). Uses `useSyncExternalStore` for an SSR-safe "are we on the client" check (not `useState + useEffect(setMounted)` — see gotchas). Has a manual focus trap: close button receives initial focus, Tab/Shift+Tab cycle within the dialog, Escape dismisses.
- `components/watch/up-next-overlay.tsx` — bottom-right slide-in card with 7-second auto-advance. Same `useSyncExternalStore` SSR pattern. Renders as `role="dialog" aria-modal="true"` with Escape-to-dismiss. The countdown text has `aria-live="polite" aria-atomic="true"` so screen readers announce the remaining seconds. "Watch now" button receives initial focus.
- `components/watch/paywall.tsx` — bottom-sheet overlay shown on trial 403. Leads with **sign-up**, not plan selection: primary CTA is Clerk's `<SignUpButton mode="modal" forceRedirectUrl="/subscribe?show=…&resume=…">`. Signed-in non-subscribers (rare — paid → canceled → returned) get a direct `<Link>` to `/subscribe` instead. A secondary "Already have an account? Sign in" link uses `<SignInButton>` with matching redirect. Plan picking happens after signup, on `/subscribe` — two decisions ("which plan?" + "make an account?") at the same in-player moment was decision overload.
- `components/watch/playback-status.tsx` — `RateLimitedNotice` (429) and `PlaybackUnavailable` (5xx / network / video decode) overlays. Same visual idiom as `Paywall` but reserved for non-paywall end-states; framing 429 as "Preview ended" was misleading (the user hadn't burned their trial — the IP bucket did).

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

**Token expiry:** refresh fires 60s **before** expiry (not at), so the new JWT installs while the old one still has headroom — Mux validates `exp` per-segment-request and a refresh exactly at the boundary loses the race for any segment going out a hair late. Subscriber gets a fresh 1h token via re-fetch; trial gets 403 → `videoRef.current.pause()` + `endState="paywall"` (this is what stops buffered-ahead chunks from running past the trial cutoff). 5xx/network errors retry with backoff (1s/2s/4s) before flipping to `unavailable` — a brief CDN blip doesn't black out the player. 429 routes to `rateLimited` end-state. The end-state branches use `classifyTokenStatus` to keep infrastructure failures from being framed as a payment issue.

## Mux thumbnail signing

`lib/mux-token.ts` exposes both signers:

```ts
signMuxPlaybackToken(playbackId, ttl)   // aud='v' (video)
signMuxThumbnailToken(playbackId, ttl)  // aud='t' (image)
```

Plus a `muxThumbnailUrl(playbackId, policy, opts)` helper that builds `https://image.mux.com/<id>/thumbnail.jpg?width=…&height=…&fit_mode=smartcrop[&token=<jwt>]`. Token is included only when the asset's `mux_playback_policy === "signed"`. TTL is 1h — long enough for typical sessions, short enough to avoid leaking long-lived URLs.

Consumed by: episodes overlay, up-next card, public show-detail episode rows. All pre-computed server-side in the route handlers / page components.

## Admin mutations

- **Delete confirmations**: all destructive admin actions (soft-delete show, delete season) use `components/admin/confirm-delete-button.tsx` — a client-side `<Button variant="destructive">` that calls `window.confirm(message)` before allowing the form submit. Prevents one-click data loss in the admin panel.
- **`softDeleteShow` revalidation**: the action revalidates both `/admin` (the show list) and `/` (the public catalog) so the soft-deleted show disappears from the homepage immediately, not just the admin panel.

## Admin analytics

`app/admin/analytics/page.tsx` is a server component that fires fourteen parallel Drizzle queries via `Promise.all`:

- Users: total + 30-day count
- Active subscriptions by plan (for MRR + active count)
- Cancellations in the last 30 days (for churn approximation)
- Trials started in the last 30 days + how many converted
- Top 10 shows by `SUM(watch_progress.position_seconds)` joined episodes → seasons → shows
- Daily signup buckets (`TO_CHAR(... AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
- Per-campaign first-touch breakdown: trials (30d) + signups (30d) + active subs by plan, each grouped by `(attribution_first_source, attribution_first_medium, attribution_first_campaign)`
- Per-campaign last-touch breakdown: same three queries, grouped by `attribution_last_*` columns

Rendered as metric cards + a 30-bar histogram + a normalized horizontal bar list + two side-by-side campaign tables (first-touch default, last-touch reconciliation view). Each campaign table merges its three group-by queries in JS on the key `${source}|${medium}|${campaign}`, sorts by MRR DESC then trials DESC, and collapses all-NULL rows into a single `(direct)` bucket so organic traffic stays grouped. No Recharts dep — Tailwind/CSS only.

An **Engagement** section adds completion rate, avg % watched, avg watched-per-viewer, and trial preview depth, plus per-show viewers + completion folded into the top-shows list. These come off the existing `watch_progress` / `trial_sessions` columns and are **approximate** — `position_seconds` is the last-saved resume playhead, not cumulative watch time, so a rewatch or a scrub-back understates it.

A separate **"Watch time · Mux Data"** panel carries the *real* numbers — total watch time, views, unique viewers, avg view, and a per-show breakdown — from `getMuxData()` (see [Mux Data](#marketing--analytics-measurement-meta-pixel--conversions-api--mux-data)). It degrades to a "not configured" hint when the Mux Data API token env vars aren't set, so the rest of the dashboard still renders.

Approximations called out in code comments:
- Churn = cancellations / (cancellations + still-active). True churn needs a snapshot of "active at start of window," which we don't maintain.
- Watch time (engagement section) = sum of last-known position; doesn't account for repeat watching. The Mux Data panel is the authoritative cut.
- First-touch attribution on users only captures the first authenticated touch where UTM cookies were present (specifically the `/subscribe` page render). A user who signs up via the header on `/` and never visits `/subscribe` stays NULL — they don't appear in conversion attribution because they're not paid users anyway.

## Campaign attribution

`lib/attribution.ts` owns the UTM capture + persistence flow. The pipeline:

```
Ad landing  ──►  proxy.ts  ──►  sets two cookies (iff cookie_consent.marketing=true):
?utm_source         (any non-admin route)        attribution_first  (90d, write-if-absent)
?utm_medium                                      attribution_last   (30d, overwrite)
?utm_campaign
        │
        │ (subset captured: only source/medium/campaign — utm_term/content
        │  skipped to keep cookies <200B and schema lean)
        ▼
Funnel touchpoints snapshot the cookies into nullable text cols:

  • mintTrialSession (lib/trial.ts)
      → trial_sessions.attribution_{first,last}_{source,medium,campaign}
      at row creation (first play of this show on this cookie)

  • applyUserAttribution (lib/attribution.ts) — called from /subscribe page render
      → users.attribution_first_*   (idempotent: WHERE all three first-touch
                                     cols are still NULL, so partial UTMs
                                     don't half-overwrite)
      → users.attribution_last_*    (COALESCE per-column, so a partial UTM
                                     landing doesn't NULL out previously
                                     captured fields)

  • startCheckout (app/subscribe/actions.ts)
      → Stripe Checkout subscription_data.metadata
        (flattened to six string keys via toStripeMetadata — Stripe metadata
         is string-only and capped at 50 keys × 500 chars per value)

  • Stripe webhook mirrorSubscription
      → subscriptions.attribution_{first,last}_{source,medium,campaign}
        on INSERT. The .onConflictDoUpdate set clause deliberately omits
        these columns: a customer.subscription.updated landing months
        later (renewal, status change, cancellation) carries no UTM
        metadata, so updating would silently erase the original
        conversion attribution. New row writes only.
```

Why first-touch + last-touch both: they answer different questions.

- **First-touch** = "which campaign opened the relationship". Right default for a delayed-conversion product like Matio (60s trial → leave → come back later → subscribe). Last-touch would over-credit retargeting and branded search for users your awareness campaign actually brought in.
- **Last-touch** = "what Meta/Google report as the conversion source". Used for reconciling with ad-platform dashboards.

Storing both costs six extra nullable TEXT columns × three tables. Effectively free, removes the "which model did we pick?" debate, lets the dashboard show the two side-by-side.

The `(direct)` bucket on the campaign tables collapses **all-NULL** rows — i.e. organic traffic, direct visits, pre-attribution-feature users. A row where only `utm_source` is set (e.g. `?utm_source=twitter` linked from a tweet without a campaign label) keeps its own row keyed on `("twitter", null, null)` — it's not collapsed into direct, because it does carry attribution signal.

**UTM normalization** (`lib/utm.ts`): `normalizeUtm(value)` trims, lowercases, and strips every char outside `[a-z0-9_-]`. `lib/attribution.ts`'s `clean()` runs every value through it (after the 100-char cap), so normalized UTMs flow into both attribution cookies, all three tables' `attribution_*` columns, and the Stripe metadata. This stops Meta- and human-mangled `utm_campaign` values from fragmenting the breakdown tables — case drift (`TikTok` vs `tiktok`), encoded spaces, and stray junk (a leaked `>` would split `campaign_1` into `campaign_1>`) all collapse to one row. Numeric Meta `{{campaign.id}}` values pass through unchanged. App-side normalization is **forward-only** (it can't retro-fix rows written before the change); the same transform is mirrored in the PostHog funnel breakdown (see [Funnel analytics](#funnel-analytics-posthog)), where a HogQL expression normalizes history at query time.

## Marketing & analytics measurement (Meta Pixel + Conversions API + Mux Data)

Three measurement channels feed the funnel, all gated on `cookie_consent.marketing`: the **Meta Pixel** (browser-side conversion events), the **Meta Conversions API** (server-side Purchase, fired from the Stripe webhook), and **Mux Data** (player QoE + watch-time analytics, surfaced both in the Mux dashboard and an in-admin panel). No DB migration was needed for any of it — CAPI match-identity rides Stripe metadata, and the in-admin engagement metrics come off existing columns.

### Browser pixel (`components/site/meta-pixel.tsx` + `lib/meta-pixel-events.ts`)

`<MetaPixel>` is mounted in `app/layout.tsx` next to `<CookieBanner>` and is **consent-gated** — it does not inject `fbevents.js` at all until marketing consent is present. On the consent change it grants/revokes Meta's own consent state symmetrically (`fbq('consent', 'grant'|'revoke')`). It fires `PageView` on init and again on every SPA route change (App Router navigations don't reload the page, so the auto-injected snippet would otherwise only count the first view).

`lib/meta-pixel-events.ts` is the thin client wrapper: `trackPixel(event, params?, { eventID }?)` no-ops until `fbq` is loaded, and `onPixelReady(cb)` defers any mount-time event until the pixel is live (so a `ViewContent`/`CompleteRegistration` fired during initial render isn't dropped). It also owns the shared constants — `META_PIXEL_ID`, `META_PIXEL_IDS`, `MEMBERSHIP_VALUE = 38` / `MEMBERSHIP_CURRENCY = USD`, and `PIXEL_READY_EVENT`.

**Multiple browser pixels**: `META_PIXEL_IDS` is the primary `NEXT_PUBLIC_META_PIXEL_ID` plus any comma-separated extras in `NEXT_PUBLIC_META_PIXEL_IDS`. `<MetaPixel>` runs one `fbq('init', …)` per id and renders one `<noscript>` tracking img per id. Every call site stays unchanged — `fbq('track', …)` with no pixel-id argument fans out to *all* initialized pixels — so adding a second ad account is purely an env change. Still consent-gated.

The five **browser events**:

| Event | Where | Notes |
|---|---|---|
| `PageView` | all pages + every SPA nav | fired by `<MetaPixel>` |
| `ViewContent` | `/shows/[slug]` | `components/site/view-content-pixel.tsx` |
| `Lead` | 60s trial start | `components/watch/player.tsx`, once per show-preview when a trial-mode token is issued |
| `InitiateCheckout` | `/subscribe` submit | `app/subscribe/submit-button.tsx` on click |
| `CompleteRegistration` | `/subscribe` | `components/site/complete-registration-pixel.tsx`, deduped once-per-user via `localStorage` |

### Server-side Purchase via Conversions API (`lib/meta-capi.ts`)

The `Purchase` conversion is fired **server-side from the Stripe webhook**, not from the browser. This is deliberate: the browser moment is unreliable for the money event — the user is bounced through Stripe-hosted Checkout and Clerk redirects, ad-blockers strip `fbevents.js`, and the success-page may never render if the tab is closed during the redirect. The webhook, by contrast, is the same source of truth that flips the subscription to active, so the Purchase fires exactly when (and only when) money actually moved.

`sendCapiEvents(events)` in `lib/meta-capi.ts` (server-only) is a plain `fetch` to `https://graph.facebook.com/<v>/<pixelId>/events`, authed via the access token as a query param, with a 3s `AbortController` timeout. `GRAPH_API_VERSION` defaults to `v21.0` (override `META_GRAPH_API_VERSION`). It **never throws** — it returns `{ ok, skipped?, error? }` and no-ops entirely if the env isn't set. That contract matters: the CAPI call runs inside the Stripe webhook handler, and a thrown error there would roll back the `stripe_events.event_id` idempotency claim and make Stripe retry an event we already processed. A failed Meta send is best-effort and swallowed.

**Multi-pixel fan-out**: `sendCapiEvents` posts the events to *every* pixel that has its own server token, in parallel — the primary (`NEXT_PUBLIC_META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN`) plus each extra in `NEXT_PUBLIC_META_PIXEL_IDS` paired with its positional token `META_CAPI_ACCESS_TOKEN_{n}` (2-based, so the first extra id reads `META_CAPI_ACCESS_TOKEN_2`). Each send keeps the same never-throws / 3s-bounded / no-op-if-unset contract independently, and the webhook caller is unchanged. An extra pixel listed in `NEXT_PUBLIC_META_PIXEL_IDS` *without* a matching token stays browser-only — it gets the browser pixel but no server Purchase.

In `app/api/webhooks/stripe/route.ts` the Purchase fires on the **transition into** an access-granting status. `becameAccessGranting` is derived from the *same* `ACCESS_GRANTING_STATUSES` set as the `priorWasAccessGranting` read — so a subscription whose first mirrored status is `past_due` (Stripe mid-retry on the opening invoice) still fires Purchase rather than being silently skipped. The CAPI call is made **before** `markUserTrialsConverted`: if it ran after and a transient DB error hit on Stripe's retry, the prior row could already read as access-granting, permanently suppressing the Purchase. Dedup is `event_id = sub.id`, the user select is widened to include `email`, and the whole thing is wrapped in best-effort try/catch.

### Carrying match-identity to a context-less webhook (`lib/capi-identity.ts`)

A webhook has **no end-user browser context** — no `_fbp`/`_fbc` cookies, no client IP, no user-agent. Meta's match quality depends on exactly those signals, so they're captured at Checkout time and carried forward through Stripe metadata. `lib/capi-identity.ts` (server-only):

- `readCapiIdentity()` reads the `_fbp`/`_fbc` cookies (`FBP_COOKIE`/`FBC_COOKIE`), the client IP (`x-vercel-forwarded-for`), and the user-agent.
- `toCapiMetadata()` / `fromCapiMetadata()` flatten that identity through Stripe metadata under `capi_*` keys, including a `capi_consent="1"` sentinel; `metadataHasCapiConsent()` checks it.
- `buildFbc(fbclid, nowMs)` constructs the `_fbc` value from a `?fbclid` param; `hashEmail`/`hashExternalId` (in `lib/meta-capi.ts`) SHA-256 the email + external id Meta requires hashed.

`startCheckout` (`app/subscribe/actions.ts`) merges `toCapiMetadata(readCapiIdentity())` into `subscription_data.metadata`, gated on `hasMarketingConsent` — so the identity (and the `capi_consent` sentinel) is only written with consent. `mirrorSubscription` in the webhook reads it back via `fromCapiMetadata`, and the Purchase only fires when `metadataHasCapiConsent(sub.metadata)` is true. Net effect: CAPI consent is decided at the browser, persisted into Stripe, and honored at the webhook — no consent state needs to survive the redirect on its own.

### Mux Data (player beacons + in-admin API panel)

Two halves. **(1) Player beacons:** `components/watch/player.tsx` (`player_name="matio-watch"`) and `components/site/hero-banner.tsx` (`player_name="matio-hero"`) feed Mux Data via `envKey` on the underlying player, with `metadata` carrying `video_id` / `video_title` / `video_series`. Mux Data fires beacons **by default on player mount even with no env key** (orphaned to litix.io) and pre-consent — so both players pass `disableTracking` + `disableCookies` until `useMarketingConsent()` is true *and* `NEXT_PUBLIC_MUX_DATA_ENV_KEY` is set. That closed the pre-consent leak (including the autoplay home hero). `lib/use-marketing-consent.ts` is the live cookie hook — it tracks `cookie_consent.marketing` via `CONSENT_CHANGED_EVENT` with a lazy `useState` initializer (SSR-safe, no setState-in-effect).

**(2) In-admin panel:** `lib/mux-data.ts` (server-only) `getMuxData(timeframe)` hits the Mux Data API (`api.mux.com/data/v1`, HTTP Basic auth with a "Mux Data: Read" token) for real watch-time. It calls `/metrics/comparison` (totals: `watch_time` / `view_count` / `unique_viewers` / `total_playing_time`, all in **milliseconds**) plus `/metrics/video_startup_time/breakdown?group_by=video_series` for the per-show rows, and excludes the home hero via `filters[]=!player_name:matio-hero`. The fetch is cached server-side 5 minutes (`next.revalidate=300`) — Mux's API is rate-limited at 5 req/s. It's best-effort: returns `{ status: 'ok' | 'not_configured' | 'error' }` so the admin panel degrades to a hint when the token isn't set rather than erroring the page.

### Funnel analytics (PostHog)

**Additive to Meta Pixel/CAPI** — PostHog gives first-party funnel visibility (where visitors drop, which campaigns convert) without depending on Meta's match quality or ad-blocker interference.

- **Consent-gated provider** (`components/site/posthog-provider.tsx`): mirrors the Meta Pixel pattern. Uses `next/dynamic` (dynamic import, no SSR) so the `posthog-js` bundle (~100KB) stays out of the initial HTML. PostHog does not load at all until `cookie_consent.marketing === true`. On consent revoke: `opt_out_capturing()` + `reset()`.
- **Autocapture OFF**. We fire a curated named event set (`lib/posthog-events.ts`): `$pageview` on every App Router route change (the provider handles this — posthog-js's default only fires on full page loads so `capture_pageview: false` is set and we fire manually), `show_viewed`, `trial_play_started`, `paywall_shown`, `signup_cta_clicked`, `signup_completed`, `checkout_started`.
- **`/ingest` reverse proxy** (`next.config.ts` rewrite) routes browser events through the Next.js origin to bypass ad blockers. The path is excluded from the `proxy.ts` Clerk matcher (Clerk runs before Next.js rewrites — without the exclusion it intercepts analytics POSTs as unauthenticated requests).
- **Server-side `subscribe_succeeded`** (`lib/posthog-server.ts`, `posthog-node` client): fired from the Stripe webhook on the transition into an access-granting status, under the same `metadataHasCapiConsent` guard as CAPI. Uses `captureImmediate` (not the default batched `capture`) because serverless functions freeze immediately after the response — a queued event would be silently lost. Keyed to the Clerk user id so it stitches to the browser session.
- **Masked session replay + heatmaps**: `maskAllInputs: true`, `maskTextSelector: "*"`. Enabled in PostHog project settings; no PII recorded in replays.
- **EU Cloud**: PostHog project hosted in the EU region (`eu.i.posthog.com`). `POSTHOG_HOST` (server) points there directly; `NEXT_PUBLIC_POSTHOG_HOST=/ingest` routes browser events via the rewrite. Env vars: `NEXT_PUBLIC_POSTHOG_KEY` (public, build-time inlined — same caveats as `NEXT_PUBLIC_META_PIXEL_ID`), `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_HOST`. All three absent → PostHog fully off, no exceptions.
- **UTM normalization**: the provider passes a `before_send` hook to `posthog.init` that runs `utm_campaign` / `utm_source` / `utm_medium` (the only UTMs posthog-js autocaptures, which also derive the `$initial_utm_*` person props) through the *same* `normalizeUtm` (`lib/utm.ts`) as the app-side attribution `clean()` — so a campaign groups identically in the PostHog funnels and in the in-admin attribution tables. Going forward the events arrive pre-normalized; for already-captured history the funnel-breakdown insights apply the equivalent HogQL `replaceRegexpAll(lower(trim(properties.utm_campaign)), '[^a-z0-9_-]', '')` at query time.
- **"Ads funnel" dashboard** (PostHog EU, dashboard `714865`): paid-traffic funnels for ads that land **directly on the player** `/watch/[slug]` (primary) — insights "Ads funnel — overall" / "by UTM source" / "by UTM campaign" — plus "Ads funnel — /shows landing" for the alt test that lands on `/shows/[slug]` (an extra show→watch step). The two breakdown insights use the normalized HogQL expression above. **Recommended ad-link scheme**: put UTMs in Meta's "URL Parameters" field as `utm_source={{site_source_name}}` / `utm_medium=paid_social` / `utm_campaign=<static lowercase slug>` (never `{{campaign.name}}` — it fragments; real campaigns currently pass the stable-but-opaque `{{campaign.id}}`) / `utm_content={{ad.id}}`.

### Unified consent model

Everything gates on `cookie_consent.marketing`:

- The **Pixel** never injects `fbevents.js` before consent, and grants/revokes Meta consent symmetrically on change.
- **CAPI** fires only when the `capi_consent` sentinel is present — and that sentinel is written at Checkout *only* with consent.
- **Mux Data** passes `disableTracking` + `disableCookies` until consent *and* an env key, so no beacon leaks pre-consent.
- The **`?fbclid` → `_fbc` derivation** in `proxy.ts` is under the same `hasMarketingConsent` gate as attribution (`applyMarketingCookies`, formerly `applyAttributionCookies`).
- On **withdrawal**, `clearMarketingCookies` (`lib/cookie-consent.ts`) clears attribution *and* `_fbp`/`_fbc`. The `_fbp`/`_fbc` clears are issued **both host-only and domain-scoped** (`Domain=.<root>`): `fbevents.js` sets `_fbp` scoped to the registrable domain, and a path-only `document.cookie` expiry only matches a host-only cookie, leaving the domain cookie alive.
- **PostHog** (`components/site/posthog-provider.tsx`) does not load at all pre-consent. On withdrawal, `opt_out_capturing()` + `reset()` are called.

**Env vars**: `NEXT_PUBLIC_META_PIXEL_ID` (public, build-time inlined), optional `NEXT_PUBLIC_META_PIXEL_IDS` (public — comma-separated extra browser pixel ids), `META_CAPI_ACCESS_TOKEN` (secret), optional `META_CAPI_ACCESS_TOKEN_{n}` (secret — positional server token for each extra pixel, 2-based), optional `META_CAPI_TEST_EVENT_CODE` + `META_GRAPH_API_VERSION`, `NEXT_PUBLIC_MUX_DATA_ENV_KEY` (public, build-time inlined — enables player tracking), `MUX_DATA_API_TOKEN_ID` / `MUX_DATA_API_TOKEN_SECRET` (secret — powers the in-admin panel), `NEXT_PUBLIC_POSTHOG_KEY` (public, build-time inlined), `NEXT_PUBLIC_POSTHOG_HOST=/ingest`, `POSTHOG_HOST=https://eu.i.posthog.com`. All `NEXT_PUBLIC_*` vars are inlined at **build** time — they must exist in Vercel before the deploy build or the feature ships disabled and needs a redeploy.

## Cookie consent

`lib/cookie-consent.ts` owns the consent state. Universal module (no `"server-only"`) so the cookie banner client component and `proxy.ts` both read/write the same shape.

```
First visit                         Banner: "Accept all" / "Essential only"
   │                                  │
   ▼                                  ▼
SiteLayout reads cookies()      writeConsentToDocument({ necessary:true,
  → initialConsent = null         marketing:bool, ts, v:1 })
  → renders CookieBanner            → sets cookie_consent (1y, samesite=lax)
                                    → if marketing=false, also clears any
                                      pre-existing attribution_first/last

Subsequent visits                 proxy.ts before writing attribution_* cookies:
  → initialConsent = ConsentRecord    if (!hasMarketingConsent(cookie)) return null;
  → banner null on mount            → UTM still flows in URL, just not persisted
                                      to cookies / not attributed downstream
```

Two equally-prominent buttons satisfy ICO / AEPD / CNIL guidance ("reject must be no harder than accept"). The CookieBanner reopens via `window.dispatchEvent(new Event(COOKIE_PREFS_EVENT))` — the SiteFooter has a "Cookie preferences" button that dispatches it.

On accept/reject the banner calls `broadcastConsentChange(marketing)`, which dispatches `CONSENT_CHANGED_EVENT` (both in `lib/cookie-consent.ts`). This is the live wire that lets already-mounted marketing channels react without a reload: the Meta Pixel grants/revokes Meta consent and injects/holds `fbevents.js`, the players flip Mux Data `disableTracking`/`disableCookies` (via the `useMarketingConsent` hook), and a withdrawal triggers `clearMarketingCookies` to drop the attribution + `_fbp`/`_fbc` cookies. CAPI gates on the same `cookie_consent.marketing` state, snapshotted into the `capi_consent` sentinel at Checkout. See [Marketing & analytics measurement](#marketing--analytics-measurement-meta-pixel--conversions-api--mux-data).

Only one non-essential category (`marketing`) so no "Customize" sub-flow. If a second category lands (analytics, prefs), bump `CONSENT_VERSION` so stored consents that didn't cover the new category fall back to "show banner again".

## Catalog cache

`lib/catalog.ts:getPublishedShows()` wraps the published-shows query in `unstable_cache` (tag `'catalog'`, 1h fallback TTL). Both the home page and `/sitemap.xml` consume it — they share a single cached read instead of issuing redundant identical DB queries.

```
Home or sitemap         lib/catalog.ts:getPublishedShows()
  ─────────────►        ┌──────────────────────┐
                        │  unstable_cache wrap │
                        │  tag = 'catalog'     │
                        │  revalidate = 1h     │
                        └────┬────────────┬────┘
                             ▼            ▼
                          DB miss       cache hit
                         (one query)    (no DB)

Admin mutation that changes shows.status or shows.deleted_at:
  ─►  revalidateTag('catalog', 'default')
      (Next 16 requires the second profile arg)
  ─►  next read recomputes from DB and re-fills the cache
```

The home page stays `dynamic = "force-dynamic"` because the hero embeds a fresh 60s Mux preview JWT per request — only the catalog query inside is cached. `/sitemap.xml` is also `force-dynamic` so freshly soft-deleted shows drop out on the next crawl rather than being frozen at build time; the cached query keeps the DB cost trivial on warm hits.

Migration to Next 16's `'use cache'` + `cacheTag` + `updateTag` is deliberately deferred — enabling `cacheComponents: true` requires removing `runtime = "nodejs"` from all 5 webhook routes and `dynamic = "force-dynamic"` from the home + sitemap. Separate refactor.

## Subscription pipeline

```
In-player paywall (components/watch/paywall.tsx)
   │  primary CTA: <SignUpButton mode="modal" forceRedirectUrl=…>
   ▼  Clerk sign-up modal → after signup, Clerk redirects to
/subscribe?show=<slug>&resume=<n>
   │  proxy.ts: anonymous /subscribe → redirectToSignUp (so URL
   │           bookmarks + server-side redirects from /watch also
   │           land on sign-up first); signed-in passes through
   │  page render: getOrSyncCurrentUser (closes user.created webhook
   │              race) → linkTrialSessionsToCurrentUser → plan picker
   │  single <form action={startCheckout}> with hidden show/resume +
   │  radio name="plan"; SubmitButton shows spinner while pending
   ▼
startCheckout (app/subscribe/actions.ts)
   │
   ├── validate ?show= slug against published, non-deleted shows
   │     (open-redirect guard — slug flows into success/cancel URL)
   ├── Layer 1: DB dedupe (no existing access-granting row)
   ├── Layer 2: Stripe-list dedupe (catches the race where our DB
   │           mirror is behind because the previous webhook hasn't
   │           landed)
   ├── findOrCreate Stripe customer (stores stripe_customer_id on users)
   ├── checkout.sessions.create with idempotencyKey = checkout:user:hour
   │     - success_url = /watch/<slug>?resume=<n> (or /?welcome=1 when
   │       there's no show context — /account is gone)
   │     - automatic_tax + customer_update.address + billing_address_
   │       collection (Stripe Tax; $0 until a registration is added)
   │     - consent_collection.terms_of_service:"required" + localized
   │       custom_text (EU 14-day withdrawal waiver; needs ToS URL in
   │       Stripe Public details)
   │     - locale (Stripe-hosted page matches site language)
   └── redirect(session.url)
   │
   ▼ Stripe Checkout (hosted)
   │
   ▼ Webhook → app/api/webhooks/stripe/route.ts
Idempotency: claim stripe_events.event_id before processing; conflicts
return 200 without re-applying. On handler exception the claim is
DELETED so Stripe's retry can re-attempt.
   │
   │  Events handled:
   │  - checkout.session.completed: retrieves the subscription and
   │      runs mirrorSubscription. Closes the race where
   │      customer.subscription.created lags and the user lands on
   │      /watch with a 403 because no row exists yet.
   │  - customer.subscription.{created,updated,deleted}: mirrorSubscription
   │  - invoice.{paid,payment_failed}: pull subscription, mirrorSubscription
   ▼
mirrorSubscription:
   - lookup user by stripe_customer_id
   - require current_period_end on access-granting statuses (throws if
       missing, so Stripe retries — defaulting to now() locked out
       just-paid users)
   - upsert subscriptions row keyed on stripe_subscription_id
     (partial unique index on (user_id) WHERE status IN active/trialing/
     past_due — only one access-granting row per user at a time)
   - paused → past_due (customer who pauses billing keeps access)
   - markUserTrialsConverted (active/trialing only)
   │
   ▼ redirect to success_url
/watch/<slug>?resume=<n>  or  /?welcome=1
```

**Subscription gate (read path).** Every place we check "is this user a subscriber?" — `/api/playback-token`, `app/watch/[showSlug]/page.tsx`, `saveWatchProgress` — goes through `hasActiveSubscription(userId)` in `lib/subscription-access.ts`. The filter is `status IN ACCESS_GRANTING_STATUSES AND current_period_end > now()`, ordered by `updated_at DESC LIMIT 1`. `ACCESS_GRANTING_STATUSES = ["active","trialing","past_due"]` — past_due grants access because Stripe is mid-retry on a failed invoice and locking the user out makes Customer-Portal recovery impossible. Defense-in-depth: even if a `customer.subscription.deleted` webhook is dropped and the row stays in an access-granting state in our DB, the period-end check expires playback at the user's actual term.

**Billing portal.** `/api/billing-portal` is the only entry — a GET handler that does auth + customer lookup + `stripe.billingPortal.sessions.create` + 302 in one server hop. The Clerk user-menu's "Manage subscription" item, the `/subscribe` "you're already subscribed" CTA, and any future "manage billing" affordance all link straight to it. There is no `/account` page.

`subscriptions.cancel_at_period_end` is OR'd from both `sub.cancel_at_period_end` and `sub.cancel_at != null` because the Customer Portal sets the timestamp form, not the boolean. See [gotchas](./gotchas.md#stripe-portal-cancel).

## Route protection (proxy.ts)

```ts
isAdminRoute = createRouteMatcher(["/admin(.*)"]);
isAuthRoute  = createRouteMatcher(["/subscribe(.*)"]);
```

- `/admin/*`: Clerk userId required, then DB lookup `users.role='admin'`. Non-admin → redirect `/`. The role read is wrapped in a module-scope 5-second cache (`roleCache: Map<userId, {role, expiresAt}>`) so RSC prefetch fan-out + matcher-caught traffic don't translate 1:1 into Neon queries — without it a single signed-in user could saturate the pooled connection by spamming admin URLs. Anonymous → `redirectToSignIn` (admins already have accounts).
- `/subscribe/*`: Clerk userId required. Anonymous → `redirectToSignUp({ returnBackUrl })` — the paywall conversion path defaults to creating an account; Clerk's hosted sign-up page links to sign-in for the minority returning case.
- `/watch/*`: public. Trial cookie is **not** set here — `/api/playback-token` mints it on first play, after verifying the show is published+ready.
- Everything else: passes through.

Public catalog (`/`, `/shows/[slug]`) isn't gated — it surfaces only `status='published' AND deleted_at IS NULL` rows.

## Accessibility

- **Skip-to-content link**: `app/layout.tsx` renders an `<a href="#main-content">` that is `sr-only` by default and becomes visible on focus. The `#main-content` div wraps `{children}` so keyboard users can skip past the header and nav.

## Error boundaries

- `app/(public)/shows/[slug]/error.tsx` — catches errors in the show detail page (bad DB query, missing show data after a race with soft-delete, etc.). Renders a "Something went wrong" fallback with a retry button.
- `app/subscribe/error.tsx` — catches errors in the subscribe page (Stripe config issues, missing price IDs, etc.). Same pattern.

Error boundaries are React client components (`"use client"`) that receive `error` and `reset` props. They don't catch errors in `layout.tsx` or in route handlers — only in the page component tree below them.

## Route groups

- `app/(public)/` — `/`, `/shows/[slug]` — root layout, no auth
- `app/admin/` — admin panel (own `layout.tsx`). Pages: `/`, `shows/new`, `shows/[id]`, `shows/[id]/seasons/[seasonId]`, `shows/[id]/seasons/[seasonId]/episodes/[episodeId]`, `analytics`
- `app/watch/[showSlug]/` — public + cookie-managed. Accepts `?ep=<id>` to start on a specific episode, `?resume=<seconds>` for cross-session resume.
- `app/subscribe/` — radio-card plan picker + animated submit (`submit-button.tsx` is the lone client component; the page itself stays a server component)
- `app/api/billing-portal/` — GET-only redirect to Stripe Customer Portal
- `app/api/webhooks/{clerk,mux,stripe}/` — external webhooks (`runtime = "nodejs"`, raw body verification)
- `app/api/playback-token/` — token issuer

## Server actions vs route handlers (CLAUDE.md convention)

- **Server actions**: app mutations (admin CRUD, startCheckout, openBillingPortal, saveWatchProgress, saveTrialPosition).
- **Route handlers**: webhooks from external services (Clerk/Mux/Stripe) and the JWT issuer (`/api/playback-token`).

Webhook handlers always declare `export const runtime = "nodejs";` — the SDK signature verifiers need raw bytes and don't run on the Edge. The `evt` / `event` variables are explicitly typed via `Awaited<ReturnType<…>>` of the respective SDK's verify/unwrap function — no implicit `any`.

## Why these specific choices

- **`postgres-js` over `neon-http`**: lets us run from any Node runtime (Vercel Functions + scripts) with one driver. `prepare: false` is required for Neon's pooled endpoint (pgbouncer transaction mode).
- **Drizzle over Prisma**: type-safe SQL, no engine binary, fast cold start.
- **shadcn over component library**: full source in `components/ui/` — modifiable, no upgrade churn. New shadcn uses Base UI (not Radix); `Button` lacks `asChild`. For "link styled as button" use `buttonVariants()`.
- **Mux signed playback (new uploads)**: `playback_policies: ["signed"]` + JWT enforces server-side gating. Public IDs are still played by mux-player (token ignored) — old assets remain accessible unless re-uploaded.
- **Trial cookie + table**: `cookie` survives across signed-out → signed-up → subscribed without losing the user's place. `trial_sessions.user_id` is nullable until signup; webhook flips `converted` once they pay. Cookie minting + row creation both happen in `/api/playback-token` (not proxy.ts) — that way the show is verified published+ready before any state is persisted, and the 60s clock starts on the user's first play rather than on page load. An HMAC-of-IP bucket caps trial creations at 3/(IP, show)/hour to stop the cookie-clear loop.
