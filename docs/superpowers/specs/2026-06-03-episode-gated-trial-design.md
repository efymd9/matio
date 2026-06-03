# Episode-gated free tier + funnel analytics — design

**Date:** 2026-06-03
**Status:** Approved design, pre-implementation
**Owner:** Matvei

## Goal

Replace the 60-second trial on **One look** (slug `one-look`, 12 ready episodes) with an
episode-gated free tier, microdrama-style:

- Episodes **1–10**: free for everyone, anonymous included, full episodes.
- Episodes **11–12**: require a (free) account — the sign-up wall sits between 10 and 11.
- Episodes **13+** (as they publish): require an active subscription — the existing paywall.

All other shows keep the current 60-second preview trial unchanged. A new section on
`/admin/analytics` shows this funnel end-to-end (anonymous depth → sign-up → member
episodes → paywall → subscribed).

## Decisions made (with the user)

1. **Positional gating** — the episode's position decides its tier. No consumption
   counting, no cookie-clearing exposure (eps 1–10 are simply public).
2. **Per-show admin fields** — `free_episodes` / `member_episodes` columns on `shows`,
   editable in the admin show form. One look = 10/2; everything else 0/0.
3. **Coexist with the 60s trial** — shows with both counts at 0 behave exactly as today.
4. **Funnel from our DB + curated PostHog events** — admin section computes from
   Postgres (no consent blind spot); PostHog gets matching events for UTM slicing.
5. **Tier-aware end-to-end architecture** — token route enforces; watch page + player
   know each episode's tier for proactive walls and lock badges; anonymous tracking
   extends `trial_sessions` to reuse linking/attribution/conversion machinery.

## Data model

### `shows` — two new columns

| column | type | default | meaning |
|---|---|---|---|
| `free_episodes` | integer not null | 0 | first N ready episodes are public |
| `member_episodes` | integer not null | 0 | next M ready episodes need an account |

Both 0 → legacy 60s-trial show. Validation: integers ≥ 0. Editable in the admin
show form (create + edit), next to status/featured flags.

### `trial_sessions` — four new columns

| column | type | default | meaning |
|---|---|---|---|
| `kind` | text not null | `'preview'` | `'preview'` = legacy 60s row, `'episodes'` = gated-show row |
| `furthest_episode_number` | integer not null | 0 | deepest 1-based episode position started (funnel depth) |
| `last_episode_id` | uuid null, FK episodes on delete set null | null | anonymous resume target |
| `signup_wall_at` | timestamptz null | null | first time this session hit the sign-up wall |

For `kind='episodes'` rows, `expires_at` is set to `started_at` (sentinel; the 60s
expiry paths never execute for gated shows). Existing rows backfill to `'preview'`
via the column default — no data migration.

Everything else about the row is reused as-is: minted on first token request with the
trial cookie, attribution snapshot, `ip_hash`, signup linking via
`linkTrialSessionsToCurrentUser` (cookie + IP fallback), `converted` flipped by the
Stripe webhook. This reuse is the core reason the funnel connects anonymous → signed-up
→ subscribed without new machinery.

## Tier computation — `lib/episode-access.ts` (server-only)

An episode's tier comes from its **1-based position in the show's ready-episode
ordering** — ready episodes of published, non-deleted shows, ordered by
(season number, episode number); the same ordering the watch page already builds.

```
position ≤ free_episodes                      → "free"
position ≤ free_episodes + member_episodes    → "member"
otherwise                                     → "subscriber"
```

Exports (shapes indicative):

- `getShowGating(show)` → `{ gated: boolean, freeCount, memberCount }`
- `getOrderedReadyEpisodes(showId)` → ordered id list (used by the token route)
- `tierForPosition(position, gating)` → `"free" | "member" | "subscriber"`

Tiers are computed live at request time in both enforcement sites — never stored —
so publishing/unpublishing/reprocessing episodes self-corrects. If an episode in the
middle goes un-ready, positions shift; the token route is authoritative and the page
is at most one render stale. This is acceptable: content changes are rare admin
actions.

## Enforcement — `/api/playback-token` remains the single gate

Order of branches (subscriber check stays first, unchanged):

1. Episode lookup (published show, ready episode) — unchanged, plus fetch the show's
   gating config and the episode's position.
