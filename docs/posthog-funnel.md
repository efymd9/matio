# PostHog Funnel Analytics

Consent-gated first-party-proxied PostHog (EU Cloud) to find where the ads
funnel leaks. See `docs/superpowers/specs/2026-05-30-posthog-funnel-analytics-design.md`
for the design rationale.

## Setup (one-time, outside the repo)

1. Create a PostHog Cloud project in the **EU** region. Copy the **Project API
   Key** (`phc_…`).
2. Project settings → enable **Session replay** and **Heatmaps**.
3. Add env vars (Vercel + local `.env.local`):
   - `NEXT_PUBLIC_POSTHOG_KEY=phc_…`
   - `NEXT_PUBLIC_POSTHOG_HOST=/ingest`
   - `POSTHOG_HOST=https://eu.i.posthog.com`
   Leave them blank to keep PostHog fully off (client provider + server client
   both no-op).

## How capture works

- Loads only after `cookie_consent.marketing === true` (mirrors the Meta Pixel).
- Autocapture OFF. We send pageviews + a curated event set.
- Ingestion is proxied through `/ingest` (Next.js rewrite) to dodge ad blockers.
- The `subscribe` conversion is server-side (Stripe webhook → posthog-node
  `captureImmediate`), keyed to the Clerk user id so it stitches to the
  browser-identified person.

## Events

| Event | Where |
|---|---|
| `$pageview` | every route change (provider) |
| `show_viewed` | /shows/[slug] |
| `trial_play_started` | watch player, on first preview play |
| `paywall_shown` | trial-end paywall mount |
| `signup_cta_clicked` | paywall CTA (signed_out / signed_in) |
| `signup_completed` | first authed /subscribe (once per user) |
| `checkout_started` | /subscribe submit |
| `subscribe_succeeded` | Stripe webhook (server) |

## Build the funnel

In PostHog → Product analytics → New insight → **Funnel**. Steps in order:

1. Pageview where Path = `/`
2. Pageview where Path matches `/shows/.*`
3. `trial_play_started`
4. `paywall_shown`
5. `signup_cta_clicked`
6. `signup_completed`
7. Pageview where Path = `/subscribe`
8. `checkout_started`
9. `subscribe_succeeded`

Set the conversion window to ~7 days (Matio's funnel is delayed-conversion).
Add a **Breakdown** by `utm_source` (and a second saved copy by `utm_campaign`)
to see which campaign leaks at which step. Save both onto a new **"Ads funnel"**
dashboard.
