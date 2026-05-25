# Project: Matio Streaming Platform

A subscription video streaming platform for our studio's original content.
Netflix-inspired UX. 60-second anonymous trial per (browser session, show).

## Stack

- Next.js 16 App Router, TypeScript
- Postgres (Neon), Drizzle ORM (`postgres-js` driver, pooled endpoint)
- Clerk 7 (auth) — keyless mode in dev
- Stripe 22 (Checkout + Customer Portal + subscription webhooks)
- Mux (direct upload + signed playback IDs + asset webhooks)
- Tailwind v4 + shadcn (built on Base UI, not Radix)
- Resend (email — not yet wired)
- Vercel (hosting)

## Deeper docs

Always check these before changing integrations or guessing API shapes:

- [docs/architecture.md](./docs/architecture.md) — system diagram, data model, trial & playback pipelines, route protection model, *why* each decision was made
- [docs/services.md](./docs/services.md) — per-service setup (Clerk / Stripe / Mux / Neon / Vercel) and required env vars
- [docs/operations.md](./docs/operations.md) — pnpm scripts, migrations, deploy commands, end-to-end test recipes
- [docs/gotchas.md](./docs/gotchas.md) — **read this before touching webhooks or Mux** — version-specific traps for Next 16, Clerk 7, Stripe SDK 22 (API 2024+), Mux 14, shadcn/Base UI, Drizzle 0.45, tsx scripts

`PROJECT.md` is the original product spec — useful for build phases and product intent. Where it conflicts with this file or `docs/`, the latter wins.

## Conventions

- All DB access goes through Drizzle. Never write raw SQL except in migrations.
- All payment state changes flow through Stripe webhooks. Never trust client-side
  subscription status.
- All video playback requires a server-issued Mux signed JWT. Never expose
  playback IDs without a token.
- Server actions for mutations, route handlers for webhooks and token issuance.
- shadcn components live in `components/ui/`. Custom components in `components/`.
- Drizzle schemas in `db/schema/*.ts`, one file per logical domain.
- Env vars: Clerk = `CLERK_*`, Stripe = `STRIPE_*`, Mux = `MUX_*`. Never log secrets.
- Webhook route handlers declare `export const runtime = "nodejs";` (raw body + DB).
- Server-only modules use `import "server-only";` so they can't leak into a client bundle.
- All images go through `next/image`. Mux thumbnails are routed via `images.remotePatterns: [{ hostname: 'image.mux.com' }]` in `next.config.ts`. Use `fill` + `sizes` for absolutely-positioned cover images; raw `<img>` is reserved for cases where the Safari < 16.4 `aspect-ratio` quirk requires pinning the img's own intrinsic ratio (see `components/site/poster.tsx`).
- The hero `MuxPlayer` on `/` is `next/dynamic({ ssr: false })` — keep it that way. A static import pulls ~350KB gzipped (player + media-chrome + hls) into every cold home-page visit.

## File structure

```
app/
  (public)/                # Public catalog: /, /shows/[slug]
  admin/                   # /admin — admin role required (proxy-gated, DB check)
  api/
    billing-portal/        # /api/billing-portal — 302 to Stripe Customer Portal
    playback-token/        # /api/playback-token — Mux JWT issuer
    webhooks/
      clerk/               # user.created → mirrors to users
      mux/                 # video.asset.{ready,errored}
      stripe/              # checkout.session.completed, customer.subscription.*,
                           #   invoice.{paid,payment_failed} — idempotency via
                           #   stripe_events.event_id claim before processing
  subscribe/               # /subscribe — radio-card pricing + Checkout redirect
  watch/[showSlug]/        # /watch/<slug> — public, trial-aware
components/
  ui/                      # shadcn primitives (Base UI under the hood)
  admin/                   # admin-specific (upload widget, status select)
  site/                    # header, language switcher, posters, hero, logo
  watch/                   # player, paywall, playback-status, overlays
db/
  index.ts                 # postgres-js client (prepare: false for pooler)
  schema/                  # one file per domain; re-exported from schema/index.ts
                           #   users, subscriptions, stripe_events, shows,
                           #   seasons, episodes, trial_sessions, watch_progress
drizzle/                   # migrations (sql) + drizzle-kit meta
lib/
  admin.ts                 # getCurrentUser / requireAdmin
  mux.ts                   # lazy Mux SDK client
  mux-token.ts             # RS256 JWT signer for signed playback
  stripe.ts                # lazy Stripe SDK client
  subscription-access.ts   # ACCESS_GRANTING_STATUSES + hasActiveSubscription()
  trial.ts                 # mintTrialSession, link/convert helpers, IP hashing
  attribution.ts           # UTM cookie capture + per-funnel-milestone
                           #   persistence + Stripe metadata flatten/unflatten
  i18n/                    # dictionaries.ts + server.ts + client.tsx (optimistic
                           #   LocaleProvider) + actions.ts + shared.ts
  utils.ts                 # cn() from shadcn
proxy.ts                   # Auth + admin gating (Next 16: was middleware.ts)
scripts/
  promote-to-admin.ts      # pnpm promote-to-admin <email>
  stripe-setup.ts          # pnpm stripe:setup — creates products+prices
  check-subscription-dupes.ts # pnpm db:check-sub-dupes — pre-flight for 0008
```

