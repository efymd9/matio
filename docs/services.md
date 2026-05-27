# External Services

Setup steps + service-specific quirks for Clerk, Stripe, Mux, Neon, Vercel. Cross-references: [architecture](./architecture.md), [operations](./operations.md), [gotchas](./gotchas.md).

Production prod URL: **https://matio.tv**. Stripe webhook URL on prod = `https://matio.tv/api/webhooks/stripe`, etc.

## Clerk (authentication)

**Used for**: sessions, sign-in/sign-up UI (hosted Account Portal), `user.created` webhook.

**SDK**: `@clerk/nextjs@7.3.x`. Note Clerk 7 dropped `<SignedIn>` / `<SignedOut>` — use `<Show when="signed-in">` instead (see [gotchas](./gotchas.md#clerk-7-changes)).

**Env vars**:
| Name | Where to get it |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Dashboard → API keys (`pk_test_…` / `pk_live_…`) |
| `CLERK_SECRET_KEY` | Same place (`sk_test_…` / `sk_live_…`) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Dashboard → Webhooks → endpoint signing secret (`whsec_…`) |

**Local-dev shortcut**: leave the publishable/secret keys blank in `.env.local` and Clerk will write a "keyless" dev instance to `.clerk/.tmp/keyless.json` (gitignored). Useful for spinning up locally without creating an app. **Doesn't work in production** — keyless tokens are dev-only.

**Webhook setup**:
1. Dashboard → Webhooks → Add endpoint
2. URL: `https://matio.tv/api/webhooks/clerk`
3. Subscribe to `user.created`
4. Copy the endpoint's signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`

Handler (`app/api/webhooks/clerk/route.ts`) uses `verifyWebhook(req)` from `@clerk/nextjs/webhooks` (not `/server`). It picks up the secret from env automatically.

**Production instance**: live as of 2026-05-27 on the custom domain `clerk.matio.tv` / `accounts.matio.tv`. DNS records (`accounts`, `clerk`, `clk._domainkey`, `clk2._domainkey`, `clkmail`) are CNAMEs configured at Namecheap. Keys (`pk_live_…`, `sk_live_…`) and a fresh webhook signing secret are in Vercel production env.

**Localization**: `@clerk/localizations@^4.6.7` provides per-locale string bundles. `app/layout.tsx` reads the site locale via `getDict()` and passes the matching bundle (`esES` default, `enUS` when the cookie says so) to `ClerkProvider`'s `localization` prop. Every Clerk-rendered surface — sign-in/sign-up modal, UserButton dropdown, validation copy — picks it up. Locale changes via the in-header switcher propagate to Clerk's UI on the next `router.refresh` tick (a few hundred ms after the optimistic site dictionary flip — see [gotchas → optimistic locale state](./gotchas.md#optimistic-locale-state-not-just-context)). Adding a new locale = add another entry to the `CLERK_LOCALIZATIONS` map keyed on the site's `Locale` type.

## Stripe (subscriptions)

**Used for**: subscription billing, Checkout, Customer Portal.

**SDK**: `stripe@22.x` (Node, API 2024+). Be aware of moved fields — see [gotchas](./gotchas.md#stripe-api-2024-moves).

**Env vars**:
| Name | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | Dashboard → Developers → API keys (`sk_test_…` / `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Dashboard → Developers → Webhooks → endpoint signing secret (`whsec_…`). **Different per environment.** Local `stripe listen` prints a different one than the dashboard endpoint. |
| `STRIPE_PRICE_MONTHLY` | Printed by `pnpm stripe:setup`. Single $38/mo membership; no annual price anymore. |
| `NEXT_PUBLIC_APP_URL` | Origin used in Checkout `success_url` / `cancel_url`. `http://localhost:3000` locally; `https://matio.tv` in prod. |

**One-time setup**:
1. Drop a `sk_test_…` into `.env.local`.
2. `pnpm stripe:setup` (scripts/stripe-setup.ts) — idempotently creates the single "Matio Membership" product + a $38/mo price, tagged with `metadata.plan=monthly`. If a stale active price exists for that product at a different amount (e.g. the legacy $9.99) the script archives it and creates a new one before printing the id — Stripe prices are immutable so the amount can't be patched in place.
3. **Customer Portal** — Dashboard → Settings → Billing → Customer portal. Enable "Cancel subscriptions" (mode: at period end). This is what makes the "Manage subscription" button work.
4. **Local webhook**: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → it prints a `whsec_…` → paste into `.env.local` `STRIPE_WEBHOOK_SECRET`.
5. **Prod webhook**: Dashboard → Developers → Webhooks → Add endpoint → `https://matio.tv/api/webhooks/stripe` → subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
6. Copy that endpoint's signing secret to Vercel as `STRIPE_WEBHOOK_SECRET` (different value from local).

**Live mode (current)**: production has been on `sk_live_…` since 2026-05-27. Current live artifacts:
- Product `prod_UatJzLBiTYS8pS` ("Matio Membership")
- Price `price_1TbhWlCGXbzphNyzoAGW3wXM` — $38/mo USD, `tax_behavior=exclusive`
- Webhook endpoint `we_1Tbdh2CGXbzphNyzsw1zWSZf` → `https://matio.tv/api/webhooks/stripe` (apex, not www — Stripe doesn't follow 307 redirects, so a webhook URL on the www subdomain silently fails since www → apex)

**Stripe Tax**: `tax/settings.status = active`, head office GB. The live price carries `tax_behavior=exclusive` (VAT/GST added on top of $38). `startCheckout` passes `automatic_tax: { enabled: true }` + `customer_update: { address: "auto", name: "auto" }` + `billing_address_collection: "required"` so Checkout collects the billing address, computes tax, and persists the address on the Customer for renewal invoicing. Flip `tax_behavior` to `inclusive` on the price (one Stripe API call) if you decide to absorb VAT instead of stacking it on top.

**Test mode → Live mode flow** (for reference / re-running): swap `sk_test_…` for `sk_live_…`, run `pnpm stripe:setup` against live (idempotent product + price create), create the live webhook endpoint, repush all env vars. The Stripe accounts (test/live) are separate.

**Stripe CLI install on macOS** (when `brew install stripe/stripe-cli/stripe` fails because Xcode CLT is outdated):
```bash
curl -fsSL -o /tmp/stripe.tar.gz \
  https://github.com/stripe/stripe-cli/releases/download/v1.40.9/stripe_1.40.9_mac-os_arm64.tar.gz
tar -xzf /tmp/stripe.tar.gz -C /tmp
mv /tmp/stripe /opt/homebrew/bin/stripe
chmod +x /opt/homebrew/bin/stripe
stripe login
```

## Mux (video)

**Used for**: direct uploads, transcoding, signed playback, signed thumbnail stills. Webhook types we care about: `video.asset.ready`, `video.asset.errored`.

**SDK**:
- `@mux/mux-node@14` (server)
- `@mux/upchunk@3` (browser uploader)
- `@mux/mux-video-react@0.31` (headless video element used for the main player chrome)
- `media-chrome@4.19` (player chrome primitives — `MediaController`, `MediaPlayButton`, `MediaTimeRange`, etc.; menu primitives live at `media-chrome/react/menu`)
- `@mux/mux-player-react@3.13` (retained only for the auto-playing hero preview on `/`)

**Env vars**:
| Name | Where to get it |
|---|---|
| `MUX_TOKEN_ID` | Dashboard → Settings → Access Tokens. Needs Mux Video read+write. |
| `MUX_TOKEN_SECRET` | Same — only shown once at creation. |
| `MUX_WEBHOOK_SIGNING_SECRET` | Dashboard → Settings → Webhooks → endpoint signing secret. |
| `MUX_SIGNING_KEY_ID` | Dashboard → Settings → Signing Keys → "Key ID". |
| `MUX_SIGNING_KEY_PRIVATE_KEY` | The private key downloads as a PEM. **Base64-encode the whole PEM** (newlines and all) and put it in env. We decode in `lib/mux-token.ts`. |

**Why base64?** Multi-line PEM in env vars is fragile across hosting platforms (some strip/escape newlines). `base64 -i key.pem | tr -d '\n'` collapses it to a single string.

**Dual use**: `MUX_SIGNING_KEY_PRIVATE_KEY` is also used as the HMAC salt in `lib/trial.ts:hashClientIp` for the trial-creation IP rate-limit bucket. No raw client IPs are stored — only the SHA-256 HMAC. If you rotate the Mux signing key, existing `trial_sessions.ip_hash` values become inert (the bucket key changes), which is fine: legitimate users get fresh trial budgets and the prior abuse window is closed.

**Webhook setup**: Dashboard → Settings → Webhooks → URL = `https://matio.tv/api/webhooks/mux`. Mux delivers all event types — handler ignores the ones it doesn't care about.

**Local webhook**: Mux doesn't have a `stripe listen`-equivalent. Use an `ngrok` tunnel (`ngrok http 3000`) and point a separate Mux webhook at the ngrok URL. Webhook secret will be different from prod.

**Public vs Signed playback policy**: new uploads use `playback_policies: ["signed"]` (see `app/admin/actions.ts:createMuxUpload`). Signed playback IDs require a valid JWT — that's what gates the paywall. Old uploads with `playback_policies: ["public"]` play **without a token** even if we issue one — Mux Player just ignores it. To gate existing assets, either re-upload or add signed playback IDs via the Mux API (TODO: write a migration script if needed).

**Test mode**: Mux distinguishes between environments at the dashboard level (top-left switcher). Each environment has its own tokens, signing keys, webhooks.

**Production hardening — referrer restrictions on the signing key**: Mux lets you bind a signing key to specific referrer domains via the dashboard (Settings → Signing Keys → Edit → Domain restrictions). Add `matio.tv` (the production custom domain) so a leaked playback JWT — for example one extracted from the auto-playing hero preview on `/` — can't be used from any other origin. The hero preview's TTL is already capped at `TRIAL_DURATION_SECONDS` (see `app/(public)/page.tsx`), but referrer-binding is what stops an attacker from streaming the same asset from their own page during the 60-second window.

## Neon (Postgres)

**Used for**: the application database via Drizzle ORM.

**SDK**: `postgres@3.4` driver via `drizzle-orm/postgres-js`.

**Env vars**:
| Name | Where to get it |
|---|---|
| `DATABASE_URL` | Neon console → Connection Details → **Pooled connection** string. Must include the `-pooler` subdomain and `?channel_binding=require&sslmode=require`. |

**Project context** (already provisioned): project id `little-base-06482402`, org `Matvei` (`org-bitter-breeze-88568674`), region `aws-eu-central-1`, Postgres 18. Pooled endpoint: `ep-jolly-base-alxh3o8i-pooler.c-3.eu-central-1.aws.neon.tech`.

**Driver config** (`db/index.ts`):
```ts
postgres(connectionString, { prepare: false, max: 1 });
```
`prepare: false` is **required** for pgbouncer transaction-pool mode (the pooled endpoint). Without it you'll see prepared-statement errors under load. `max: 1` caps each serverless isolate to a single connection so traffic bursts don't exhaust Neon's pooler limit — see [gotchas → Neon / postgres-js](./gotchas.md#neon--postgres-js).

**Migrations**: Drizzle schemas in `db/schema/*.ts`. `drizzle.config.ts` uses the same `DATABASE_URL`. See [operations.md → DB migrations](./operations.md#db-migrations).

**Neon MCP**: agents can query / introspect the DB via MCP tools (`mcp__Neon__run_sql`, `mcp__Neon__list_projects`, etc.) when configured. Useful for one-off debugging without dropping into psql.

## Vercel (hosting)

**Used for**: production hosting + preview deployments.

**Account**: `mad-matttts-projects/matio` (project id `prj_bT5c7cdVTRzAIPX7uLGYjQLBF5EI`, team id `team_UHZkCJeZjplSYAOzioSexjBo`).

**Production aliases**: `https://matio.tv` (stable alias) + immutable URL per deployment.

**CLI setup** (one-time):
```bash
npm i -g vercel
vercel whoami   # triggers device-code login if unauthenticated
vercel link --yes
```

**Env var push** (per variable, per environment):
```bash
echo -n "value" | vercel env add NAME production
```
Can't pass multiple environments in one call. For preview, you also need a git branch arg — skip until git integration is set up.

**Redeploy** to pick up env var changes:
```bash
vercel --prod --yes
```
Existing deployments keep their snapshot of env vars — only the **next** deploy picks up changes.

**GitHub auto-deploy**: not currently wired. The Vercel account (`mad-matttts-projects`) doesn't have access to the GitHub user `efymd9`'s repo. To enable, install the Vercel GitHub App on the `efymd9` account from the Vercel dashboard.

**Build settings**: framework auto-detected as Next.js. Routes are dynamic (`ƒ`) by default since they hit DB / cookies.

## Service → file map

| Service | Code |
|---|---|
| Clerk | `proxy.ts`, `app/layout.tsx`, `app/api/webhooks/clerk/route.ts`, `lib/admin.ts` |
| Stripe | `lib/stripe.ts`, `app/subscribe/`, `app/api/billing-portal/route.ts`, `app/api/webhooks/stripe/route.ts`, `scripts/stripe-setup.ts` |
| Mux | `lib/mux.ts`, `lib/mux-token.ts` (playback + thumbnail JWT signers), `app/admin/actions.ts:createMuxUpload`, `app/api/webhooks/mux/route.ts`, `app/api/playback-token/route.ts`, `components/admin/upload-widget.tsx`, `components/watch/player.tsx`, `components/watch/episodes-overlay.tsx`, `components/watch/up-next-overlay.tsx`, `components/site/hero-banner.tsx` (mux-player hero preview) |
| Neon | `db/index.ts`, `db/schema/*.ts`, `drizzle.config.ts`, `drizzle/` |
| Vercel | platform-only; see [operations.md](./operations.md#deploy) |
