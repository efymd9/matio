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
      stripe/              # customer.subscription.*, invoice.{paid,payment_failed}
  subscribe/               # /subscribe — radio-card pricing + Checkout redirect
  watch/[showSlug]/        # /watch/<slug> — public, trial-aware
components/
  ui/                      # shadcn primitives (Base UI under the hood)
  admin/                   # admin-specific (upload widget, status select)
  watch/                   # player + paywall
db/
  index.ts                 # postgres-js client (prepare: false for pooler)
  schema/                  # one file per domain; re-exported from schema/index.ts
drizzle/                   # migrations (sql) + drizzle-kit meta
lib/
  admin.ts                 # getCurrentUser / requireAdmin
  mux.ts                   # lazy Mux SDK client
  mux-token.ts             # RS256 JWT signer for signed playback
  stripe.ts                # lazy Stripe SDK client
  trial.ts                 # getOrCreateTrialSession, link/convert helpers
  utils.ts                 # cn() from shadcn
proxy.ts                   # Auth + admin gating + trial cookie (Next 16: was middleware.ts)
scripts/
  promote-to-admin.ts      # pnpm promote-to-admin <email>
  stripe-setup.ts          # pnpm stripe:setup — creates products+prices
```

## Key business rules

- **Trial**: anonymous, cookie-based. 60 seconds per (browser session, show). Triggered when the player on `/watch/[show-slug]` requests its first token — `/api/playback-token` mints the `trial_session` cookie and `trial_sessions` row at that point, after verifying the show is published+ready. The 60s clock starts on click-play, not on page load. Constant: `TRIAL_DURATION_SECONDS` in `lib/trial.ts`.
- Trial state survives signup + Stripe checkout via the `trial_session` cookie. `linkTrialSessionsToCurrentUser` (runs on `/subscribe` render) links unlinked rows by cookie; Stripe webhook flips `trial_sessions.converted=true` on active subscription.
- Trial creation is rate-limited at 3 per (`ip_hash`, `show_id`) per hour (`TRIAL_RATELIMIT_PER_HOUR`). `ip_hash` is `HMAC-SHA256(MUX_SIGNING_KEY_PRIVATE_KEY, client_ip)` — no raw IPs in the DB. Cap exceeded → `/api/playback-token` returns 429.
- **Subscriptions**: monthly ($9.99) or annual ($79.99), no other tiers. Stored in `subscriptions` table; mirrored from Stripe via webhook (one source of truth). A partial unique index on `(user_id) WHERE status IN ('active','trialing','past_due')` guarantees at most one access-granting row per user; historic rows (status='canceled') stay. Every subscription gate also checks `current_period_end > now()` so a dropped `customer.subscription.deleted` webhook can't extend playback past the user's term.
- **Subscribe surface**: `/subscribe` shows two radio-card plans (Monthly / Annual, Annual default). The in-player paywall (`components/watch/paywall.tsx`) also lets the user pick the plan there and forwards `?plan=…` to `/subscribe` so the selection carries through Clerk sign-in.
- **Billing portal**: `/api/billing-portal` is the single entry point — it does auth + customer lookup + Stripe billingPortal session + 302 in one server hop. The Clerk user menu's "Manage subscription" item links straight to it; no `/account` page exists.
- **Admin role**: set via DB column `users.role`, never via Clerk metadata alone. `proxy.ts` does the lookup on every `/admin/*` request via a module-scoped 5-second cache; `requireAdmin()` does it again inside actions (cache-free) for belt-and-braces.
- Playback always goes through `/api/playback-token` → signed Mux JWT. Subscriber TTL: 1 hour (auto-refreshed). Trial TTL: `min(remaining, TRIAL_DURATION_SECONDS)`.

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

## Production context

- Vercel project: `mad-matttts-projects/matio` (id `prj_bT5c7cdVTRzAIPX7uLGYjQLBF5EI`)
- Prod URL: `https://matio-ten.vercel.app`
- Neon project: `little-base-06482402` (org `Matvei`, aws-eu-central-1, Postgres 18, pooled endpoint)
- Stripe is in **test mode** (`sk_test_…`) — switch to `sk_live_…` when going live
- GitHub auto-deploy is NOT wired (Vercel account ≠ GitHub repo owner). Push via `vercel --prod --yes` from CLI.