## Key business rules

- **Trial**: anonymous, cookie-based. 60 seconds per (browser session, show). Triggered when the player on `/watch/[show-slug]` requests its first token — `/api/playback-token` mints the `trial_session` cookie and `trial_sessions` row at that point, after verifying the show is published+ready. The 60s clock starts on click-play, not on page load. Constant: `TRIAL_DURATION_SECONDS` in `lib/trial.ts`.
- Trial state survives signup + Stripe checkout via the `trial_session` cookie. `linkTrialSessionsToCurrentUser` (runs on `/subscribe` render) links unlinked rows by cookie; Stripe webhook flips `trial_sessions.converted=true` on active subscription.
- Trial creation is rate-limited at 3 per (`ip_hash`, `show_id`) per hour (`TRIAL_RATELIMIT_PER_HOUR`). The client IP is sourced from `x-vercel-forwarded-for` only — `x-forwarded-for` is appended-to by Vercel (not replaced) so the leftmost entry is attacker-controlled. Missing header → fallback to `"unknown"`, which puts all unidentified requests in one shared bucket (fail-CLOSED). `ip_hash = HMAC-SHA256(MUX_SIGNING_KEY_PRIVATE_KEY, client_ip)` — no raw IPs in the DB. Cap exceeded → `/api/playback-token` returns 429 (with `Retry-After: 3600`).
- **Subscriptions**: monthly ($9.99) or annual ($79.99), no other tiers. Stored in `subscriptions` table; mirrored from Stripe via webhook (one source of truth). The webhook is idempotent — every delivery claims its `event.id` in `stripe_events` before processing; duplicates short-circuit. Partial unique index on `(user_id) WHERE status IN ('active','trialing','past_due')` guarantees at most one access-granting row per user; historic rows (status='canceled') stay. Every subscription gate also checks `current_period_end > now()` so a dropped `customer.subscription.deleted` webhook can't extend playback past the user's term.
- **Subscription gate**: all read sites (`/api/playback-token`, `/watch/[showSlug]`, `saveWatchProgress`) go through `hasActiveSubscription(userId)` in `lib/subscription-access.ts`. `ACCESS_GRANTING_STATUSES = ["active","trialing","past_due"]` — past_due grants access (Stripe is mid-retry on a failed invoice; locking the user out makes recovery via Customer Portal impossible). Stripe's `paused` status maps to `past_due` for the same reason.
- **Subscribe surface**: `/subscribe` shows two radio-card plans (Monthly / Annual, Annual default). The in-player paywall (`components/watch/paywall.tsx`) leads with **sign-up**, not plan selection — the in-player CTA opens Clerk's `<SignUpButton mode="modal">` with `forceRedirectUrl=/subscribe?show=…`. Plan picking happens on `/subscribe` after the user has an account. Signed-in non-subscribers (paid→canceled→returned) skip the sign-up step via a direct `<Link>` to `/subscribe`.
- **Player end-states**: token-fetch failures branch into three distinct overlays in `components/watch/`: `Paywall` (403 in trial → "Sign up to keep watching"), `RateLimitedNotice` (429 → "Too many previews this hour"), `PlaybackUnavailable` (5xx / network / video decode error → "Try again"). The latter two used to all dump into the paywall, which framed infrastructure failures as a payment issue. The `<video>` element's own `error` event uses a rolling 10-second 3-error window before tripping `PlaybackUnavailable` — codes `MEDIA_ERR_DECODE` (3) and `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) are terminal and flip immediately; transient `MEDIA_ERR_NETWORK` (2) gives Mux/HLS room to retry. A single buffer-stall on cellular shouldn't kill the player.
- **Token refresh**: subscriber tokens auto-refresh **60 seconds before expiry** (not at expiry). Mux validates the JWT `exp` per-segment-request, so a refresh exactly at the boundary races segment fetches that go out a hair late and 403s mid-playback. 5xx/network failures during refresh retry with exponential backoff (1s/2s/4s, 4 attempts total) before flipping to `PlaybackUnavailable`. The existing token keeps playing through the refresh window — we deliberately don't `pause()` while retrying.
- **Watch-progress save** (`components/watch/player.tsx`) is gated on `document.visibilityState === "visible"` and flushes immediately on `visibilitychange`/`pagehide`. Without the gate, mobile users lost up to 10s of progress every time they backgrounded the app and burned battery on hidden tabs.
- **Billing portal**: `/api/billing-portal` is the single entry point — it does auth + customer lookup + Stripe billingPortal session + 302 in one server hop. The Clerk user menu's "Manage subscription" item links straight to it; no `/account` page exists.
- **Admin role**: set via DB column `users.role`, never via Clerk metadata alone. `proxy.ts` does the lookup on every `/admin/*` request via a module-scoped 5-second cache; `requireAdmin()` does it again inside actions (cache-free) for belt-and-braces.
- **Auth gating**: `proxy.ts` sends unauth'd `/subscribe(.*)` requests to Clerk's **sign-up** page (not sign-in) — most paywall conversions are first-time users; Clerk's sign-up page still links to sign-in for the minority case. Admin routes keep `redirectToSignIn` since admins already have accounts.
- **Clerk UI locale**: `ClerkProvider` in `app/layout.tsx` receives the `@clerk/localizations` bundle matching the site locale (`esES` default, `enUS` when switched). Sign-in/sign-up modals, UserButton menu, and form validation copy all follow the site language; the switch propagates to Clerk on the next `router.refresh` tick after the optimistic site flip.
- **Mux re-upload safety**: `createMuxUpload` only creates the upload URL — it does NOT clear the episode's playback fields. The clearing happens in `markEpisodeReprocessing`, which the upload widget calls from upchunk's `success` event. A cancelled mid-upload no longer permanently breaks the episode (Mux's webhook refuses to overwrite a different existing `asset_id`).
- Playback always goes through `/api/playback-token` → signed Mux JWT. Subscriber TTL: 1 hour (auto-refreshed). Trial TTL: `min(remaining, TRIAL_DURATION_SECONDS)`.
- **Campaign attribution**: `proxy.ts` reads `?utm_source / utm_medium / utm_campaign` on every non-admin request and writes two cookies — `attribution_first` (90d, write-if-absent) and `attribution_last` (30d, overwrite). Helpers in `lib/attribution.ts`. The cookies are snapshotted at each funnel milestone: `trial_sessions.attribution_*` (six cols) on first play via `mintTrialSession`, `users.attribution_*` on `/subscribe` render via `applyUserAttribution`, and `subscriptions.attribution_*` at Stripe Checkout creation via `subscription_data.metadata` → webhook `mirrorSubscription`. Subscription attribution is **never overwritten on conflict** (renewals would otherwise erase the original conversion campaign months later, when no UTM cookies are present). Admin analytics renders two side-by-side per-campaign tables — first-touch is the default and the right cut for "is this awareness channel working?" since Matio's funnel is delayed-conversion; last-touch is the comparison view for reconciling with Meta/Google dashboards.

## What NOT to do

- Don't add new dependencies without asking. Lock the stack.
- Don't bypass Stripe webhooks (e.g., don't mark a user "subscribed" from the
  client after Checkout success — wait for the webhook).
