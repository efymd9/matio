# PostHog Funnel Analytics — Design Spec

**Date:** 2026-05-30
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Matvei Dobrovolskii + Claude

## Problem

Matio's existing attribution only snapshots **funnel milestones** (trial start, signup,
subscription) per campaign. It can show that a campaign converted poorly but **not where**
prospects dropped — e.g. landed on `/` and bounced, viewed a show page but never clicked
play, started a trial preview but never signed up. We need visit-level analytics to see
**where the ads funnel leaks**.

## Decision summary

| Decision | Choice |
|---|---|
| Build vs buy | **Buy — PostHog** (changed from an initial first-party lean) |
| Hosting / region | **PostHog Cloud, EU region** (data residency matches Neon eu-central-1 / fra1) |
| Capture granularity | **Curated** — named funnel events + pageviews; **autocapture OFF** |
| Features enabled | Server-side conversion capture, **session replay** (masked), **heatmaps** |
| Subscribe-conversion capture | **`posthog-node` from the Stripe webhook** (real-time, user-id stitched) |
| Consent gating | **Reuse `cookie_consent.marketing`** (no banner redesign) |
| Reverse proxy | **Yes** — Next.js rewrite to `/ingest` |
| In-app admin UI | **None** — analysis lives in PostHog |

This integration is **additive** to the existing Meta Pixel + Conversions API. Nothing
existing is removed or replaced.

## Goals

- Answer "where does the ads funnel leak?" with a step-by-step funnel broken down by
  `utm_source` / `utm_campaign`.
- Stay consistent with Matio's consent-gated, EU-privacy posture: no PostHog cookie or
  beacon fires before `cookie_consent.marketing === true`.
- Reliably capture the **subscribe** conversion even when the user closes the tab during
  the Stripe redirect.
- Degrade to a clean no-op when unconfigured (local dev, missing key) — never break a
  page render or a webhook.

## Non-goals (YAGNI)

Autocapture, feature flags, A/B experiments, surveys, group analytics, custom Postgres
tables, an in-app funnel UI, and hand-passing our attribution cookies to PostHog (its
native UTM capture replaces that).

---

## Architecture

### 1. Packages & environment

New dependencies (authorized by the choice of PostHog):

- `posthog-js` — browser SDK
- `posthog-node` — server SDK, used only for the webhook conversion event

Environment variables (`POSTHOG_*` convention per CLAUDE.md):

| Var | Scope | Value / purpose |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | public | Project API key (used by both client and server capture) |
| `NEXT_PUBLIC_POSTHOG_HOST` | public | `/ingest` — the reverse-proxy path the browser SDK posts to |
| `POSTHOG_HOST` | server | `https://eu.i.posthog.com` — server SDK ingestion (no proxy needed) |

`posthog-node` uses the **project** API key for capture; no personal/secret key is
required for ingestion. Server-side reuses `NEXT_PUBLIC_POSTHOG_KEY` rather than adding a
separate secret.

**Unconfigured behavior:** if `NEXT_PUBLIC_POSTHOG_KEY` is absent, the client provider
renders nothing and the server client returns a no-op — identical to how `lib/meta-capi.ts`
degrades. Local dev stays clean with no env set.

### 2. Reverse proxy

Add to `next.config.ts`:

```ts
skipTrailingSlashRedirect: true,
async rewrites() {
  return [
    { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
    { source: "/ingest/:path*",        destination: "https://eu.i.posthog.com/:path*" },
  ];
},
```

The existing `next.config.ts` has `images.remotePatterns` and `experimental.optimizePackageImports`;
the `rewrites()` and `skipTrailingSlashRedirect` keys are added alongside them.

**Exclude `/ingest` from the proxy matcher.** In `proxy.ts` (`config.matcher`, line ~147),
add `ingest` to the negative-lookahead first matcher group so analytics beacons skip Clerk
auth. Middleware runs **before** `next.config` rewrites, so without this exclusion every
beacon pays the full auth path. The `_next` exclusion pattern there is the model to follow.

### 3. Client SDK init + consent gating

New `components/site/posthog-provider.tsx` (client component), mounted in `app/layout.tsx`
next to `<MetaPixel/>`, receiving the same server-parsed `initialConsent: ConsentRecord | null`
already computed in the layout.

It **mirrors `components/site/meta-pixel.tsx`**:

- Calls `posthog.init()` only after `cookie_consent.marketing === true` — either from
  `initialConsent` on first paint (returning consented visitor, no flash) or via the
  `CONSENT_CHANGED_EVENT` listener.
