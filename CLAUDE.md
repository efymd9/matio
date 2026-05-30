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
- Meta Pixel + Conversions API (advertising measurement — consent-gated, no SDK)
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
- Env vars: Clerk = `CLERK_*`, Stripe = `STRIPE_*`, Mux = `MUX_*`, Meta = `META_*` / `NEXT_PUBLIC_META_PIXEL_ID`, PostHog = `POSTHOG_*` / `NEXT_PUBLIC_POSTHOG_*`. Never log secrets.
- Webhook route handlers declare `export const runtime = "nodejs";` (raw body + DB).
- Server-only modules use `import "server-only";` so they can't leak into a client bundle.
- All images go through `next/image`. Mux thumbnails are routed via `images.remotePatterns: [{ hostname: 'image.mux.com' }]` in `next.config.ts`. Use `fill` + `sizes` for absolutely-positioned cover images; raw `<img>` is reserved for cases where the Safari < 16.4 `aspect-ratio` quirk requires pinning the img's own intrinsic ratio (see `components/site/poster.tsx`).
- The hero `MuxPlayer` on `/` is `next/dynamic({ ssr: false })` — keep it that way. A static import pulls ~350KB gzipped (player + media-chrome + hls) into every cold home-page visit.

## File structure

```
app/
  (public)/                # Public catalog: /, /shows/[slug]
    terms/                 # /terms — bilingual legal page (filled; counsel review pending)
    privacy/               # /privacy — bilingual privacy policy (filled; counsel review pending)
    cookies/               # /cookies — bilingual cookie policy (filled; counsel review pending)
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
  subscribe/               # /subscribe — single $38/mo card + Checkout redirect
  watch/[showSlug]/        # /watch/<slug> — public, trial-aware
components/
  ui/                      # shadcn primitives (Base UI under the hood)
  admin/                   # admin-specific (upload widget, status select)
  site/                    # header, footer, cookie-banner, language switcher,
                           #   posters, hero, logo, meta-pixel (consent-gated
                           #   loader), view-content-pixel,
                           #   complete-registration-pixel,
                           #   posthog-provider (consent-gated, dynamic import)
  watch/                   # player, paywall, playback-status, overlays
                           #   (series-end-overlay's email capture is hidden
                           #   until Resend is wired — server action stays)
db/
  index.ts                 # postgres-js client (prepare: false for pooler)
  schema/                  # one file per domain; re-exported from schema/index.ts
                           #   users, subscriptions, stripe_events, shows,
                           #   seasons, episodes, trial_sessions, watch_progress
drizzle/                   # migrations (sql) + drizzle-kit meta
lib/
  admin.ts                 # getCurrentUser / requireAdmin
  catalog.ts               # getPublishedShows() cached via unstable_cache
                           #   (tag 'catalog'); shared by / + /sitemap.xml
  cookie-consent.ts        # cookie_consent parse/serialize, banner helpers
                           #   (universal — imported by proxy.ts AND banner)
  mux.ts                   # lazy Mux SDK client
  mux-token.ts             # RS256 JWT signer for signed playback
  stripe.ts                # lazy Stripe SDK client
  subscription-access.ts   # ACCESS_GRANTING_STATUSES + hasActiveSubscription()
  trial.ts                 # mintTrialSession, link/convert helpers, IP hashing
  attribution.ts           # UTM cookie capture + per-funnel-milestone
                           #   persistence + Stripe metadata flatten/unflatten
                           #   (writes gated on cookie consent in proxy.ts)
  meta-pixel-events.ts     # client fbq wrapper (trackPixel/onPixelReady) +
                           #   NEXT_PUBLIC_META_PIXEL_ID
  meta-capi.ts             # server-only Conversions API client (fetch, no SDK;
                           #   SHA-256 PII hashing; best-effort, never throws)
  capi-identity.ts         # server-only _fbp/_fbc/IP/UA capture + Stripe
                           #   metadata round-trip (capi_* keys + capi_consent)
  mux-data.ts              # server-only Mux Data API client for the admin
                           #   watch-time panel (Basic auth, cached 5m)
  use-marketing-consent.ts # client hook: live cookie_consent.marketing
                           #   (gates Mux Data on the players)
  posthog-events.ts        # client-side PostHog event helpers (curated named
                           #   events: show_viewed, trial_play_started, etc.)
  posthog-server.ts        # server-only posthog-node client (captureImmediate
                           #   for subscribe_succeeded in the Stripe webhook)
  i18n/                    # dictionaries.ts + server.ts + client.tsx (optimistic
                           #   LocaleProvider) + actions.ts + shared.ts
  utils.ts                 # cn() from shadcn
proxy.ts                   # Auth + admin gating (Next 16: was middleware.ts)
vercel.json                # regions=['fra1'] (co-located with Neon eu-central-1)
                           # + Cache-Control headers for /shows/* static assets
scripts/
  promote-to-admin.ts      # pnpm promote-to-admin <email>
  stripe-setup.ts          # pnpm stripe:setup — single "Matio Membership" $38/mo
                           #   product+price. Archives stale prices on amount mismatch.
  check-subscription-dupes.ts # pnpm db:check-sub-dupes — pre-flight for 0008
```