- Don't issue playback tokens with TTL > 1 hour.
- Don't store credit card details. Stripe handles all of that.
- Don't roll our own auth or password handling. Clerk owns that.
- Don't `db:push` against production — use `db:generate` + `db:migrate` so changes are tracked.
- Don't read `subscription.current_period_end` or `invoice.subscription` off the Stripe object root — both moved in 2024+ API. See [gotchas](./docs/gotchas.md#stripe-api-2024-moves).
- Don't put `asChild` on shadcn `Button` — there is no such prop. Use `buttonVariants()` on the Link instead.
- Don't drive critical-path UI state with CSS `:has()` (or Tailwind's `group-has-[*]:` variants) — iOS Safari < 15.4 silently no-ops the selector, leaving older iPhones with unselectable plans / invisible toggles. Use `peer-*:` (sibling combinator, Safari 3+) or React-controlled state. See [gotchas → cross-browser CSS](./docs/gotchas.md#cross-browser-css-ios-safari--154).
- Don't add a new `oklch()` color to `globals.css` without a hex/rgb fallback **declared first** (double-declaration pattern). Safari < 15.4 can't parse `oklch()` and drops the line entirely — without the fallback the whole dark theme collapses to default light on older iPhones.
- Don't pin UI to the bottom of the player / page without `pb-[max(env(safe-area-inset-bottom),...)]`. `viewport-fit=cover` is set via `viewport` export in `app/layout.tsx`, so the inset values are non-zero on notched iPhones — collisions with the home indicator are a 30-second fix when authored, an UX bug otherwise.

## Production context

- Vercel project: `mad-matttts-projects/matio` (id `prj_bT5c7cdVTRzAIPX7uLGYjQLBF5EI`)
- Prod URL: `https://matio.tv` (legacy Vercel alias still resolves: `https://matio-ten.vercel.app`)
- Neon project: `little-base-06482402` (org `Matvei`, aws-eu-central-1, Postgres 18, pooled endpoint)
- Stripe is in **test mode** (`sk_test_…`) — switch to `sk_live_…` when going live
- GitHub auto-deploy is NOT wired (Vercel account ≠ GitHub repo owner). Push via `vercel --prod --yes` from CLI.
