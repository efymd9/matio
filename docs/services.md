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

**Pay-first prerequisites (enabled 2026-06-10)**: the production instance has **"Email verification code" sign-in enabled** (Configure → User & authentication → Email). This is load-bearing for `PAY_FIRST_CHECKOUT`: guest-checkout accounts are created via the Backend API with `skipPasswordRequirement: true` — passwordless — so the email code is their **only** credential (second devices, lost-cookie webviews, the `/welcome` fallback). Do NOT disable the Password strategy: existing accounts keep theirs. The `/welcome` auto sign-in uses `signInTokens.createSignInToken` (server) + the signal-based `signIn.ticket()/finalize()` (client) — if Clerk bot protection is ever enabled, re-verify the ticket flow on `/welcome`.

**Localization**: `@clerk/localizations@^4.6.7` provides per-locale string bundles. `app/layout.tsx` reads the site locale via `getDict()` and passes the matching bundle (`enUS` default since 2026-07-04; `esES` when negotiation / geo affinity / the cookie resolves Spanish) to `ClerkProvider`'s `localization` prop. Every Clerk-rendered surface — sign-in/sign-up modal, UserButton dropdown, validation copy — picks it up. Locale changes via the in-header switcher propagate to Clerk's UI on the next `router.refresh` tick (a few hundred ms after the optimistic site dictionary flip — see [gotchas → optimistic locale state](./gotchas.md#optimistic-locale-state-not-just-context)). Adding a new locale = add another entry to the `CLERK_LOCALIZATIONS` map keyed on the site's `Locale` type.

## Stripe (subscriptions)

**Used for**: subscription billing, Checkout, Customer Portal.

**SDK**: `stripe@22.x` (Node, API 2024+). Be aware of moved fields — see [gotchas](./gotchas.md#stripe-api-2024-moves).

**Env vars**:
| Name | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | Dashboard → Developers → API keys (`sk_test_…` / `sk_live_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Dashboard → Developers → API keys (`pk_test_…` / `pk_live_…`). **Must match the secret key's mode.** Powers in-site **Embedded Checkout** on `/checkout` (the `@stripe/stripe-js` loader). NEXT_PUBLIC → inlined at **build** time, so it must be set in Vercel **before** the deploy that wants embedded. **Unset → graceful fallback**: the checkout actions create a hosted session and the `/checkout` page full-navigates to `checkout.stripe.com` exactly as before (no breakage, just not in-site). |
| `STRIPE_WEBHOOK_SECRET` | Dashboard → Developers → Webhooks → endpoint signing secret (`whsec_…`). **Different per environment.** Local `stripe listen` prints a different one than the dashboard endpoint. |
| `STRIPE_PRICE_MONTHLY` | Printed by `pnpm stripe:setup`. The recurring $38/mo membership; no annual price anymore. |
| `STRIPE_PRICE_TRIAL_FEE` | Printed by `pnpm stripe:setup`. The one-time **$1** "3-day trial" fee charged at checkout (2026-06-11). **Required** by both checkout actions — they throw without it (so it must be set before the trial code deploys). |
| `NEXT_PUBLIC_APP_URL` | Origin used in Checkout `return_url` (embedded) / `success_url` + `cancel_url` (hosted). `http://localhost:3000` locally; `https://matio.tv` in prod. |

**One-time setup**:
1. Drop a `sk_test_…` into `.env.local`.
2. `pnpm stripe:setup` (scripts/stripe-setup.ts) — idempotently creates (a) the "Matio Membership" product + a $38/mo price tagged `metadata.plan=monthly`, and (b) a "Matio — 3-day trial" product + a one-time **$1** price tagged `metadata.plan=trial_fee` (the intro trial fee). If a stale active price exists for either product at a different amount (e.g. the legacy $9.99) the script archives it and creates a new one before printing the ids — Stripe prices are immutable so the amount can't be patched in place. The intro trial = this $1 one-time price as a Checkout `line_item` + `subscription_data.trial_period_days=3` on the $38/mo price (see `lib/checkout-trial.ts`): $1 collected today, $38 starts on day 3 (status `trialing`→`active`), monthly after.
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
- **$1/3-day intro trial product+price — NOT YET CREATED IN LIVE** (trial code shipped 2026-06-11). Run `pnpm stripe:setup` against the live key to create the "Matio — 3-day trial" product + one-time $1 price, fill in the id here, set `STRIPE_PRICE_TRIAL_FEE` in Vercel prod, then redeploy. The checkout actions throw without it, so set the env var **before** the deploy goes live.
- Webhook endpoint `we_1Tbdh2CGXbzphNyzsw1zWSZf` → `https://matio.tv/api/webhooks/stripe` (apex, not www — Stripe doesn't follow 307 redirects, so a webhook URL on the www subdomain silently fails since www → apex)

**Stripe Tax**: `tax/settings.status = active`, head office GB. The live price carries `tax_behavior=exclusive` (VAT/GST added on top of $38). `startCheckout` passes `automatic_tax: { enabled: true }` + `customer_update: { address: "auto", name: "auto" }` + `billing_address_collection: "required"` so Checkout collects the billing address, computes tax, and persists the address on the Customer for renewal invoicing. **It collects $0 until a tax registration is added** in Dashboard → Tax → Registrations — the operator is a UK sole trader not yet VAT/OSS-registered, so the verified 2026-05-28 test charge was a flat $38.00 with `tax = null`. The address is captured regardless, so tax switches on automatically once a registration exists; no code change. Flip `tax_behavior` to `inclusive` on the price (one Stripe API call) if you later decide to absorb VAT instead of stacking it on top.

**EU 14-day withdrawal waiver**: `startCheckout` also passes `consent_collection: { terms_of_service: "required" }` + a localized `custom_text.terms_of_service_acceptance` so EU/UK consumers must tick a box acknowledging immediate digital-content supply (loss of the 14-day right) before paying. This requires a **Terms of service URL** set in Dashboard → Settings → Public details (`https://matio.tv/terms`) — without it the API rejects the param. Privacy policy URL is set there too (`https://matio.tv/privacy`).

**Pay-first guest checkout (`PAY_FIRST_CHECKOUT=1`, live since 2026-06-10)**: `startGuestCheckout` creates subscription-mode Checkout Sessions with **no `customer` and no `customer_update`** — Stripe auto-creates the Customer from the email typed on the hosted page (this is Stripe's default for subscription mode; `customer_creation` is a payment-mode-only param). The browser is bound via `client_reference_id` = the httpOnly `checkout_claim` cookie. Tax/waiver/locale params are identical to the signed-in flow. Env: `PAY_FIRST_CHECKOUT` (`1` = on; absent/anything else = auth-first flow; Vercel **Production** only — flip + redeploy).

**No-code Customer Portal login page** (active): `https://billing.stripe.com/p/login/dRm6oG0Yy1Ea9FHeNt0Jq00` — customers authenticate with email + one-time code (the email must match the Stripe Customer's, which guest checkout always sets). This is the account-less cancel safety net for pay-first buyers who never sign back in. Same portal configuration as the API-driven `/api/billing-portal`; customers can cancel/update card/view invoices but not change their email.

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

**Mux Data (watch-time / engagement analytics)**: Mux's analytics product. Env var `NEXT_PUBLIC_MUX_DATA_ENV_KEY` — the per-environment **Env Key** from the Mux dashboard (Settings → Data / the environment's Env Key). **Public** client-side token, distinct from `MUX_TOKEN_*` / signing key; safe to ship to the browser. Wired onto `<MuxVideo>` (`components/watch/player.tsx`) and the hero `<MuxPlayer>` (`components/site/hero-banner.tsx`) via `envKey`. **Consent-gated**: the player passes `disableTracking`/`disableCookies` and omits `envKey` unless the key is set AND `cookie_consent.marketing===true` (`lib/use-marketing-consent.ts`), so no beacons/viewer-id cookies fire pre-consent. Signed playback is unrelated to Mux Data (beacons are client-side). Leave the key blank to keep Mux Data fully off. Metadata sent: `video_id` (episode id / show slug for hero), `video_title`, `video_series` (show), `player_name` (`matio-watch` vs `matio-hero`). Watch-time, unique viewers, completion and rebuffering/QoE then appear in the Mux dashboard → Data.

**Mux Data in the Matio admin** (`/admin/analytics` "Watch time · Mux Data"): pulls real watch-time / views / unique viewers + per-show breakdown from the **Mux Data API** server-side (`lib/mux-data.ts`, plain fetch + HTTP Basic auth, cached 5 min). Needs a Mux access token with **Mux Data: Read** permission — `MUX_DATA_API_TOKEN_ID` + `MUX_DATA_API_TOKEN_SECRET` (**secret**, server-only, distinct from the env key and the video token). Create it at Mux dashboard → Settings → Access Tokens (tick *Mux Data → Read*) for the production environment. The query excludes the hero (`filters[]=!player_name:matio-hero`) so numbers reflect real content viewing. Best-effort: unconfigured → a "connect" hint, a 401/403 → a "token needs Mux Data: Read" hint, never breaks the page. Watch time is returned in milliseconds. Note Mux Data is a few minutes behind real time and a "view" coalesces pause/resume within 60 min.

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

## Vercel Blob (show artwork)

**Used for**: admin-uploaded poster + hero images on shows. Videos stay on Mux; Blob is images only.

**Store**: `matio-blob` — region **Frankfurt** (co-located with the `fra1` functions and the UK-based admin doing uploads; reads are CDN-edge-cached either way), access **Public** (required: the public pages render these URLs through `next/image`, which fetches them with no auth). Region and access are fixed at store creation.

**Setup** (one-time, already done for prod):
1. Vercel dashboard → **Storage → Create → Blob** → name it, pick Frankfurt, Public access.
2. **Connect** the store to the `matio` project — this injects `BLOB_READ_WRITE_TOKEN` into Production/Preview/Development automatically.
3. Locally: `vercel env pull` (or copy just the `BLOB_READ_WRITE_TOKEN` line into `.env.local`).

CLI equivalent for step 1: `vercel blob create-store <name>` (note: `create-store`, not `store add`).

**Env vars**:
- `BLOB_READ_WRITE_TOKEN` — **secret**. Read by `handleUpload` in `app/api/admin/upload-image/route.ts` (token minting) and by `del()` in `app/admin/actions.ts` (orphan cleanup). Leave blank to disable uploads — the drop zone surfaces an error and the paste-a-URL fallback still works.

**Flow**: drag-and-drop in the show form → `upload()` from `@vercel/blob/client` streams the file **browser → Blob** (bytes never touch our functions); our route only issues a short-lived token scoped to image content-types, ≤15 MB, and `shows/(poster|hero)-*` pathnames with `addRandomSuffix`. The resulting `https://<storeId>.public.blob.vercel-storage.com/shows/…` URL is saved in `shows.poster_image_url` / `hero_image_url` like any other URL. `updateShow` best-effort-deletes the old Blob object when artwork is replaced or cleared (only if the old URL is on the Blob host).

**next/image**: `*.public.blob.vercel-storage.com` is allowlisted in `next.config.ts` `images.remotePatterns` — a single-level wildcard covers any store id.

## Resend (email)

**Used for**: transactional email — the "new episode" reminder notifications viewers request via the series-end overlay. Nothing else: Stripe receipts and Clerk auth codes are sent by those services themselves.

**SDK**: `resend@6` (lazy client in `lib/resend.ts`, same pattern as Stripe/Mux).

**Env vars**:
| Name | Where to get it |
|---|---|
| `RESEND_API_KEY` | Resend dashboard → API Keys → create with **Sending access** only. Secret, runtime-read. Blank → email off: the capture form still stores addresses in `show_reminders`; the admin send panel shows a connect hint. |
| `RESEND_FROM` (optional) | Sender override; defaults to `Matio <updates@matio.tv>`. The domain must be verified in Resend. |
| `RESEND_REPLY_TO` (optional) | Reply-To override; defaults to `hello@matio.tv` (the real PrivateEmail mailbox). |

**Setup** (one-time):
1. Create the Resend account → **Domains → Add Domain** → `matio.tv`, region **eu-west-1** (Ireland). Region only affects where mail is routed from; Resend account data stays US-hosted regardless — the privacy policy names Resend Inc. (US) with SCCs accordingly.
2. Add the DNS records Resend shows at **Namecheap** (DNS = registrar-servers.com): a DKIM TXT at `resend._domainkey.matio.tv`, plus MX + SPF TXT on `send.matio.tv` (bounce/Return-Path subdomain). These touch neither the root SPF (`spf.privateemail.com` — the hello@ mailbox) nor Clerk's `clk*` records.
3. Recommended while in there: add a starter DMARC record at `_dmarc.matio.tv` — `v=DMARC1; p=none; rua=mailto:hello@matio.tv;` (none exists today; monitor first, tighten later).
4. Wait for the domain to verify, create the API key, then `vercel env add RESEND_API_KEY production` (+ `.env.local`) and redeploy.

**Sending model**: admin-triggered only — the "Episode reminders" panel on the show edit page claims pending `show_reminders` rows by stamping `notified_at` and batch-sends (≤100/call) with per-recipient locale, unsubscribe footer link, and RFC 8058 one-click `List-Unsubscribe` headers. A failed batch un-claims its rows. See the "Episode reminder emails" rule in CLAUDE.md.

**Limits**: free tier 100 emails/day, 3,000/month, 1 domain; API ~5 req/s. Pro ($20/mo, 50k included) removes the daily cap.

## Meta (Pixel + Conversions API)

**Used for**: advertising measurement for Facebook/Instagram campaigns. Browser **Meta Pixel** (top-of-funnel events) + server-side **Conversions API** (the reliable Purchase signal). Both are **gated on marketing consent** — nothing fires until the visitor accepts marketing cookies in the banner, consistent with the existing attribution gate.

**Setup**: Business Manager → Events Manager → Data Sources → your pixel. The Pixel ID is public; the Conversions API access token (Events Manager → Settings → Conversions API → *Generate access token*) is a secret.

**Env vars**:
- `NEXT_PUBLIC_META_PIXEL_ID` — primary pixel id (public; ships in client JS and is also read server-side for CAPI).
- `NEXT_PUBLIC_META_PIXEL_IDS` — optional; comma-separated **extra** browser pixel ids (public). `lib/meta-pixel-events.ts` exports `META_PIXEL_IDS` = primary + extras; `components/site/meta-pixel.tsx` runs one `fbq('init', …)` per id and renders one `<noscript>` img per id. `fbq('track', …)` is called with no pixel arg, so **every event fires to every pixel** — every call site hits all of them. Still consent-gated. Use this to mirror events into a second Business Manager / ad account without touching call sites.
- `META_CAPI_ACCESS_TOKEN` — Conversions API token for the **primary** pixel (**secret**, never `NEXT_PUBLIC`, never logged).
- `META_CAPI_ACCESS_TOKEN_{n}` — optional; the CAPI token for the **Nth extra** pixel, **2-based by position** in `NEXT_PUBLIC_META_PIXEL_IDS` (so `META_CAPI_ACCESS_TOKEN_2` is the first extra pixel, `_3` the second, …). `sendCapiEvents` fans the server-side event out in parallel to the primary pixel plus every extra pixel that has its own token; an extra pixel **without** a token stays browser-only (no server Purchase). Same never-throws / 3s-bounded contract; the Stripe webhook is unchanged. **Secret**, never `NEXT_PUBLIC`, never logged.
- `META_CAPI_TEST_EVENT_CODE` — optional; only while testing in the Events Manager "Test events" tab.
- `META_GRAPH_API_VERSION` — optional; defaults to `v21.0` in `lib/meta-capi.ts`. Bump when Meta deprecates the version.

**Events**:
- Browser (`lib/meta-pixel-events.ts` → `fbq`): `PageView` (all pages + SPA route changes), `ViewContent` (`/shows/[slug]`), `InitiateCheckout` (`/subscribe` submit), `Lead` + `CompleteRegistration` (signup completion — first authenticated `/subscribe`, fired together and deduped per-user via a single localStorage flag; signup is our "Lead", not the trial preview).
- Server CAPI (`lib/meta-capi.ts`): `Purchase` — fired from the Stripe webhook on the *transition into* an access-granting status (guards against renewal double-counts), `event_id = sub.id` for de-dup, with hashed email + external_id and the `_fbp`/`_fbc`/IP/UA captured at checkout.

**Identity plumbing**: `_fbp`/`_fbc` are set by the browser pixel; `_fbc` is also derived from `?fbclid` in `proxy.ts` (consent-gated). At checkout, `startCheckout` snapshots `_fbp`/`_fbc`/IP/UA into Stripe `subscription_data.metadata` (the `capi_*` keys, incl. a `capi_consent` sentinel) — the same channel UTM attribution uses — so the context-less webhook can match the Purchase event. See `lib/capi-identity.ts`.

**CAPI is best-effort**: `sendCapiEvents` never throws and is time-boxed (3s), so a Meta outage can't roll back the Stripe webhook's idempotency claim. If the env isn't configured it no-ops.

**Match quality**: verify events land in Events Manager (Test events tab with `META_CAPI_TEST_EVENT_CODE`, then the live event log). Add a `matio.tv` referrer restriction on the pixel in Events Manager for defence in depth.

## PostHog (funnel analytics)

**Used for**: consent-gated product analytics — identifying where visitors drop
out of the sign-up funnel, which ad campaigns convert best, and session
replay / heatmaps for qualitative debugging.

**Setup**: create a project in the **EU** region at [app.posthog.com](https://app.posthog.com).
Enable **Session replay** and **Heatmaps** in Project settings. See
[docs/posthog-funnel.md](./posthog-funnel.md) for the complete funnel setup
recipe and event list.

**Env vars**:

| Name | Notes |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | Project API key (`phc_…`). **Public** — safe in the browser bundle. Also read server-side by `posthog-node` in `lib/posthog-server.ts`. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Set to `/ingest` so the client proxies through the Next.js rewrite and bypasses ad blockers. |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` — the direct EU ingestion endpoint used by the server-side `posthog-node` client (no proxy needed server-side). |

Leave all three blank to keep PostHog entirely off — both the client provider and the server client no-op when `NEXT_PUBLIC_POSTHOG_KEY` is unset.

**`NEXT_PUBLIC_*` vars are build-time** — set them in Vercel *before* deploying, same as `NEXT_PUBLIC_META_PIXEL_ID`. Missing at build → PostHog ships disabled and needs a redeploy after adding the key.

**Events**: browser events (`lib/posthog-events.ts`): `$pageview` (every route change), `show_viewed`, `trial_play_started`, `paywall_shown`, `signup_cta_clicked`, `signup_completed`, `checkout_started`. Server event (`lib/posthog-server.ts` → `posthog-node` `captureImmediate`): `subscribe_succeeded` — fired from the Stripe webhook on the transition into an access-granting status, under the same consent guard as CAPI (`metadataHasCapiConsent`).

**Consent gate**: `components/site/posthog-provider.tsx` mirrors the Meta Pixel pattern — PostHog is not loaded at all until `cookie_consent.marketing === true`. On consent revoke: `opt_out_capturing()` + `reset()`. Ingestion is reverse-proxied through `/ingest` (Next.js rewrite in `next.config.ts`). The `/ingest` path is excluded from the `proxy.ts` Clerk matcher so Clerk doesn't intercept analytics events.

**Session replay + heatmaps**: enabled with `maskAllInputs: true` and `maskTextSelector: "*"` so no PII is recorded in replays.

**UTM normalization**: `components/site/posthog-provider.tsx` adds a `before_send` hook to `posthog.init` that runs `normalizeUtm` (`lib/utm.ts` — trim + lowercase + strip every char outside `[a-z0-9_-]`) over the auto-captured `utm_campaign` / `utm_source` / `utm_medium` on every event (and thus the derived `$initial_utm_*` person props). This mirrors the app-side normalization (`lib/attribution.ts` `clean()`, which feeds the same value into the attribution cookies, the `attribution_*` columns, and Stripe metadata) so the app and PostHog group campaigns identically. Forward-only — to fix PostHog **history**, the funnel-breakdown insights use the matching HogQL expression `replaceRegexpAll(lower(trim(properties.utm_campaign)), '[^a-z0-9_-]', '')`. Numeric Meta `{{campaign.id}}` values pass through unchanged. WHY: case drift (`TikTok` vs `tiktok`), encoded spaces, and stray junk fragment `utm_campaign` across otherwise-identical campaigns.

### Google Analytics 4

**Env vars**:

| Name | Notes |
|---|---|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 Measurement ID (`G-XXXXXXXXXX`), from the GA4 property's Web data stream. **Public** — ships in the client bundle. **Blank → GA fully off** (`components/site/google-analytics.tsx` renders `null`). |

**`NEXT_PUBLIC_*` is build-time** — set it in Vercel *before* deploying (same as the Meta / PostHog public vars). Missing at build → GA ships disabled and needs a redeploy after adding the ID.

**Consent gate**: `components/site/google-analytics.tsx` mirrors the Meta Pixel — `gtag.js` is loaded directly (no npm SDK) and only injected after `cookie_consent.marketing === true`. The tag can't be unloaded once injected, so on **withdrawal** it (1) sets GA's `ga-disable-<id>` kill-switch (`setGaDisabled(true)` in `lib/ga-events.ts`) so gtag stops sending **all** hits — including the cookieless Consent-Mode "ping" beacons that a `denied` update alone does NOT stop — (2) pushes a **Consent Mode v2** `gtag('consent','update', …'denied')` (analytics + ads storage), and (3) the live `consentRef` stops emitting `page_view`. Re-grant clears the kill-switch and updates Consent Mode back to granted. NB: Consent Mode `denied` by itself keeps beaconing anonymized pings — the `ga-disable` flag is the real stop (the gtag equivalent of `fbq('consent','revoke')`). `page_view` is sent on App-Router route changes (the inline `config` fires the first; `trackedPathRef` prevents the double-count). Helpers: `lib/ga-events.ts` (`trackGA` / `onGAReady`). No DB, no webhook, no server component — purely browser-side. The `/cookies` policy lists `_ga` / `_ga_*` and names Google Ireland Ltd as recipient.

## Service → file map

| Service | Code |
|---|---|
| Clerk | `proxy.ts`, `app/layout.tsx`, `app/api/webhooks/clerk/route.ts`, `lib/admin.ts` |
| Stripe | `lib/stripe.ts`, `app/subscribe/`, `app/api/billing-portal/route.ts`, `app/api/webhooks/stripe/route.ts`, `scripts/stripe-setup.ts` |
| Mux | `lib/mux.ts`, `lib/mux-token.ts` (playback + thumbnail JWT signers), `app/admin/actions.ts:createMuxUpload`, `app/api/webhooks/mux/route.ts`, `app/api/playback-token/route.ts`, `components/admin/upload-widget.tsx`, `components/watch/player.tsx`, `components/watch/episodes-overlay.tsx`, `components/watch/up-next-overlay.tsx`, `components/site/hero-banner.tsx` (mux-player hero preview) |
| Neon | `db/index.ts`, `db/schema/*.ts`, `drizzle.config.ts`, `drizzle/` |
| Vercel | platform-only; see [operations.md](./operations.md#deploy) |
| Vercel Blob | `app/api/admin/upload-image/route.ts` (token issuer), `components/admin/image-upload-field.tsx` (drag-and-drop client), `app/admin/actions.ts:deleteOrphanedBlob` (cleanup on replace/clear), `next.config.ts` (remotePatterns) |
| Resend | `lib/resend.ts`, `lib/reminder-email.ts`, `lib/email-unsubscribe.ts`, `app/admin/reminder-actions.ts`, `components/admin/reminders-panel.tsx`, `components/watch/series-end-overlay.tsx`, `app/watch/actions.ts:subscribeToShowReminder`, `app/(public)/unsubscribe/`, `app/api/email/unsubscribe/route.ts` |
| Meta | `lib/meta-pixel-events.ts`, `lib/meta-capi.ts`, `lib/capi-identity.ts`, `components/site/meta-pixel.tsx`, `components/site/view-content-pixel.tsx`, `components/site/complete-registration-pixel.tsx`, `app/subscribe/{actions.ts,submit-button.tsx,page.tsx}`, `app/api/webhooks/stripe/route.ts`, `proxy.ts` |
| PostHog | `components/site/posthog-provider.tsx`, `lib/posthog-events.ts`, `lib/posthog-server.ts`, `app/api/webhooks/stripe/route.ts`, `next.config.ts` (rewrite), `proxy.ts` (matcher exclusion) |
| Google Analytics | `components/site/google-analytics.tsx`, `lib/ga-events.ts`, `app/layout.tsx` (mount) |