- `init` config:
  - `api_host: "/ingest"`, `ui_host: "https://eu.posthog.com"`
  - `person_profiles: "identified_only"`
  - `autocapture: false`
  - `capture_pageview: false` — `$pageview` is fired manually on App-Router route
    changes (`usePathname` + `useSearchParams`), the same pattern `meta-pixel.tsx` uses
    for `PageView`, avoiding double-counting the first page.
  - `capture_pageleave: true`
  - `enable_heatmaps: true`
  - `disable_session_recording: false` with
    `session_recording: { maskAllInputs: true, maskTextSelector: "*" }` (mask all text by
    default; relax per-element later if needed). Clerk auth forms and the user menu are
    thereby masked.
- On consent **revoke** (live, via `CONSENT_CHANGED_EVENT`): `posthog.opt_out_capturing()`
  + `posthog.reset()` (stops replay too). On **re-grant**: `posthog.opt_in_capturing()`.
- No PostHog cookie or `/ingest` request before consent.

### 4. Identity stitching

A client effect (in the provider or a sibling) reads Clerk `useAuth()` / `useUser()`:

- Signed-in: `posthog.identify(clerkUserId, { email })` — merges the prior anonymous
  `distinct_id` into the identified person.
- Sign-out: `posthog.reset()`.

Because the client identifies by `clerkUserId`, the **server-side** `subscribe_succeeded`
(keyed to the same `clerkUserId`) stitches to the same person automatically. UTM
attribution is captured natively by PostHog (`$initial_utm_*` person properties) — we do
**not** hand-pass the `attribution_*` cookies.

### 5. Curated event map

`$pageview` (auto on route change) covers the page-level steps. Named events for in-page
actions fire **beside the existing `trackPixel` calls** through a small
`lib/posthog-events.ts` wrapper (a safe no-op until `posthog` is initialized, analogous to
`onPixelReady` deferral):

| Event | Call site (next to existing pixel event) |
|---|---|
| `show_viewed` | `components/site/view-content-pixel.tsx` (with `ViewContent`) |
| `trial_play_started` | `components/watch/player.tsx` ~line 145 (with `Lead`) |
| `paywall_shown` | `components/watch/paywall.tsx` |
| `signup_cta_clicked` | paywall CTA (`components/watch/paywall.tsx`) |
| `signup_completed` | `components/site/complete-registration-pixel.tsx` (with `CompleteRegistration`) |
| `checkout_started` | `app/subscribe/submit-button.tsx` ~line 36 (with `InitiateCheckout`) |
| `subscribe_succeeded` | **server** — Stripe webhook (§6) |

Page-level funnel steps (`/`, `/shows/*`, `/subscribe`) are derived from `$pageview` path
filters, not separate named events.

### 6. Server-side conversion capture (the critical step)

New `lib/posthog-server.ts`:

