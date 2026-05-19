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
| `pnpm promote-to-admin <email>` | `UPDATE users SET role='admin' WHERE email=…` |
| `pnpm stripe:setup` | Idempotently create/find the two Stripe products+prices; prints `STRIPE_PRICE_*` env lines |

## DB migrations

1. Edit `db/schema/<domain>.ts`.
2. `pnpm db:generate` — emits `drizzle/<NNNN>_<slug>.sql` and updates `drizzle/meta/`.
3. **Review the generated SQL** — drizzle-kit can occasionally pick the wrong rename strategy.
4. `pnpm db:migrate` — applies pending migrations.
5. Commit both the schema files AND the `drizzle/` artifacts. Migrations are append-only.

For dev branches, `pnpm db:push` is acceptable. **Never** run `db:push` against prod (drops/recreates with no migration record).

The migrate command uses `drizzle.config.ts` which `dotenv`-loads `.env.local`. NOTICE messages about `schema "drizzle" already exists, skipping` are normal — they appear on every re-run.

## Adding new routes

Pick the right group:

- Public catalog → `app/(public)/foo/page.tsx`
- Account/billing (signed-in) → `app/(account)/foo/page.tsx`
- Admin-only → `app/admin/foo/page.tsx`
- Anonymous + cookie-managed → `app/foo/page.tsx`. Cookies must be set from a Route Handler or Server Action — proxy.ts no longer mints anything for `/watch/*`. See `app/api/playback-token/route.ts` for the trial-cookie pattern.

If the route needs auth, also update `proxy.ts`:
```ts
const isAuthRoute = createRouteMatcher(["/account(.*)", "/subscribe(.*)", "/foo(.*)"]);
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

Outputs a JSON object with the immutable deployment URL. Production alias (`matio-ten.vercel.app`) updates automatically.

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

### Trial flow (incognito, anon visitor)

1. **Incognito window** → `/`. Click the show poster → `/shows/<slug>` → Play → `/watch/<slug>`. The page renders the Player in trial mode but **no cookie is set and no `trial_sessions` row exists yet** — the 60s clock hasn't started.
2. Player mounts → fetches `/api/playback-token?episode_id=<id>`. The route handler verifies show is published+ready, runs `mintTrialSession({ sessionToken, showId, ipHash })` which creates the row with `expires_at = now + 60s` and `ip_hash = HMAC(MUX_SIGNING_KEY_PRIVATE_KEY, x-forwarded-for)`, then sets the `trial_session` cookie (HTTP-only, secure-in-prod, sameSite=lax, 1y) on the response and returns the 60s JWT.
3. Video plays in the custom mux-video + media-chrome player (cinema-red bottom bar, mono `S1·E1` kicker). After 60s the player **pauses** and the soft-sidekick paywall sheet slides up. Buffered-ahead chunks don't keep playing because the player calls `videoRef.current.pause()` at token expiry.
4. Click "Continue · Subscribe" → redirected through Clerk sign-up → back to `/subscribe?show=<slug>&resume=<seconds>` → trial linked to the new user (via `linkTrialSessionsToCurrentUser` on the page).
5. Pick a plan, use test card `4242 4242 4242 4242`, any CVC, any future date.
6. Stripe webhook → `subscriptions` row created with `status='active'` → `markUserTrialsConverted` flips `trial_sessions.converted=true` for the user's rows.
7. Redirected to `/watch/<slug>?resume=<seconds>` — player gets a 1h subscriber token, seeks to resume position.

**Verifying the IP rate-limit**: clear cookies + reload + play 3× in under an hour on the same show. The 4th attempt's `/api/playback-token` call returns `429` → player paywalls immediately without spending a fresh 60s. Different shows have independent buckets; a household sharing an IP can still trial multiple shows.

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

### Cancel + resume via Customer Portal

1. `/account` → "Manage subscription" → Stripe Customer Portal.
2. "Cancel subscription" → reason → confirm. Portal sets `subscription.cancel_at` (a timestamp, not the boolean). Our webhook mirrors both fields into `cancel_at_period_end=true`.
3. Back on `/account`, panel shows "Cancels on YYYY-MM-DD".
4. "Renew subscription" (resume) → portal clears `cancel_at` → webhook flips `cancel_at_period_end=false`.

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

**"Pricing/Subscribe button does nothing"**: missing `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` in env. Server action throws `Stripe price for monthly not configured`. Run `pnpm stripe:setup` and update env.

**"Mux upload succeeds, episode stays processing"**: webhook isn't reaching prod. Confirm Mux dashboard webhook URL points at prod and the signing secret in env matches. Test by checking Mux dashboard → Webhooks → recent deliveries.

**"Player loads but won't play"**: most likely an old public-policy playback ID or a missing/invalid `MUX_SIGNING_KEY_*`. The `/api/playback-token` route returns 200 with a JWT that mux-player rejects → `onError` fires → paywall. Check browser console for the actual Mux error.