2. **Subscriber** (`hasActiveSubscription`) → 1h token, `mode: "subscriber"`. Unchanged.
3. **Gated show** (`free + member > 0`):
   - tier `free` → 1h token, `mode: "free"`, for anyone. Mint/read the
     `kind='episodes'` trial row (cookie, attribution, IP hash) exactly like today's
     trial mint, but: on `TrialRateLimitError`, **still issue the token** — the cap
     degrades tracking, never playback of free content. No 60s TTL anywhere.
   - tier `member` → signed-in (any Clerk user): 1h token, `mode: "member"`.
     Anonymous: `403 { error, reason: "signup_required" }` + stamp `signup_wall_at`
     on the session's row if one exists.
   - tier `subscriber` → `403 { error, reason: "subscribe_required" }` (anonymous and
     signed-in non-subscribers alike).
4. **Legacy show** (both counts 0) → existing trial branch byte-for-byte: 60s row,
   rate-limit 429, expired → bare 403 (the player keeps mapping it to today's paywall).

Token TTL for `free`/`member` is `SUBSCRIBER_TTL` (1h) and auto-refreshes through the
existing subscriber refresh path (the player's "short-lived token = trial" branch only
catches 60s TTLs). A refresh 403 classifies by `reason`.

`logToken` gains the new modes so Vercel-log monitoring keeps working.

## Watch page — `app/watch/[showSlug]/page.tsx`

- Compute gating + per-episode tier server-side; attach `tier` to each `PlayerEpisode`.
- Mode selection: subscriber → `subscriber`; gated show: signed-in → `member`,
  anonymous → `free`; legacy show: current trial logic (including the expired-trial
  redirect to `/subscribe`, which is **skipped** for gated shows).
- Anonymous resume on gated shows: initial episode = `?ep=` → row's
  `last_episode_id` → first episode; `resumeSeconds` from the row's
  `last_position_seconds` when landing on `last_episode_id`.
- Signed-in non-subscriber on a gated show: read `watch_progress` for resume (today
  this is subscriber-only), and call `linkTrialSessionsToCurrentUser()` on render —
  today that only runs on `/subscribe`, but this flow returns users to `/watch`
  after sign-up, and the funnel's "signed up" stage depends on the link.

## Player & walls — `components/watch/`

`PlayerEpisode` gains `tier`. Player `mode` becomes
`"subscriber" | "trial" | "free" | "member"`.

- **Sign-up wall** — new `SignupWall` component (visually a sibling of `Paywall`),
  new `EndState`. Trigger points:
  - ep 10 (last free episode) ends → wall instead of `UpNextOverlay`
  - tapping a `member` episode in the episodes overlay while anonymous
  - deep link to a `member` episode (the play-gate shows the wall, no token fetch)
  - token-route `403 reason: "signup_required"`
  Its Clerk `SignUpButton` uses `forceRedirectUrl=/watch/<slug>?ep=<first-member-ep-id>`
  — back into playback, not to `/subscribe`. Copy direction: "Create a free account —
  2 more episodes free." A sign-in link covers existing accounts.
  On mount it calls a small server action to stamp `signup_wall_at` (covers the
  end-of-ep-10 path, which never hits the token route).
- **Subscription paywall** — existing `Paywall` (→ `/subscribe`). Triggers: a member
  finishes the last member episode (replaces `SeriesEndOverlay` for non-subscribers),
  taps a `subscriber`-tier episode, deep-links past the member tier, or the token
  route returns `reason: "subscribe_required"`. When ep 13+ publishes, it guards
  positionally with no further changes.
- **Episodes overlay** — lock badge on episodes above the viewer's tier; tapping one
  opens the appropriate wall instead of swapping.
- **Play-gate** stays for `free` mode (defers token + row mint to the play press);
  `member` mode behaves like subscriber (no gate).
- 403 classification: parse the JSON `reason`; absent reason (legacy shows) keeps
  today's paywall mapping.

### Signup-completion events move with the redirect

Meta `Lead` + `CompleteRegistration` and PostHog `signup_completed` currently fire on
the first authed `/subscribe` render. The wall's post-signup redirect lands on
`/watch/...` instead, so the same deduped component (single localStorage flag) also
mounts on the watch page for signed-in users. No double-fires, no lost Leads.

## Progress writes

- `saveTrialPosition(episodeId, seconds)` extends to also bump
  `furthest_episode_number` (max of current and the episode's position) and
  `last_episode_id`. Server-side it verifies the episode belongs to the show on the
  session row and is `free`-tier; analytics-only, best-effort.
- `saveWatchProgress` gate widens from `hasActiveSubscription` to "subscriber OR
  episode within the signed-in user's tier" (tier computed server-side in the action).
  Member progress on eps 11–12 therefore lands in `watch_progress` — used for both
  resume and the funnel.

## Admin analytics — "Episode funnel" section

New section on `/admin/analytics`, one card per gated show (`free + member > 0`),
computed from Postgres:

| # | stage | source |
|---|---|---|
| 1 | Started watching free | distinct `trial_sessions` `kind='episodes'` for the show |
| 2 | Episode depth (1…N bars) | sessions with `furthest_episode_number ≥ n` |
| 3 | Hit sign-up wall | `signup_wall_at` set OR furthest ≥ `free_episodes` |
| 4 | Signed up | stage-3 sessions with `user_id` linked |
| 5 | Watched member episodes | linked users with `watch_progress` on each member episode (per-episode rows) |
| 6 | Hit subscription paywall | linked users with `completed=true` on the last member episode |
| 7 | Subscribed | sessions with `converted = true` |

Each stage shows the absolute count and % of stage 1. Campaign slicing is PostHog's
job (the attribution columns exist on the rows if in-app slicing is ever wanted).
Rendering follows the existing dashboard's table/card idiom; queries follow the
existing page's Drizzle style.

## PostHog events (consent-gated, curated — `lib/posthog-events.ts`)

- `free_episode_started` `{ show_slug, episode_number }` — token success `mode:"free"`,
  deduped per episode per mount
- `member_episode_started` `{ show_slug, episode_number }` — same for `mode:"member"`
- `signup_wall_shown` `{ show_slug, episode_number }` — wall mount
- `paywall_shown` gains `{ wall: "subscription" }` and fires on the member-tier paywall

Enough to rebuild the funnel in the PostHog "Ads funnel" dashboard sliced by UTM.

## Edge cases

- **Episode set changes**: tiers recompute live everywhere; worst case one stale render.
- **`free_episodes` exceeds ready count**: all ready episodes are free; member/sub
  tiers activate as episodes publish. The same rule means "ep 13 not published yet"
  needs no special case today.
- **Former subscriber** (canceled, still signed in): member tier on 11–12. Accepted.
- **Cookies blocked / webviews**: enforcement is positional and server-side — only
  funnel tracking degrades (same as today's trial analytics).
- **Rate-limit cap on a gated show**: row creation skipped, token still issued.
- **Subscribers**: short-circuit on the first branch of every gate; zero behavior change.
- **Legacy shows**: 60s trial, 429 notice, paywall, expired-trial redirect — unchanged.
- **Multi-season gated shows**: ordering is (season, episode); One look is
  single-season; documented for the future.

## Migration & rollout

1. One Drizzle migration (`db:generate` + `db:migrate`): 2 columns on `shows`, 4 on
   `trial_sessions`, all with defaults — no backfill, no downtime.
2. Deploy. Feature is dark (all shows 0/0).
3. Set One look to 10/2 in the admin form. Rollback = set back to 0/0 (rows created
   meanwhile keep `kind='episodes'` and stay out of legacy queries).

## Testing recipes (manual, per docs/operations.md style)

- Anonymous: binge eps 1–10 in full → wall replaces up-next after 10; deep link to
  ep 11 → wall at the play-gate; deep link past member tier → subscription paywall.
- Sign up from the wall → land back on ep 11 playing; finish 12 → subscription paywall;
  `trial_sessions` row linked (`user_id` set), Lead/`signup_completed` fired once.
- Legacy show: 60s preview → paywall, 4th preview in an hour from one IP → 429 notice.
- Subscriber: every episode of every show plays; no walls.
- Funnel section: counts move as the above sessions execute.
- Token refresh: leave a free episode playing > 1h → seamless refresh.

## Out of scope

- Resend/email capture, per-campaign funnel tables in-app, count-based (non-positional)
  gating, any change to `/subscribe` or Stripe flows.