- Lazy `posthog-node` client (global-cached, like `lib/meta-capi.ts`'s `__metaCapiClient`).
- Configured for short-lived serverless flushing — prefer `captureImmediate()` (sends
  synchronously) or `flushAt: 1` + an awaited `flush()` / `shutdown()`. The implementation
  plan selects the exact `posthog-node` API; the requirement is **the event is flushed
  before the function freezes**.
- **Best-effort, never throws**; returns a result the caller can log; no-op when
  `NEXT_PUBLIC_POSTHOG_KEY` is absent (`{ skipped: true }`).

In `app/api/webhooks/stripe/route.ts`, **inside the existing `becameAccessGranting`
transition guard** (line ~168, right next to the CAPI Purchase):

```ts
// alongside the existing sendCapiEvents(...) Purchase call
try {
  await captureServerEvent({
    distinctId: user.id,                 // Clerk id → stitches to client-identified person
    event: "subscribe_succeeded",
    properties: { value: amount, currency, plan },
  });
} catch (err) {
  console.warn("PostHog subscribe_succeeded threw", { subId: sub.id, err });
}
```

- Gated on the **same `capi_consent` sentinel** already read via `metadataHasCapiConsent(sub.metadata)`,
  so server-side capture honors the consent captured at checkout.
- Fires exactly once because of the existing `becameAccessGranting` transition guard
  (`!priorWasAccessGranting && mappedStatus ∈ ACCESS_GRANTING_STATUSES`) plus the webhook's
  `stripe_events` `event.id` idempotency claim. Renewals / `invoice.paid` updates do not
  re-fire.
- Wrapped in try/catch (and the client never throws anyway) so a PostHog outage can't roll
  back the webhook's idempotency claim — same safety contract as the CAPI block.

### 7. Session replay & heatmaps (privacy)

- **Replay:** enabled in PostHog project settings and live only behind the consent-gated
  `init`. `maskAllInputs: true`; mask text in Clerk auth / account regions. Stripe is a
  hosted redirect, so card data never touches our DOM.
- **Heatmaps:** `enable_heatmaps: true`. PostHog's dedicated heatmap capture works
  **without** autocapture, so autocapture stays off while click/scroll maps still work on
  landing + show pages.
- Both inherit consent gating from the single gated `init` and the revoke handler.

### 8. Analysis surface

No in-app admin page. Deliverable is a **documented PostHog setup recipe** in `docs/`:

- A saved **Funnel** insight:
  `$pageview /` → `$pageview /shows/*` → `trial_play_started` → `paywall_shown`
  → `signup_cta_clicked` → `signup_completed` → `$pageview /subscribe`
  → `checkout_started` → `subscribe_succeeded`
- Breakdown by `utm_source` / `utm_campaign`.
- Collected on an "Ads funnel" dashboard.

### 9. Legal / documentation

- Extend `/cookies` and `/privacy` (bilingual, already DRAFT) to list **PostHog** as an EU
  sub-processor and disclose its cookies + session replay.
- Update `CLAUDE.md` (new key business rule + env vars + file structure), `docs/architecture.md`,
  `docs/services.md` (PostHog setup + env), and `docs/gotchas.md` (Next.js rewrite ordering
  vs middleware, serverless `posthog-node` flush, manual `$pageview` in App Router).

---

## Error handling & edge cases

- **Unconfigured:** client provider renders null; server client no-ops. No crashes.
- **PostHog outage:** server capture is best-effort + try/caught; cannot fail the webhook
  or roll back idempotency. Client SDK failures are non-fatal by design.
- **Consent revoked mid-session:** `opt_out_capturing()` + `reset()`; replay stops; no
  further beacons.
- **Ad blockers:** mitigated by the `/ingest` reverse proxy.
- **Double-count:** prevented by the `becameAccessGranting` guard + `stripe_events`
  idempotency (server) and the manual-`$pageview` first-path guard (client).
- **Funnel coverage bias:** because capture is consent-gated, the funnel reflects only
  visitors who accepted marketing cookies. Accepted trade-off (consistent with all other
  Matio tracking surfaces).

## Testing / verification

- **Unit:** `lib/posthog-server.ts` no-ops when unconfigured and never throws (mirrors any
  existing `lib/meta-capi.ts` tests).
- **Manual:**
  1. Consent OFF → zero `/ingest` requests and no PostHog cookies (DevTools).
  2. Accept marketing → events flow; `$pageview` fires once per route change.
  3. Toggle consent off → `reset()` / opt-out; beacons stop.
  4. Full purchase end-to-end → `subscribe_succeeded` appears on the **same** person as the
     pre-signup anonymous events (identity merge worked).
  5. Funnel insight renders end-to-end with a `utm_source` breakdown.

## Files touched (anticipated)

**New**
- `components/site/posthog-provider.tsx`
- `lib/posthog-events.ts` (client wrapper)
- `lib/posthog-server.ts` (server, `posthog-node`)
- `docs/posthog-funnel.md` — PostHog account/project setup + the saved-funnel/dashboard recipe (cross-linked from `docs/services.md`)

**Modified**
- `next.config.ts` (rewrites + `skipTrailingSlashRedirect`)
- `proxy.ts` (matcher excludes `/ingest`)
- `app/layout.tsx` (mount `<PostHogProvider initialConsent={…}/>`)
- `components/site/view-content-pixel.tsx`, `components/watch/player.tsx`,
  `components/watch/paywall.tsx`, `components/site/complete-registration-pixel.tsx`,
  `app/subscribe/submit-button.tsx` (add named events)
- `app/api/webhooks/stripe/route.ts` (server `subscribe_succeeded` in the transition guard)
- `app/(public)/cookies/`, `app/(public)/privacy/` (sub-processor disclosure)
- `CLAUDE.md`, `docs/architecture.md`, `docs/services.md`, `docs/gotchas.md`
- `package.json` (`posthog-js`, `posthog-node`)
- `.env` / Vercel env (`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_HOST`)

## External setup (you, outside the repo)

1. Create a PostHog Cloud **EU** project; copy the project API key.
2. Enable **Session replay** and **Heatmaps** in project settings.
3. Add the three env vars to Vercel (and `.env` for local).
4. After deploy, build the saved Funnel + "Ads funnel" dashboard per the docs recipe.