## Key business rules

- **Trial**: anonymous, cookie-based. 60 seconds per (browser session, show). Triggered when the player on `/watch/[show-slug]` requests its first token — `/api/playback-token` mints the `trial_session` cookie and `trial_sessions` row at that point, after verifying the show is published+ready. The 60s clock starts on click-play, not on page load. Constant: `TRIAL_DURATION_SECONDS` in `lib/trial.ts`.
- Trial state survives signup + Stripe checkout via the `trial_session` cookie. `linkTrialSessionsToCurrentUser` (runs on `/subscribe` render) links unlinked rows by cookie; Stripe webhook flips `trial_sessions.converted=true` on active subscription.
- Trial creation is rate-limited at 3 per (`ip_hash`, `show_id`) per hour (`TRIAL_RATELIMIT_PER_HOUR`). The client IP is sourced from `x-vercel-forwarded-for` only — `x-forwarded-for` is appended-to by Vercel (not replaced) so the leftmost entry is attacker-controlled. Missing header → fallback to `"unknown"`, which puts all unidentified requests in one shared bucket (fail-CLOSED). `ip_hash = HMAC-SHA256(MUX_SIGNING_KEY_PRIVATE_KEY, client_ip)` — no raw IPs in the DB. Cap exceeded → `/api/playback-token` returns 429 (with `Retry-After: 3600`).
- **Subscriptions**: single monthly plan at $38/mo — no annual, no other tiers. Stored in `subscriptions` table; mirrored from Stripe via webhook (one source of truth). The `subscription_plan` enum still carries an `'annual'` value for any historical (pre-launch test) rows but no new row is ever written with it. The webhook is idempotent — every delivery claims its `event.id` in `stripe_events` before processing; duplicates short-circuit. Partial unique index on `(user_id) WHERE status IN ('active','trialing','past_due')` guarantees at most one access-granting row per user; historic rows (status='canceled') stay. Every subscription gate also checks `current_period_end > now()` so a dropped `customer.subscription.deleted` webhook can't extend playback past the user's term.
- **Subscription gate**: all read sites (`/api/playback-token`, `/watch/[showSlug]`, `saveWatchProgress`) go through `hasActiveSubscription(userId)` in `lib/subscription-access.ts`. `ACCESS_GRANTING_STATUSES = ["active","trialing","past_due"]` — past_due grants access (Stripe is mid-retry on a failed invoice; locking the user out makes recovery via Customer Portal impossible). Stripe's `paused` status maps to `past_due` for the same reason.
- **Subscribe surface**: `/subscribe` shows a single membership card at $38/mo — no plan picker. The in-player paywall (`components/watch/paywall.tsx`) leads with **sign-up**, not pricing — the in-player CTA opens Clerk's `<SignUpButton mode="modal">` with `forceRedirectUrl=/subscribe?show=…`. Signed-in non-subscribers (paid→canceled→returned) skip the sign-up step via a direct `<Link>` to `/subscribe`. Checkout collects billing address (`customer_update.address: "auto"`, `billing_address_collection: "required"`), runs `automatic_tax: { enabled: true }` on a `tax_behavior=exclusive` price (so tax stacks on top of $38 — currently $0 until a Stripe Tax registration is added, see [Production context](#production-context)), and requires the EU/UK 14-day-withdrawal waiver via `consent_collection.terms_of_service: "required"` + localized `custom_text.terms_of_service_acceptance` (`startCheckout` in `app/subscribe/actions.ts`). `locale` is passed so the Stripe-hosted page matches the site language.
- **Player end-states**: token-fetch failures branch into three distinct overlays in `components/watch/`: `Paywall` (403 in trial → "Sign up to keep watching"), `RateLimitedNotice` (429 → "Too many previews this hour"), `PlaybackUnavailable` (5xx / network / video decode error → "Try again"). The latter two used to all dump into the paywall, which framed infrastructure failures as a payment issue. The `<video>` element's own `error` event uses a rolling 10-second 3-error window before tripping `PlaybackUnavailable` — codes `MEDIA_ERR_DECODE` (3) and `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) are terminal and flip immediately; transient `MEDIA_ERR_NETWORK` (2) gives Mux/HLS room to retry. A single buffer-stall on cellular shouldn't kill the player.
- **Token refresh**: subscriber tokens auto-refresh **60 seconds before expiry** (not at expiry). Mux validates the JWT `exp` per-segment-request, so a refresh exactly at the boundary races segment fetches that go out a hair late and 403s mid-playback. 5xx/network failures during refresh retry with exponential backoff (1s/2s/4s, 4 attempts total) before flipping to `PlaybackUnavailable`. The existing token keeps playing through the refresh window — we deliberately don't `pause()` while retrying.
- **Watch-progress save** (`components/watch/player.tsx`) is gated on `document.visibilityState === "visible"` and flushes immediately on `visibilitychange`/`pagehide`. Without the gate, mobile users lost up to 10s of progress every time they backgrounded the app and burned battery on hidden tabs.
- **Billing portal**: `/api/billing-portal` is the single entry point — it does auth + customer lookup + Stripe billingPortal session + 302 in one server hop. The Clerk user menu's "Manage subscription" item links straight to it; no `/account` page exists.
- **Admin role**: set via DB column `users.role`, never via Clerk metadata alone. `proxy.ts` does the lookup on every `/admin/*` request via a module-scoped 5-second cache; `requireAdmin()` does it again inside actions (cache-free) for belt-and-braces.
- **Auth gating**: `proxy.ts` sends unauth'd `/subscribe(.*)` requests to Clerk's **sign-up** page (not sign-in) — most paywall conversions are first-time users; Clerk's sign-up page still links to sign-in for the minority case. Admin routes keep `redirectToSignIn` since admins already have accounts.
- **Clerk UI locale**: `ClerkProvider` in `app/layout.tsx` receives the `@clerk/localizations` bundle matching the site locale (`esES` default, `enUS` when switched). Sign-in/sign-up modals, UserButton menu, and form validation copy all follow the site language; the switch propagates to Clerk on the next `router.refresh` tick after the optimistic site flip.
- **Mux re-upload safety**: `createMuxUpload` only creates the upload URL — it does NOT clear the episode's playback fields. The clearing happens in `markEpisodeReprocessing`, which the upload widget calls from upchunk's `success` event. A cancelled mid-upload no longer permanently breaks the episode (Mux's webhook refuses to overwrite a different existing `asset_id`).
- Playback always goes through `/api/playback-token` → signed Mux JWT. Subscriber TTL: 1 hour (auto-refreshed). Trial TTL: `min(remaining, TRIAL_DURATION_SECONDS)`.
- **Campaign attribution**: `proxy.ts` reads `?utm_source / utm_medium / utm_campaign` on every non-admin request and writes two cookies — `attribution_first` (90d, write-if-absent) and `attribution_last` (30d, overwrite). Helpers in `lib/attribution.ts`. **Both writes are gated on `hasMarketingConsent(cookie_consent)`** — without consent the UTM params still flow through the request but aren't persisted to cookies, so we never drop tracking on EU visitors before they've accepted the banner. The cookies are snapshotted at each funnel milestone: `trial_sessions.attribution_*` (six cols) on first play via `mintTrialSession`, `users.attribution_*` on `/subscribe` render via `applyUserAttribution`, and `subscriptions.attribution_*` at Stripe Checkout creation via `subscription_data.metadata` → webhook `mirrorSubscription`. Subscription attribution is **never overwritten on conflict** (renewals would otherwise erase the original conversion campaign months later, when no UTM cookies are present). Admin analytics renders two side-by-side per-campaign tables — first-touch is the default and the right cut for "is this awareness channel working?" since Matio's funnel is delayed-conversion; last-touch is the comparison view for reconciling with Meta/Google dashboards.
- **Meta Pixel + Conversions API**: consent-gated advertising measurement. The browser pixel (`components/site/meta-pixel.tsx`) only injects `fbevents.js` after `cookie_consent.marketing === true`; the banner's accept/reject broadcasts `CONSENT_CHANGED_EVENT` so it loads/halts without a reload. Browser events (`lib/meta-pixel-events.ts` → `fbq`): `PageView`, `ViewContent` (`/shows/[slug]`), `Lead` (trial-preview start), `InitiateCheckout` (`/subscribe` submit), `CompleteRegistration` (first authed `/subscribe`, localStorage-deduped). Server-side CAPI (`lib/meta-capi.ts`, plain `fetch` to graph.facebook.com — **no SDK**) fires **`Purchase`** from the Stripe webhook on the *transition into* an access-granting status only (guards renewal double-counts), `event_id=sub.id`, with SHA-256 email/external_id + the `_fbp`/`_fbc`/IP/UA captured at checkout. Those match params ride through Stripe `subscription_data.metadata` (`capi_*` keys + a `capi_consent` sentinel) exactly like UTM attribution — set in `startCheckout`, read back in `mirrorSubscription`, written on INSERT only. `_fbc` is also derived from `?fbclid` in `proxy.ts` under the same consent gate. CAPI is best-effort (never throws, 3s-bounded) so a Meta outage can't roll back the webhook idempotency claim. Env: `NEXT_PUBLIC_META_PIXEL_ID` (public), `META_CAPI_ACCESS_TOKEN` (secret), optional `META_CAPI_TEST_EVENT_CODE` / `META_GRAPH_API_VERSION`. No DB migration — match params are carried in Stripe metadata, not new columns.
- **Mux Data + engagement analytics**: Mux Data (watch-time / unique viewers / QoE) is wired onto the watch `<MuxVideo>` and hero `<MuxPlayer>` via `envKey={NEXT_PUBLIC_MUX_DATA_ENV_KEY}` (public token). **Consent-gated**: `lib/use-marketing-consent.ts` (live `cookie_consent.marketing` via `CONSENT_CHANGED_EVENT`) → the players pass `disableTracking`/`disableCookies` and omit `envKey` unless the key is set AND consent is given, so no beacons/viewer-id cookies fire pre-consent (this also closed the AUDIT.md H2 pre-consent leak). Leave the env key blank to keep Mux Data fully off. The admin analytics dashboard (`app/admin/analytics/page.tsx`) also derives **approximate** engagement from `watch_progress` (completion rate, avg % watched, avg watched/viewer, per-show viewers/completion) + trial preview depth from `trial_sessions.last_position_seconds` — approximate because `position_seconds` is the last-saved resume playhead, not cumulative watch time. For **real** watch-time it has a "Watch time · Mux Data" panel that pulls totals (watch time, views, unique viewers) + per-show breakdown from the **Mux Data API** server-side (`lib/mux-data.ts`, Basic auth, cached 5 min, hero excluded via `filters[]=!player_name:matio-hero`). That needs a separate **secret** token with Mux Data: Read — `MUX_DATA_API_TOKEN_ID`/`MUX_DATA_API_TOKEN_SECRET` (distinct from the public env key and the video token); unconfigured → a connect hint, never breaks the page. No DB migration for any of it.
- **Funnel analytics (PostHog)**: consent-gated PostHog EU Cloud for funnel measurement (where visitors drop, which campaigns convert). `components/site/posthog-provider.tsx` dynamically imports `posthog-js` only after `cookie_consent.marketing === true` (same pattern as the Meta Pixel); on withdrawal, `opt_out_capturing()` + `reset()`. Autocapture OFF; curated named events (`lib/posthog-events.ts`): `$pageview` (fired manually on every route change — App Router doesn't trigger posthog-js's default), `show_viewed`, `trial_play_started`, `paywall_shown`, `signup_cta_clicked`, `signup_completed`, `checkout_started`. Server-side `subscribe_succeeded` fires from the Stripe webhook via `posthog-node` `captureImmediate` (`lib/posthog-server.ts`), under the same `metadataHasCapiConsent` guard as CAPI. Ingestion reverse-proxied through `/ingest` (Next.js rewrite) to bypass ad blockers; `/ingest` excluded from the `proxy.ts` Clerk matcher. Session replay + heatmaps enabled, all inputs/text masked. Env: `NEXT_PUBLIC_POSTHOG_KEY` (public, build-time), `NEXT_PUBLIC_POSTHOG_HOST=/ingest`, `POSTHOG_HOST=https://eu.i.posthog.com`. All blank → PostHog fully off. See [docs/posthog-funnel.md](./docs/posthog-funnel.md) for the funnel recipe.
- **Cookie consent (geo-aware)**: opt-in is legally required only in the **EU/EEA/UK/CH** — there the banner shows and nothing marketing-related fires until "Accept all". **Everywhere else (the Americas, etc.) marketing consent defaults ON with no banner**: `proxy.ts` reads Vercel's `x-vercel-ip-country`, and for a non-required country with no prior choice it writes the `cookie_consent` cookie (`marketing:true`) itself AND forwards it on the request so the same render hides the banner + loads the pixel (`marketingConsentRequired()` in `lib/cookie-consent.ts`; unknown geo fails CLOSED → treated as required). An explicit choice (incl. opting out via the footer "Cookie preferences") always wins, so non-EU users keep an opt-out. This is why ad traffic landing straight on `/watch` is measurable in the Americas without a banner click. `components/site/cookie-banner.tsx` (mounted in root layout) renders a bottom bar when no `cookie_consent` cookie is present. Two equally-prominent buttons ("Accept all" / "Essential only") satisfy ICO/AEPD/CNIL guidance. The banner reads its initial state server-side (`cookies().get(CONSENT_COOKIE)`) so it doesn't flash for returning users. The SiteFooter has a "Cookie preferences" button that dispatches `COOKIE_PREFS_EVENT` to reopen the banner. `lib/cookie-consent.ts` exports the parse/serialize helpers and is universal (imported by both `proxy.ts` for the attribution gate and the client banner).
- **Catalog cache**: `lib/catalog.ts:getPublishedShows()` wraps the published-shows query in `unstable_cache` (tag `'catalog'`, 1h fallback TTL). Consumed by both `/` and `/sitemap.xml`. Admin server actions that mutate `shows.status` or `shows.deleted_at` call `revalidateTag('catalog', 'default')` (Next 16 changed the signature to require the second profile arg) so the catalog reflects publish/unpublish/soft-delete immediately. The page itself stays `force-dynamic` because the hero mints a fresh Mux JWT per request.
- **Legal pages**: `/terms`, `/privacy`, `/cookies` live in `app/(public)/` and are bilingual (ES default, EN via switcher). Filled 2026-05-28 with the real sole-trader details (Matvei Dobrovolskii t/a Matio, 221 Derby Road Nottingham, hello@matio.tv, England & Wales, no DPO). **Still marked DRAFT pending a counsel review** — the facts are in, the legal wording hasn't been lawyer-checked. ToS §6's EU 14-day right-of-withdrawal waiver is now live on Checkout (`consent_collection.terms_of_service: "required"` + `custom_text`), and the matching ToS/Privacy URLs are set in the Stripe account's Public Details. Privacy/terms say "business address" not "registered office" (sole trader has no Companies House registered office).

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
- Prod URL: `https://matio.tv` (apex is canonical; `www.matio.tv` 307-redirects to apex; legacy Vercel alias `matio-ten.vercel.app` still resolves)
- Functions pinned to **`fra1`** (Frankfurt) via `vercel.json` so they co-locate with Neon's `aws-eu-central-1`. Without this every DB query was a trans-atlantic round-trip; warm TTFB dropped from ~1s to ~300ms after pinning.
- Neon project: `little-base-06482402` (org `Matvei`, aws-eu-central-1, Postgres 18, pooled endpoint)
- **Business entity**: UK **sole trader** — Matvei Dobrovolskii trading as Matio (no Ltd, no Companies House registration). Not VAT-registered (yet); ICO data-protection-fee registration + EU digital-VAT (OSS) are open admin tasks.
- **Stripe is in LIVE mode** (`sk_live_…`) as of 2026-05-27. Single product (`prod_UatJzLBiTYS8pS` "Matio Membership"), single price (`price_1TbhWlCGXbzphNyzoAGW3wXM` — $38/mo USD, `tax_behavior=exclusive`). Webhook endpoint `we_1Tbdh2CGXbzphNyzsw1zWSZf` at `https://matio.tv/api/webhooks/stripe` (apex, not www — Stripe doesn't follow redirects). Stripe Tax `status=active`, head office GB, but **collects $0 until a tax registration is added** (none yet) — checkout already collects the billing address so tax will switch on automatically once registered. ToS + Privacy URLs set in Public Details (powers the Checkout withdrawal-waiver checkbox). Customer Portal default config has `subscription_cancel.enabled=true, mode=at_period_end`. **Full purchase verified end-to-end 2026-05-28** (checkout → 3 webhooks 200 → active row → playback-token 200 → cancel).
- **Clerk is in production instance** with custom domain (`clerk.matio.tv`, `accounts.matio.tv`). DNS CNAMEs are all live (`accounts`, `clerk`, `clk._domainkey`, `clk2._domainkey`, `clkmail`). Webhook URL: `https://matio.tv/api/webhooks/clerk` (apex — needs verifying / updating from www in Clerk dashboard if not yet on apex).
- **Mux**: webhook URL also should be on apex — `https://matio.tv/api/webhooks/mux`. Add referrer restriction on the signing key (`matio.tv`) in Mux dashboard for defence in depth on the hero preview JWT.
- GitHub auto-deploy is NOT wired (Vercel account ≠ GitHub repo owner). Push via `vercel --prod --yes` from CLI. `git push origin main` is for source-of-truth backup; it does not trigger a deploy.
