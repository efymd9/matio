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

> **Pay-first funnel reorder (2026-06-10).** With `PAY_FIRST_CHECKOUT=1` the
> signed-out flow is paywall → Stripe → `/welcome` (account created at
> purchase). Consequences for events: `checkout_started` fires server-side at
> the **paywall CTA** on the device distinct_id (skipped when the `ph_*`
> cookie is absent — slight undercount vs Meta InitiateCheckout);
> `signup_completed` (+ Meta Lead/CompleteRegistration) fires **after**
> purchase on `/welcome` at ~purchaser volume; `/subscribe` is no longer on
> the signed-out path. The signed-in flow is unchanged. Project annotations
> mark 2026-06-09 (autoplay grain era #3) and 2026-06-10 (this reorder).

| Event | Where |
|---|---|
| `$pageview` | every route change (provider) |
| `show_viewed` | /shows/[slug] |
| `trial_play_started` | watch player, on first preview play |
| `paywall_shown` | trial-end paywall mount |
| `signup_cta_clicked` | paywall CTA (signed_out / signed_in; `flow: pay_first` when it starts guest checkout) |
| `signup_completed` | signed-in: first authed /subscribe · pay-first: /welcome after auto sign-in (once per user) |
| `checkout_started` | signed-in: /subscribe submit (user id) · pay-first: paywall CTA, server-side (device id, `flow: pay_first`) |
| `subscribe_succeeded` | Stripe webhook + /welcome inline mirror (server; deduped by deterministic uuid) |
| `welcome_signin_succeeded` | /welcome — session established (`method: ticket \| session`) |
| `welcome_signin_failed` | /welcome — ticket consumption failed |
| `welcome_fallback_shown` | /welcome — email-code fallback rendered (`reason`) |

## Build the funnel

In PostHog → Product analytics → New insight → **Funnel**. **Ads land directly on
the show player** (`/watch/[showSlug]`), so the primary ad funnel starts there —
NOT the homepage. Steps in order (post pay-first — note NO `/subscribe` step:
guests never load it, and ordered funnels tolerate the signed-in flow's extra
pageview between steps):

1. Pageview where Path contains `/watch/`  ← ad landing (the player)
2. `trial_play_started`
3. `paywall_shown`
4. `signup_cta_clicked`
5. `checkout_started`
6. `subscribe_succeeded`

Set the conversion window to ~14 days (Matio's funnel is delayed-conversion).
Do **not** put `signup_completed` before `checkout_started` in any ordered
funnel — under pay-first it fires last, and the funnel would report paying
customers as drop-offs at the checkout step.

Add a **Breakdown** by `utm_source` (and a second saved copy by `utm_campaign`)
to see which campaign leaks at which step. For organic/browse traffic, build a
separate funnel starting at `/` → `/shows/*`.

## The "Ads funnel" dashboard (already built)

Built via the PostHog MCP in the EU project — **dashboard id `714865`**. Four
insights:

| Insight | `short_id` | What it cuts |
|---|---|---|
| Ads funnel — overall | `MeVGSCuA` | the `/watch` landing funnel, no breakdown |
| Ads funnel — by UTM source | `c440ynpr` | breakdown by normalized `utm_source` |
| Ads funnel — by UTM campaign | `Yoks0iu4` | breakdown by normalized `utm_campaign` |
| Ads funnel — /shows landing | `R4WecWTM` | the alt campaign that lands on `/shows/[slug]` |

The **/shows-landing** ad test lands on the show page rather than the player,
so its funnel has an **extra `/shows/[slug]` → `/watch/[slug]` step** ahead of
`trial_play_started` that the primary `/watch` funnel doesn't. Everything else is
the same step list.

All four (plus the three "Conversion · trial → paid" insights `uQPRcgLy` /
`BrUI1oNs` / `yBleeXz1`) were **redefined 2026-06-10** for pay-first: the
`/subscribe` pageview step was removed from the ads funnels, and
`signup_completed` was dropped from the conversion funnels (it now fires
post-purchase). Step-conversion numbers before/after that date aren't
comparable — see the project annotation.

The breakdown insights use a **normalized HogQL expression** (see below) instead
of the raw `properties.utm_campaign` / `utm_source` so fragmented variants of the
same campaign collapse into one row.

## UTM normalization

`utm_campaign` (and `utm_source`/`utm_medium`) fragments in the wild — case drift
(`TikTok` vs `tiktok`), encoded spaces, and stray junk (a leaked `>` split
`campaign_1` into `campaign_1>`). We normalize on **two sides** so the app's
attribution columns and PostHog's funnel breakdowns group campaigns identically.

- **App side** — `lib/utm.ts` exports `normalizeUtm(value)` = trim + lowercase +
  strip every char outside `[a-z0-9_-]`. `lib/attribution.ts`'s `clean()` runs
  values through it (keeping the 100-char cap), so normalized UTMs flow into the
  `attribution_first`/`attribution_last` cookies, the `users` /
  `trial_sessions` / `subscriptions` `attribution_*` columns, and Stripe
  metadata. This is **forward-only** — it only affects values captured from now
  on.
- **PostHog side** — `components/site/posthog-provider.tsx` adds a `before_send`
  hook to `posthog.init` that normalizes the autocaptured `utm_campaign` /
  `utm_source` / `utm_medium` on every event (and thus the derived
  `$initial_utm_*` person props).
- **HogQL (retroactive)** — the saved funnel breakdowns key on
  `replaceRegexpAll(lower(trim(properties.utm_campaign)), '[^a-z0-9_-]', '')`
  (and the `utm_source` equivalent), which matches `normalizeUtm` exactly. Unlike
  the `before_send` hook, this rewrites **history** at query time too, so old
  events group correctly without a backfill.

Numeric Meta `{{campaign.id}}` values pass through all three unchanged.

## Ad-link UTM scheme

Land the ad **directly** on the player (`/watch/[slug]`, primary) or the show
page (`/shows/[slug]`, the alt test) — never the homepage. Put the UTMs in Meta's
**"URL Parameters"** field on the ad, not baked into the destination URL:

```
utm_source={{site_source_name}}
utm_medium=paid_social
utm_campaign=<static lowercase slug>     ← e.g. spring_launch, NOT {{campaign.name}}
utm_content={{ad.id}}
```

**Never use `{{campaign.name}}`** for `utm_campaign` — human-typed campaign names
fragment (spaces, capitalization, emoji) faster than normalization can fully
repair. Pick a static lowercase slug per campaign instead. Real campaigns
currently pass `utm_campaign={{campaign.id}}` — stable but opaque 18-digit
numbers; they survive normalization unchanged but read as meaningless IDs in the
breakdown, so the static-slug scheme is preferred going forward.
