# Operations

Day-to-day commands, deployment workflow, and end-to-end test recipes. See also [services](./services.md) for setup steps and [gotchas](./gotchas.md) for pitfalls.

## Local development

```bash
# Once
pnpm install
cp .env.example .env.local      # fill in values per docs/services.md

# Each dev session
pnpm dev                         # next dev --turbopack on :3000
```

Clerk runs in **keyless** mode if you leave `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` blank — first dev boot creates `.clerk/.tmp/keyless.json` (gitignored) with throwaway dev keys.

Poster/hero drag-and-drop needs `BLOB_READ_WRITE_TOKEN` (injected by the connected Blob store — grab it with `vercel env pull`, or copy just that line into `.env.local`). Left blank, the drop zone errors cleanly and the paste-a-URL fallback still works.

## pnpm scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server with Turbopack on port 3000 |
| `pnpm build` | Production build (`next build`) |
| `pnpm start` | Run the built app |
| `pnpm lint` | ESLint (flat config, native to Next 16) |
| `pnpm typecheck` | `tsc --noEmit` — fast standalone typecheck |
| `pnpm db:generate` | Diff `db/schema/*.ts` against the last snapshot → write a new migration file under `drizzle/` |
| `pnpm db:migrate` | Apply pending migrations against `DATABASE_URL` |
| `pnpm db:push` | (Use sparingly.) Skip migration files; push schema directly to DB — declarative mode |
| `pnpm db:studio` | Open Drizzle Studio (web UI for the DB) |
| `pnpm db:check-sub-dupes` | Pre-flight gate for migration 0008 (partial unique on access-granting subs). Exits non-zero if any user has multiple rows in active/trialing/past_due — clean those up before `db:migrate` or 0008 will fail to apply on a fresh env. |
| `pnpm promote-to-admin <email>` | `UPDATE users SET role='admin' WHERE email=…` |
| `pnpm stripe:setup` | Idempotently create/find the two Stripe products+prices; prints `STRIPE_PRICE_*` env lines |

## DB migrations

1. Edit `db/schema/<domain>.ts`.
2. `pnpm db:generate` — emits `drizzle/<NNNN>_<slug>.sql` and updates `drizzle/meta/`.
3. **Review the generated SQL** — drizzle-kit can occasionally pick the wrong rename strategy, and any migration touching a non-trivial existing dataset (NOT NULL on an existing column, partial unique on a column with duplicates, etc.) usually wants a hand-written backfill statement inserted before the constraint.
4. **Run any pre-flight gate scripts.** On a fresh DB applying the full chain, `pnpm db:check-sub-dupes` must pass before `db:migrate` — see the scripts table above.
5. `pnpm db:migrate` — applies pending migrations.
6. Commit both the schema files AND the `drizzle/` artifacts. Migrations are append-only.

For dev branches, `pnpm db:push` is acceptable. **Never** run `db:push` against prod (drops/recreates with no migration record).

The migrate command uses `drizzle.config.ts` which `dotenv`-loads `.env.local`. NOTICE messages about `schema "drizzle" already exists, skipping` are normal — they appear on every re-run.

## Adding new routes

Pick the right group:

- Public catalog → `app/(public)/foo/page.tsx`
- Signed-in only → `app/foo/page.tsx` + add `/foo(.*)` to `isAuthRoute` in proxy.ts (the `(account)` route group was removed; there's no signed-in shell to inherit from)
- Admin-only → `app/admin/foo/page.tsx`
- Anonymous + cookie-managed → `app/foo/page.tsx`. Cookies must be set from a Route Handler or Server Action — proxy.ts no longer mints anything for `/watch/*`. See `app/api/playback-token/route.ts` for the trial-cookie pattern.
- External redirect endpoint (e.g. billing portal) → `app/api/foo/route.ts` with a `GET` that does auth + work + `NextResponse.redirect(...)`. See `app/api/billing-portal/route.ts`.

If the route needs auth, also update `proxy.ts`:
```ts
const isAuthRoute = createRouteMatcher(["/subscribe(.*)", "/foo(.*)"]);
```

Defensive check inside the page even if proxy gates — server actions can be invoked from outside the matcher.

## Server actions

```ts
// app/<route>/actions.ts
"use server";
import { requireAdmin } from "@/lib/admin";   // or auth() for any signed-in user
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function doThing(formData: FormData) {
  await requireAdmin();                     // 401/403 happens via redirect
  // ... db mutation ...
  revalidatePath("/admin/things");          // bust the cache where data shows
  redirect("/admin/things/new-thing");      // or omit for in-place updates
}
```

In JSX:
```tsx
<form action={doThing}>
  <input name="title" />
  <button type="submit">Go</button>
</form>
```

Pre-applying args via `.bind()`:
```tsx
<form action={updateThing.bind(null, thing.id)}>
  ...
</form>
```
The bound action's signature is `(thingId, formData)`.

## Webhook handlers

```ts
// app/api/webhooks/<provider>/route.ts
import type { NextRequest } from "next/server";
export const runtime = "nodejs";          // raw body verification + DB

export async function POST(req: NextRequest) {
  const body = await req.text();           // raw body for HMAC
  try {
    const evt = await providerSdk.verifyWebhook(body, req.headers, secret);
    // ... handle evt.type
  } catch (err) {
    return new Response("Bad signature", { status: 400 });
  }
  return new Response("OK", { status: 200 });
}
```

Always idempotent (retries happen) — use `onConflictDoNothing` / `onConflictDoUpdate`.

## Deploy

```bash
vercel --prod --yes
```

Outputs a JSON object with the immutable deployment URL. Production aliases (`matio.tv` apex + `www.matio.tv` + legacy `matio-ten.vercel.app`) update automatically. The apex is the canonical surface — `www` 307-redirects to apex, so external integrations that don't follow redirects (Stripe / Mux / Clerk webhooks) **must** point at the apex form.

**Env vars**: changes to env vars in Vercel only take effect on the **next** deployment. Push then redeploy.

```bash
echo -n "the-value" | vercel env add VAR_NAME production
vercel --prod --yes
```

To overwrite an existing var:
```bash
vercel env rm VAR_NAME production --yes
echo -n "new-value" | vercel env add VAR_NAME production
```

To pull current env into a local file:
```bash
vercel env pull .env.vercel.production
```

**Marketing + analytics env vars** (consent-gated Meta Pixel / CAPI + Mux Data — all new):

| Var | Scope | What it powers |
|---|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | public | Browser Meta Pixel (PageView / ViewContent / InitiateCheckout / Lead + CompleteRegistration). Unset → pixel never injects. |
| `META_CAPI_ACCESS_TOKEN` | secret | Server-side Conversions API Purchase event from the Stripe webhook. Unset → CAPI no-ops. |
| `META_CAPI_TEST_EVENT_CODE` | secret (optional) | Routes CAPI events to Events Manager → Test Events for verification. Remove for production traffic. |
| `META_GRAPH_API_VERSION` | secret (optional) | Graph API version override; defaults to `v21.0`. |
| `NEXT_PUBLIC_MUX_DATA_ENV_KEY` | public | Enables Mux Data tracking on the watch + hero players (Mux dashboard → environment → Env Key). Unset → players pass `disableTracking`/`disableCookies` and emit no beacons. |
| `MUX_DATA_API_TOKEN_ID` | secret | `id` half of a Mux access token with **Mux Data: Read** — powers the in-admin "Watch time · Mux Data" panel. |
| `MUX_DATA_API_TOKEN_SECRET` | secret | `secret` half of the same Mux access token. |

**CAVEAT — `NEXT_PUBLIC_*` are inlined at *build* time.** `NEXT_PUBLIC_META_PIXEL_ID` and `NEXT_PUBLIC_MUX_DATA_ENV_KEY` are baked into the bundle when `vercel --prod` builds. They **must exist in Vercel *before* the build** — set them after a deploy and the feature ships disabled until you redeploy. The secrets (`META_CAPI_ACCESS_TOKEN`, `MUX_DATA_API_TOKEN_*`) are read at runtime, but a redeploy is still needed to propagate them to the functions. Net: set all seven, *then* deploy.

## End-to-end test recipes

### Sign up + admin promotion

1. Open `/`. Click "Sign up" in the header. Complete Clerk sign-up.
2. Webhook fires `user.created` → `users` table gets a row. Check:
   ```bash
   psql $DATABASE_URL -c "select id, email, role from users order by created_at desc limit 5;"
   ```
3. `pnpm promote-to-admin you@example.com` → that row's `role='admin'`.
4. Visit `/admin` — should land on the show list. Non-admins get redirected to `/`.

### Show → upload → publish

1. `/admin` → New show. Slug must be `[a-z0-9-]+`. Status defaults to draft.
2. Open the show → "Add a season" → "Manage episodes" on the new season.
3. Add an episode → click Edit on it → upload widget.
4. Upload a small video (10–30s for testing).
5. Wait ~30s. Refresh — `mux_asset_id` and `mux_playback_id` populate via webhook. Status flips to `ready`.
6. Edit the show → status=`published`. The show appears on `/`.

### Show artwork — image specs

The admin form has two artwork fields — **drag-and-drop upload** (client-direct to Vercel Blob) with an editable URL input as fallback. Both are optional (a show with neither just gets the deterministic tone-gradient placeholder), but a published show is much more compelling with real art.

**Poster** (`posterImageUrl`)
- **Aspect:** 2:3 portrait — the same shape as a printed movie poster.
- **Recommended:** **600 × 900** (covers 2× retina at the largest card size, `150 × 225` desktop). Minimum 400 × 600.
- **Where it renders:** every catalog row (`components/site/show-card.tsx`, sized via `aspect-[2/3]` + `object-cover`).
- **Where it's a fallback:** OG / Twitter unfurl image on `/shows/<slug>` when no hero is set.
- **Notes:** The card overlays a subtle bottom-to-top gradient on hover with the title — keep the bottom ~10% of the artwork unbusy, or the title becomes hard to read.

**Hero** (`heroImageUrl`)
- **Aspect:** 16:9 wide.
- **Recommended:** **2560 × 1440** (covers 4K-ish viewports without upscaling). Minimum 1920 × 1080. Don't go below 1600 wide — the hero stretches to viewport width and a 1280 image will blur on a desktop monitor.
- **Where it renders:**
  - Home page hero (`components/site/hero-banner.tsx`, `min-h-[640px] sm:h-[90vh]`, `object-cover`) — the featured show only.
  - Show detail backdrop (`app/(public)/shows/[slug]/page.tsx`, `h-[65vh] min-h-[480px]`, `object-cover`).
  - OG / Twitter unfurl on `/shows/<slug>` (cropped to 1.91:1).
- **Composition:** the page overlays the title + Play / More info CTAs in the **left third**; pages also apply a left-side scrim (`bg-gradient-to-r from-background/85`) and a bottom scrim. Compose the subject **slightly right of centre**, with safe darkness on the left. A face dead-centre tends to disappear behind the text on small screens.
- **Fallback:** if `heroImageUrl` is null the page falls through to `posterImageUrl`. A portrait poster stretched to 16:9 looks bad — set hero artwork on any show that gets featured.

**File format / size**
- JPG, PNG, WebP, or AVIF. WebP/AVIF give the smallest files at the same visual quality.
- Target weight: posters under ~150 KB, heroes under ~400 KB. All artwork goes through `next/image` (responsive `srcset` + WebP conversion at the edge) — see `next.config.ts` `images.remotePatterns`. To allow a new source host, add it there; without an entry `next/image` refuses the URL.
- Hosting: **drop the file on the field** — it uploads client-direct to Vercel Blob (`*.public.blob.vercel-storage.com`, already in `remotePatterns`) and fills the URL itself. Same-origin files committed under `public/shows/` also work (legacy shows use these). An arbitrary external URL (e.g. an Unsplash hotlink) previews fine in the admin form (raw `<img>`) but **throws in `next/image` on the public hero/detail pages** — only allowlisted hosts render. Add the host to `remotePatterns` first if you genuinely need an external source.

### Trial flow (incognito, anon visitor)

1. **Incognito window** → `/`. Click the show poster → `/shows/<slug>` → Play → `/watch/<slug>`. The page renders the Player in trial mode but **no cookie is set and no `trial_sessions` row exists yet** — the 60s clock hasn't started.
2. Player mounts → fetches `/api/playback-token?episode_id=<id>`. The route handler verifies show is published+ready, runs `mintTrialSession({ sessionToken, showId, ipHash })` which creates the row with `expires_at = now + 60s` and `ip_hash = HMAC(MUX_SIGNING_KEY_PRIVATE_KEY, x-forwarded-for)`, then sets the `trial_session` cookie (HTTP-only, secure-in-prod, sameSite=lax, 1y) on the response and returns the 60s JWT.
3. Video plays in the custom mux-video + media-chrome player (cinema-red bottom bar, mono `S1·E1` kicker). After 60s the player **pauses** and the soft-sidekick paywall sheet slides up. Buffered-ahead chunks don't keep playing because the player calls `videoRef.current.pause()` at token expiry.
4. **Paywall** — the bottom sheet shows a single CTA. With `PAY_FIRST_CHECKOUT` **on**, the signed-out CTA reads "Get membership · $38/mo" and posts straight to guest Stripe Checkout (see the pay-first recipe below). With the flag **off** it opens the Clerk sign-up modal with `forceRedirectUrl=/subscribe?show=<slug>&ep=<id>&resume=<seconds>`.
5. (Flag off / signed-in path) `/subscribe` renders the single membership card. The page calls `getOrSyncCurrentUser()` (ensures the mirror row exists before `linkTrialSessionsToCurrentUser` runs — otherwise the FK on `trial_sessions.user_id` would crash on fresh signups), then `linkTrialSessionsToCurrentUser()` claims any unlinked trial rows on the cookie.
6. Click "Continue · Subscribe" → animated `SubmitButton` (uses `useFormStatus`) shows a spinner while `startCheckout` runs → redirected to Stripe Checkout. Use test card `4242 4242 4242 4242`, any CVC, any future date (test mode only).
7. Stripe webhook → `subscriptions` row created with `status='active'` → `markUserTrialsConverted` flips `trial_sessions.converted=true` for the user's rows.
8. Redirected to `/watch/<slug>?resume=<seconds>` — player gets a 1h subscriber token, seeks to resume position.

**Verifying the IP rate-limit**: clear cookies + reload + play 3× in under an hour on the same show. The 4th attempt's `/api/playback-token` call returns `429` → player paywalls immediately without spending a fresh 60s. Different shows have independent buckets; a household sharing an IP can still trial multiple shows.

### Pay-first guest purchase (`PAY_FIRST_CHECKOUT=1`)

In production this is a **real $38 charge** — use an email alias you control and refund yourself in the Stripe dashboard afterwards. Locally, test-mode card `4242…` works as usual (flag in `.env.local`).

1. **Incognito window** → `/watch/<gated-slug>` → watch through the free episodes (or deep-link a subscriber episode via `?ep=`). The paywall's signed-out CTA reads "Get membership · $38/mo" and posts `startGuestCheckout` — no Clerk modal.
2. Stripe Checkout opens with an **email field** (no pre-filled customer). Pay with a fresh email alias (e.g. `you+paytest@…`).
3. Land on `/welcome` → "Signing you in…" → "You're all set" → auto-redirect into `/watch` playing the locked episode in subscriber mode. Behind the scenes: the webhook and the page raced the same idempotent `claimGuestCheckout` + `mirrorSubscription`; whichever won, both wrote once.
4. Verify the data: Clerk dashboard has a new user with **no password**; `users` row has `signup_origin='guest_checkout'` + the new `stripe_customer_id`; `subscriptions` row is `active`; the incognito session's `trial_sessions` rows are linked (`user_id` set, `converted=true`).
5. **Second device / lost cookie**: open a different browser → `/watch/<slug>` → paywall → "Already have an account? Sign in" → enter the alias email → 6-digit code → subscriber access. (This is the passwordless account's only credential — if it fails, check the Clerk email-code sign-in toggle.)
6. **Fallback path**: paste the `/welcome?session_id=…` URL into another browser — it must show the masked email + email-code sign-in, **never** an automatic session (the `checkout_claim` cookie binding is absent there).
7. Cancel via UserButton → "Manage subscription" (or the no-code portal link with the same email), then **refund the charge** in Stripe.

Watch the `welcome_signin_succeeded` / `welcome_fallback_shown(reason)` events in PostHog — they tell you which path the buyer actually took.

### Episode swap (URL sync)

1. While watching, open the bottom-bar **Episodes** button → season-grouped overlay with Mux thumbnails.
2. Click any other episode → it swaps in place, `?ep=<id>` is added to the URL (no scroll, no page reload), the token is re-fetched for the new episode.
3. Bouncing the URL (refresh / share) lands the user on that exact episode.

### Skip-intro markers

1. `/admin` → pick a show → season → episode.
2. Under "Skip intro" enter integer seconds for Start and End (or leave both blank to hide the chip). End must be greater than Start.
3. Save. Open `/watch/<show-slug>?ep=<episode-id>` and seek to a moment inside the window — the red "Skip intro" pill appears bottom-right. Click → playhead jumps to End.

### Analytics dashboard smoke

1. Sign in as an admin → `/admin/analytics`.
2. Eight metric cards render with valid numbers (no `NaN`, no division-by-zero).
3. Daily-signups histogram shows 30 bars (oldest left → today right). Days with zero render as faint stubs.
4. Top shows list shows up to 10 rows with the highest watched-minutes show normalized to a full red bar. Empty data renders "No watch progress recorded yet."

### Meta Pixel + Conversions API

Everything here gates on `cookie_consent.marketing` — nothing fires until the visitor accepts.

1. Incognito → `/`. The cookie banner shows. With **`NEXT_PUBLIC_META_PIXEL_ID`** set in the build, click **"Accept all"** → `MetaPixel` injects `fbevents.js` and fires `PageView`. Verify in **Events Manager → your pixel → Test Events** (paste the browser into the Test Events "test in browser" field, or watch the live Overview a few minutes later). Browser events to spot-check while clicking through: `PageView` (every page + SPA nav), `ViewContent` on `/shows/<slug>`, `InitiateCheckout` on the `/subscribe` submit, and `Lead` + `CompleteRegistration` together on `/subscribe` when a new user lands there post-signup (once per user — they share one `localStorage` dedup flag, so neither re-fires on a second visit). Note: the 60s trial preview no longer fires a `Lead` — signup completion is our Lead.
2. Reload after accepting → no second banner, pixel loads from the server-read consent state. Click **"Essential only"** (or "Cookie preferences" in the footer → reject) → `fbq('consent','revoke')` fires and `clearMarketingCookies` drops `_fbp`/`_fbc` (both host-only AND `Domain=.matio.tv`). Confirm in DevTools → Application → Cookies that both are gone.
3. **Server Purchase (CAPI)**: set **`META_CAPI_TEST_EVENT_CODE`** in prod env + redeploy, then run a real test checkout (accept marketing first so the `capi_consent` sentinel rides into `subscription_data.metadata`). After the Stripe webhook flips the sub into an access-granting status, a `Purchase` appears in **Events Manager → Test Events** (server source, `event_id` = the subscription id). Check **Event Match Quality** — `_fbp`/`_fbc`/hashed email/IP/UA carried from checkout should push it above the "Poor" band. Remove `META_CAPI_TEST_EVENT_CODE` when done so live purchases stop routing to Test Events.

**No-consent sanity check**: with the banner dismissed as "Essential only", confirm `fbevents.js` never loads (Network tab), no `_fbp`/`_fbc` cookies appear, and a test checkout produces **no** server Purchase (the `capi_consent` sentinel is absent from the metadata).

### Watch-time analytics (Mux Data)

1. Build with **`NEXT_PUBLIC_MUX_DATA_ENV_KEY`** set (Mux dashboard → environment → Env Key) and accept marketing cookies. Play an episode on `/watch/<slug>` → `MuxVideo` now beacons (no `disableTracking`). Without the env key *or* without consent the player stays dark — beacons fire only when **both** hold.
2. Wait the few-minute Mux ingest lag, then check **Mux dashboard → Data → Views** — your view should appear (the home hero is filtered out via `player_name:matio-hero`; watch-page views carry `player_name:matio-watch` + `video_series`/`video_title`).
3. With **`MUX_DATA_API_TOKEN_ID` / `_SECRET`** (a Mux access token with **Mux Data: Read**) set + redeployed, open `/admin/analytics` → **"Watch time · Mux Data"** panel. It shows real total watch time (Mux returns ms — rendered as h/m), views, unique viewers, avg view length, and a per-show breakdown. Data is server-cached 5 min, so allow that for refreshes.
4. **Unconfigured / 403 path**: with the API token env vars missing (or lacking Mux Data: Read scope), the panel degrades to a hint instead of erroring — `getMuxData` returns `not_configured`/`error` and the page renders the "configure Mux Data" note. Confirm the rest of `/admin/analytics` still renders.

### Cancel + resume via Customer Portal

1. Open the Clerk user menu (top-right avatar) → **Manage subscription**. The menu item links at `/api/billing-portal` — a GET route that does auth + Stripe customer lookup + `billingPortal.sessions.create` + 302 in one server hop, so the browser lands directly on Stripe's hosted Customer Portal.
2. "Cancel subscription" → reason → confirm. Portal sets `subscription.cancel_at` (a timestamp, not the boolean). Our webhook mirrors both fields into `cancel_at_period_end=true`.
3. Come back to the app — every subscription-gated query is read-time, so the next playback request reflects the change immediately.
4. "Renew subscription" (resume) inside the portal → portal clears `cancel_at` → webhook flips `cancel_at_period_end=false`.

**No /account page**: it was removed pre-launch (placeholder rows, "Payment methods" / "Notifications" etc. were unwired). All billing surfaces route through `/api/billing-portal`. To bring `/account` back, restore `app/(account)/` from git history and re-add the matcher in `proxy.ts`.

### Inspect production logs

Via Vercel MCP:
```ts
mcp__plugin_vercel_vercel__get_runtime_logs({
  projectId: "prj_bT5c7cdVTRzAIPX7uLGYjQLBF5EI",
  teamId:    "team_UHZkCJeZjplSYAOzioSexjBo",
  environment: "production",
  since: "1h",
  query: "stripe",
})
```

Or CLI:
```bash
vercel logs https://matio-<deployment>.vercel.app --no-follow --expand --since 10m
```

## Common debug recipes

**"Webhook fired but DB didn't update"**: check Vercel runtime logs filtered to the route (`/api/webhooks/stripe`). 200 = handler ran; check that the predicate inside actually matched. 400 = signature failed; secret mismatch (very likely if you mixed local `stripe listen` whsec with prod). 500 = handler threw.

**"Trial fires but cookie isn't in browser"**: cookie is `httpOnly` — won't show in `document.cookie`. Open DevTools → Application → Cookies. Confirm it's there.

**"Pricing/Subscribe button does nothing"**: missing `STRIPE_PRICE_MONTHLY` in env. Server action throws `Stripe price for monthly not configured`. Run `pnpm stripe:setup` and update env.

**"Mux upload succeeds, episode stays processing"**: webhook isn't reaching prod. Confirm Mux dashboard webhook URL points at prod and the signing secret in env matches. Test by checking Mux dashboard → Webhooks → recent deliveries.

**"Player loads but won't play"**: most likely an old public-policy playback ID or a missing/invalid `MUX_SIGNING_KEY_*`. The `/api/playback-token` route returns 200 with a JWT that mux-player rejects → `onError` fires → paywall. Check browser console for the actual Mux error.
