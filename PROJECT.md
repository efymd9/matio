# Streaming Platform — Build Plan

A Netflix-style streaming platform for your studio's content. Subscription-based, with a 5-minute free trial unlocked via ad banners. Built solo with Claude Code as your pair programmer.

This document is your single source of truth. Save it in your repo as `PROJECT.md` and reference it every time you start a new Claude Code session.

---

## 1. What we're building

**Public side**
- Landing page with hero + ad banners promoting specific shows
- Sign-up / sign-in (email + password)
- Browse catalog (shows → seasons → episodes), Netflix-style rows
- Show detail page with episode list, "Subscribe" CTA, and a "Watch 5 min free" CTA when there's an active banner promo
- Video player with adaptive streaming + signed playback tokens
- Subscription checkout (monthly / annual) + customer portal for managing billing
- Account page (profile, subscription status, watch history)

**Admin side** (multi-user, role-gated)
- Login (same auth, role = `admin`)
- Upload videos (direct-to-Mux), attach to shows/seasons/episodes
- Manage shows: create, edit metadata, set artwork, publish/unpublish
- Manage ad banners: create promo banners that unlock trials for specific shows
- Analytics: signups, MRR, churn, top shows by minutes watched
- User management: list users, view subscription status, comp/cancel

**Out of scope for v1** (deliberately deferred)
- Mobile apps (web-only first; PWA possible later)
- Multiple profiles per account
- Downloads / offline viewing
- Subtitles management UI (Mux can auto-generate; we'll surface them but not edit)
- Recommendations engine
- Live streaming

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript | You already know it; great Vercel integration |
| Database | Postgres on Neon | Vercel-native, generous free tier, real DB (not SQLite) for production |
| ORM | Drizzle | You already know it; type-safe; works great with Postgres |
| Auth | Clerk | Email+password, password reset, sessions, role metadata — all done. Free up to 10k MAU |
| Payments | Stripe Checkout + Customer Portal + Webhooks | Hosted UI = less code to maintain |
| Video | Mux (storage, transcoding, playback, signed URLs) | One API. ~$1/1000 min streamed |
| Player | `@mux/mux-player-react` | Drop-in component with HLS, ABR, captions |
| Email | Resend | Receipts, password resets via Clerk, marketing later |
| Hosting | Vercel | You picked this; pairs natively with Neon |
| Image hosting | Vercel Blob or Cloudflare R2 | For show artwork, banners |
| Analytics (video) | Mux Data | Free with Mux; tracks playback quality, watch time |
| Analytics (business) | PostHog (free tier) | Signup funnel, churn, feature usage |

**Note on Clerk vs Auth.js:** Auth.js is free and works fine, but credentials-based auth has a lot of footguns (password hashing, session security, password reset flows, email verification). Clerk handles all of this out of the box. For a solo founder shipping fast, the time saved is worth more than $0/mo on the free tier.

**Estimated monthly cost at low scale (under 100 paying users):** ~$0–25/mo. Mux is the variable: 100 users × 10 hours/mo = ~$60/mo on streaming. Everything else free tier.

---

## 3. Data model

This is the rough shape. Claude Code will turn it into Drizzle schemas.

```
users (managed by Clerk; we mirror id + role + stripe_customer_id)
  - id (clerk user id)
  - email
  - role: 'user' | 'admin'
  - stripe_customer_id
  - created_at

subscriptions
  - id
  - user_id → users.id
  - stripe_subscription_id
  - status: 'active' | 'past_due' | 'canceled' | 'trialing'
  - plan: 'monthly' | 'annual'
  - current_period_end
  - cancel_at_period_end
  - updated_at

shows
  - id
  - slug (unique, URL-safe)
  - title
  - description
  - poster_image_url
  - hero_image_url
  - genre[]
  - status: 'draft' | 'published'
  - created_at, updated_at

seasons
  - id
  - show_id → shows.id
  - number (1, 2, 3…)
  - title (optional)
  - description (optional)

episodes
  - id
  - season_id → seasons.id
  - number
  - title
  - description
  - duration_seconds
  - mux_asset_id
  - mux_playback_id
  - status: 'processing' | 'ready' | 'errored'
  - released_at

ad_banners
  - id
  - show_id → shows.id (the show this banner promotes)
  - title, subtitle
  - image_url
  - cta_text (default: "Watch 5 min free")
  - active: boolean
  - starts_at, ends_at
  - position: int (for ordering on home page)

trial_redemptions
  - id
  - user_id → users.id
  - show_id → shows.id
  - banner_id → ad_banners.id
  - started_at
  - expires_at  (started_at + 5 min)
  - UNIQUE(user_id, show_id)   -- one trial per show per user

watch_progress
  - id
  - user_id → users.id
  - episode_id → episodes.id
  - position_seconds
  - completed: boolean
  - updated_at
```

The `UNIQUE(user_id, show_id)` on `trial_redemptions` is the anti-abuse mechanism: clearing cookies doesn't help because they need to be logged in, and they can't redeem a trial for the same show twice.

---

## 4. The trial system, explained

This is the trickiest piece, so worth a deep dive.

**Flow:**
1. User lands on home page. Sees an ad banner: "Watch *The Studio's New Drama* — 5 min free."
2. Clicks the banner.
3. If not signed in → redirect to sign-up, then return to step 4.
4. Server checks `trial_redemptions` for `(user_id, show_id)`. If exists, redirect to subscribe page. Otherwise, create row with `expires_at = now + 5min`.
5. Redirect to player for the first episode of that show.
6. Player calls `/api/playback-token?episode_id=...`.
7. Server logic for token issuance:
   - Is user subscribed (`subscriptions.status = 'active'`)? → issue normal token (1 hour TTL, can re-issue freely).
   - Else, is there an unexpired `trial_redemption` for this show? → issue token with TTL = `min(expires_at - now, 6 minutes)`.
   - Else → 403, redirect to subscribe page.
8. Token is a Mux signed JWT. Mux refuses playback when it expires, no matter what the client does.
9. Client also has a 5-minute timer that pauses playback and shows a paywall, for nice UX (don't let them watch until token expiry mid-scene).

**Why this is robust:**
- Auth-gated → can't re-trial by clearing cookies.
- DB-tracked redemptions → can't re-trial the same show.
- Mux signed tokens → can't bypass via DevTools (server controls expiry).
- One token request per session → can't extend by hammering the endpoint.

**Edge cases to handle:**
- User starts trial, closes tab at 2 min, comes back: resume from where they left off, with remaining 3 min. (Use `started_at` to compute remaining.)
- Trial expires mid-episode: paywall takes over the player UI.
- Subscription expires while watching: token is still valid for current TTL; on next refresh, paywall.

---

## 5. Build phases

Each phase is one or more Claude Code sessions. Don't skip ahead. Commit (git) after every working phase.

### Phase 0 — Setup (≈ 30 min)

**Goal:** Empty Next.js project deployed to Vercel, connected to Neon, with Clerk wired in.

**Accounts to create first:**
- Vercel
- Neon (or use Vercel Postgres which is Neon under the hood)
- Clerk
- Stripe (test mode is fine for now)
- Mux (also free trial)
- Resend
- GitHub (for the repo)

**Claude Code prompt:**
> Create a new Next.js 15 project with App Router and TypeScript. Set up Drizzle ORM with Postgres (connection string in `.env.local`). Add Clerk for auth following their Next.js App Router quickstart. Add a basic landing page that says "Hello" and is protected by a feature flag. Push to a new GitHub repo. Don't deploy yet.

**Verify:**
- `npm run dev` shows the page.
- Sign-up via Clerk works locally.
- `drizzle-kit push` runs without error.

Then deploy to Vercel: link the GitHub repo, paste env vars from `.env.local`, deploy.

---

### Phase 1 — Schema + Admin role (≈ 1 hour)

**Goal:** All DB tables exist. You can mark yourself as admin.

**Claude Code prompt:**
> Using the data model in `PROJECT.md` section 3, create Drizzle schema files for: users, subscriptions, shows, seasons, episodes, ad_banners, trial_redemptions, watch_progress. Add a Clerk webhook handler at `/api/webhooks/clerk` that mirrors users to our `users` table on `user.created`. Add a one-off script `scripts/promote-to-admin.ts` that takes an email and sets `role = 'admin'`. Generate and run the migration.

**Verify:**
- Tables exist in Neon dashboard.
- Sign up via Clerk → row appears in `users`.
- Run script → role flips to admin.

---

### Phase 2 — Admin: shows, seasons, episodes (≈ 2–3 hours)

**Goal:** You can log into `/admin`, create a show, add a season, create an episode (without video yet).

**Claude Code prompt:**
> Build admin routes under `/admin`. Protect them with middleware that checks `users.role = 'admin'` for the current Clerk user. Build CRUD UI for shows (list, create, edit, delete with soft-delete). Inside a show's edit page, allow adding seasons. Inside a season, allow adding episodes (no video yet — just title/description/number). Use shadcn/ui for components. Don't make it pretty yet; we'll polish in Phase 7.

**Verify:**
- You can create a show with two seasons and a few empty episodes.
- A non-admin user gets 403 on `/admin`.

---

### Phase 3 — Video upload via Mux (≈ 2 hours)

**Goal:** From the admin panel, you upload a video for an episode. It transcodes. The episode shows status = ready when done.

**Claude Code prompt:**
> Add Mux integration. On the episode edit page, add a direct upload widget using `@mux/upchunk` and a server action that creates a Mux direct upload URL. Store `mux_asset_id` on the episode. Add a webhook handler at `/api/webhooks/mux` that listens for `video.asset.ready` and updates the episode with `mux_playback_id`, `duration_seconds`, and `status = 'ready'`. Also handle `video.asset.errored`.

**Verify:**
- Upload a short test video.
- Webhook fires, episode goes from `processing` to `ready`.
- Mux dashboard shows the asset.

---

### Phase 4 — Public catalog + player (≈ 3 hours)

**Goal:** Visitors can browse shows and play episodes. No paywall yet.

**Claude Code prompt:**
> Build public pages: `/` (lists published shows in Netflix-style horizontal rows, grouped by genre), `/shows/[slug]` (show detail with seasons and episodes), `/watch/[episodeId]` (video player). Use `@mux/mux-player-react`. For now, the player just uses the playback ID directly with no token (we'll add tokens in Phase 6). Save watch progress every 10 seconds to `watch_progress`.

**Verify:**
- You can navigate from home → show → episode → watch.
- Video plays.
- Watch progress is saved (check the DB).

---

### Phase 5 — Stripe subscriptions (≈ 3–4 hours)

**Goal:** Users can subscribe (monthly or annual). The DB knows their status.

**Claude Code prompt:**
> Create two Stripe products: monthly (£9.99/mo) and annual (£79.99/yr) — placeholder prices, I'll change them in Stripe dashboard. Add a `/subscribe` page with two pricing cards. On click, hit a server action that creates a Stripe Checkout Session and redirects. On success, redirect to `/account?welcome=1`. Add a Stripe webhook handler at `/api/webhooks/stripe` for: `customer.subscription.created`, `.updated`, `.deleted`, `invoice.paid`, `invoice.payment_failed`. Mirror status to our `subscriptions` table. Add a "Manage subscription" button on `/account` that opens Stripe Customer Portal.

**Verify:**
- Subscribe with Stripe test card `4242 4242 4242 4242`.
- DB shows `status = 'active'`.
- Cancel via Customer Portal → DB updates.
- Use `stripe listen --forward-to localhost:3000/api/webhooks/stripe` for local testing.

---

### Phase 6 — Signed tokens + paywall + trial system (≈ 4 hours)

**This is the big one. Read section 4 of this doc again before starting.**

**Claude Code prompt:**
> Build the playback token system. Add `/api/playback-token` that takes an `episode_id` and returns a Mux signed JWT, applying the logic in PROJECT.md section 4 (subscribed → 1h token; active trial → token capped at trial expiry; otherwise 403). Update the player to fetch a token on mount and refresh it before expiry. Add a paywall overlay component that shows when token issuance fails. Build the trial flow: ad banner click → POST `/api/start-trial?show_id=...` → creates `trial_redemptions` row (or 409 if exists) → redirects to first episode of show. Build a basic admin page to create ad banners.

**Verify:**
- Subscribed user: video plays normally.
- Logged-in non-subscriber clicks banner: 5-min trial starts, video plays for 5 min then paywall.
- Same user clicks the same banner again: redirected to subscribe page.
- Logged-in non-subscriber tries to watch without clicking a banner: paywall.
- Logged-out user clicks banner: redirected to sign-up, then trial starts.

---

### Phase 7 — Polish the public UI (≈ 1–2 days)

Make it actually look like Netflix. This is where the `frontend-design` skill in Claude Code shines.

**Claude Code prompt:**
> Polish the public UI to feel Netflix-like: dark theme, hero banner that auto-plays a muted preview, horizontal scrolling rows of show posters with hover-zoom, a sticky transparent-to-solid header on scroll, smooth transitions. Use Tailwind. The player page should be full-bleed with auto-hiding controls. Show detail page should have a large hero with the show's hero image and a list of episodes below.

**Verify:** It feels good on desktop and mobile.

---

### Phase 8 — Admin analytics (≈ 1 day)

**Claude Code prompt:**
> Build `/admin/analytics` with: total signups, signups in last 30 days, MRR, active subscriptions count, churn (cancellations / active at start of month), top 10 shows by total watch minutes (from `watch_progress`), trial-to-paid conversion rate (trials redeemed → subscribed within 7 days). Use Recharts for graphs. Pull video quality / playback failure data from the Mux Data API.

---

### Phase 9 — Pre-launch checklist

- [ ] Switch Stripe to live mode, real prices
- [ ] Switch Clerk to production instance
- [ ] Set up custom domain on Vercel
- [ ] Add Terms, Privacy, Cookie Policy (Termly or similar generator)
- [ ] Configure Resend with your domain (SPF, DKIM)
- [ ] Test the full signup → subscribe → cancel flow end-to-end on production
- [ ] Set up error monitoring (Sentry free tier)
- [ ] Set up uptime monitoring (BetterStack free tier)
- [ ] Tax: Stripe Tax handles VAT collection if you enable it. If you sell to EU/UK consumers and want zero tax compliance work, consider switching to Paddle later (they're merchant-of-record).

---

## 6. CLAUDE.md template

Save this at the root of your project as `CLAUDE.md`. Claude Code reads it automatically at the start of every session.

```markdown
# Project: [Studio Name] Streaming Platform

A subscription video streaming platform for our studio's original content.
Netflix-inspired UX. 5-min trial unlocked via ad banners.

## Stack
- Next.js 15 App Router, TypeScript
- Postgres (Neon), Drizzle ORM
- Clerk (auth)
- Stripe (payments)
- Mux (video)
- Tailwind + shadcn/ui
- Resend (email)
- Vercel (hosting)

## Conventions
- All DB access goes through Drizzle. Never write raw SQL except in migrations.
- All payment state changes flow through Stripe webhooks. Never trust client-side
  subscription status.
- All video playback requires a server-issued Mux signed JWT. Never expose
  playback IDs without a token.
- Server actions for mutations, route handlers for webhooks and token issuance.
- shadcn components live in `components/ui/`. Custom components in `components/`.
- Drizzle schemas in `db/schema/*.ts`, one file per logical domain.
- Env vars: Clerk = CLERK_*, Stripe = STRIPE_*, Mux = MUX_*. Never log secrets.

## File structure
- app/                       # Next.js App Router pages
  - (public)/                # Public-facing pages
  - (auth)/                  # Sign-in, sign-up
  - (account)/               # Account, billing — requires auth
  - admin/                   # Admin panel — requires admin role
  - api/                     # Route handlers (webhooks, tokens)
  - watch/[episodeId]/       # Video player
- components/                # React components
- db/                        # Drizzle schema and client
- lib/                       # Utilities (mux, stripe, auth helpers)
- middleware.ts              # Auth and admin gating

## Key business rules
- Trial: one per (user, show). Lasts 5 minutes from first click.
- Trials only start via ad banner clicks, not arbitrary URLs.
- Subscriptions: monthly or annual, no other tiers.
- Admin role is set via DB column `users.role`, never via Clerk metadata alone.

## What NOT to do
- Don't add new dependencies without asking. Lock the stack.
- Don't bypass Stripe webhooks (e.g., don't mark a user "subscribed" from the
  client after Checkout success — wait for the webhook).
- Don't issue playback tokens with TTL > 1 hour.
- Don't store credit card details. Stripe handles all of that.
- Don't roll our own auth or password handling. Clerk owns that.
```

---

## 7. How to drive Claude Code (since you said limited coding experience)

**Install:** `npm install -g @anthropic-ai/claude-code`, then run `claude` in your project directory. Docs: https://docs.claude.com/en/docs/claude-code/overview.

**Workflow per phase:**
1. Read the phase in this doc.
2. In your terminal, `cd` into the project, run `claude`.
3. Paste the prompt for that phase. Add any specifics ("name the show 'Test' for now").
4. Claude Code will propose a plan and ask for confirmation before making changes. **Read the plan.** If it's doing something unexpected, ask why.
5. Let it write code. It'll show diffs. Skim them — you don't need to understand every line, but watch for things that contradict `CLAUDE.md`.
6. Run the dev server (`npm run dev`) and test the success criteria.
7. If broken, paste the error to Claude Code. Don't guess.
8. Commit: `git add . && git commit -m "phase N: [what you built]"`. Push to GitHub.

**Sanity rules:**
- Never let Claude Code "fix" a Stripe or Mux webhook signature error by disabling the check. The error means something legitimate.
- If you're 30+ minutes into debugging the same thing, stop and start a fresh Claude Code session — context drift is real.
- Test mode for Stripe + Clerk dev instance + Mux dev environment for as long as possible. Don't switch to live until Phase 9.

---

## 8. Gotchas worth knowing in advance

1. **Stripe webhooks need raw body**, not parsed JSON. Next.js App Router needs `runtime = 'nodejs'` and reading the request as text. Claude Code knows this but verify the handler doesn't break with `application/json` parsing.

2. **Clerk webhooks similarly need raw body verification** (Svix signature).

3. **Mux signed JWTs**: signed with a Mux signing key (not your API secret). Generate the key in the Mux dashboard, store the private key as a multi-line env var. Use `jsonwebtoken` library.

4. **Vercel serverless functions have a 10s timeout on Hobby plan.** Your webhooks should respond fast (just queue work or update DB and return 200). Long video uploads go directly to Mux from the browser, not through your server.

5. **Neon's free tier sleeps after 5 min idle.** First request after idle takes ~1s. Fine for now; on Pro you can disable suspend.

6. **Don't expose `mux_playback_id` in API responses to non-subscribers.** That ID alone, with a public Mux account, can stream the video. Always issue tokens server-side and only return the token + a "needs-token" flag to the client.

7. **Stripe annual plans need `interval: 'year'`** in the price config. Easy to misconfigure.

8. **Email deliverability:** even with Resend, your first emails will hit spam until you've sent 50+ to engaged recipients. Don't panic when your password reset email goes to junk on day one.

---

## 9. Realistic timeline

Solo, working evenings + weekends, with Claude Code:

- Phases 0–3 (setup → admin can upload videos): **1 week**
- Phases 4–6 (public + Stripe + trial system): **2 weeks**
- Phase 7 (polish UI to ship-quality): **1 week**
- Phase 8–9 (analytics + pre-launch): **1 week**

**Total: ~5 weeks to a real launch.** Probably 6–7 with surprises. If anyone tells you "build a Netflix clone in a weekend," they're either lying or skipping the parts that matter (payments, DRM, admin).

---

## 10. After launch — what's next

- Multi-profile (kids profile, etc.)
- Subtitles editing UI
- Recommendations (start simple: "more from this genre")
- Mobile apps (React Native or PWA)
- Search
- Live-streaming (Mux supports this too)
- Affiliate program (you've already done this for Alvin — reuse the playbook)
