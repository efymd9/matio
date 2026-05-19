# Streaming Platform — Build Plan

A Netflix-style streaming platform for your studio's content. Subscription-based, with a 5-minute free trial unlocked via ad banners. Built solo with Claude Code as your pair programmer.

This document is your single source of truth. Save it in your repo as `PROJECT.md` and reference it every time you start a new Claude Code session.

---

## 1. What we're building

**Public side**
- Landing page with hero + show carousels (any show link starts the 5-min trial)
- Browse catalog (shows → seasons → episodes), Netflix-style rows — public, no login required
- Show detail page with episode list and "Watch first 5 min free" CTA
- Video player with adaptive streaming + signed playback tokens
- 5-minute anonymous trial → paywall → sign-up + Stripe Checkout in one flow → resume watching
- Account page (profile, subscription status, watch history) — for subscribed users

**Admin side** (multi-user, role-gated)
- Login (same auth, role = `admin`)
- Upload videos (direct-to-Mux), attach to shows/seasons/episodes
- Manage shows: create, edit metadata, set artwork, publish/unpublish
- Analytics: signups, MRR, churn, top shows by minutes watched, trial-to-paid conversion
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

trial_sessions
  - id
  - session_id (random UUID, stored in HTTP-only cookie)
  - show_id → shows.id
  - user_id → users.id (nullable; populated when they convert)
  - started_at
  - expires_at         (started_at + 5 min)
  - last_position_seconds  (where the player was when paused/closed)
  - converted: boolean (true once user signs up + pays)
  - UNIQUE(session_id, show_id)  -- one trial per show per browser session

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

**Design:** anonymous trial. No signup required to start watching. Anyone clicking a show link gets the first 5 minutes of episode 1, then a paywall that doubles as the signup + payment flow.

**Flow:**
1. User clicks any link to `/watch/[show-slug]` (from social, email, the home page, anywhere).
2. Server checks for a `trial_session` cookie scoped to this show:
   - **No cookie or session not yet started:** create a `trial_sessions` row with a fresh `session_id` (UUID), `started_at = now`, `expires_at = now + 5min`, set the cookie (HTTP-only, 30 days).
   - **Active session (not expired):** resume — remaining seconds = `expires_at - now`.
   - **Expired and not converted:** redirect to `/subscribe?show=<slug>`.
   - **Converted (user paid):** issue a normal subscriber token, no time limit.
3. Server issues a Mux signed JWT with TTL = remaining trial seconds (capped at 5 min on first issue).
4. Player loads at `last_position_seconds` (so closing and reopening resumes correctly).
5. Player saves position every 10s to `trial_sessions.last_position_seconds`.
6. At ~4:50, client-side overlay starts a "paywall preview" (subtle dim, CTA fades in).
7. At 5:00, Mux refuses further playback because the JWT has expired. Player goes into paywall mode.
8. Paywall: "Continue watching — £9.99/mo or £79.99/yr."
9. Click → Clerk sign-up (email + password). On `user.created` webhook, link `trial_sessions.session_id` → new `users.id`.
10. After sign-up, automatic redirect to Stripe Checkout.
11. After Stripe `checkout.session.completed` webhook + `customer.subscription.created` (subscription `active`), set `trial_sessions.converted = true`.
12. Stripe redirects back to `/watch/[show-slug]?resume=<last_position>`. Now-authenticated, now-subscribed user gets a fresh full-length token. Player resumes at the trial's stopping point.

**Why this works:**
- Mux signed JWT TTL is the hard server-side cutoff. Client-side timers are just for UX polish.
- Trial state is keyed on a cookie-bound session ID, so refresh / new tab / closed tab all resume the same trial.
- The cookie + DB row survive the signup → checkout redirect chain, so we can resume at the right timestamp post-payment.

**Anti-abuse trade-off — read this:**
Because there's no auth gate before the trial, a user can clear cookies and start fresh. Their best-case "abuse" is watching 5 min of show X once per cookie-clear. This is acceptable for v1 — it's effectively a longer trailer. If it becomes a real problem post-launch, add FingerprintJS (~$200/mo) as a second signal alongside the cookie. Don't add captchas or pre-trial signup; both crater conversion.

**Edge cases to handle:**
- User starts trial, closes tab at 2 min, comes back: cookie is still there, resume at 2:00 with 3 min left.
- User opens trial in incognito after watching once: gets a fresh trial. Acceptable.
- User signs up but abandons checkout: `trial_sessions.user_id` is set but `converted = false`. Next visit, treat them as authenticated-but-unsubscribed; if their trial is expired, send to `/subscribe`.
- Subscription expires while watching: existing token may still be valid for up to 1 hour. On next token refresh, server returns 403 → paywall.
- Multiple browser tabs of the same show: same session, same expiry, both get cut off together. Fine.

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
> Using the data model in `PROJECT.md` section 3, create Drizzle schema files for: users, subscriptions, shows, seasons, episodes, trial_sessions, watch_progress. Add a Clerk webhook handler at `/api/webhooks/clerk` that mirrors users to our `users` table on `user.created`. Add a one-off script `scripts/promote-to-admin.ts` that takes an email and sets `role = 'admin'`. Generate and run the migration.

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

### Phase 6 — Signed tokens + anonymous trial + paywall flow (≈ 4–5 hours)

**This is the big one. Read section 4 of this doc again before starting.**

**Claude Code prompt:**
> Build the playback token system and anonymous trial flow as described in PROJECT.md section 4.
>
> 1. Make `/watch/[show-slug]` a public route (no auth required). On request, read or set a `trial_session` HTTP-only cookie. Look up or create a `trial_sessions` row keyed on `(session_id, show_id)`. If the row's `converted = true`, treat as subscriber. If expired and not converted, redirect to `/subscribe?show=<slug>`. Otherwise, render the player with the first episode of the show.
>
> 2. Add `/api/playback-token` that takes `episode_id`. Logic:
>    - If authenticated user has `subscriptions.status = 'active'`: issue Mux signed JWT, 1h TTL.
>    - Else if request has a valid `trial_session` cookie tied to the show containing this episode and the session is not expired: issue JWT with TTL = `expires_at - now` (max 5 min).
>    - Else: 403.
>
> 3. Update player to fetch token on mount, save `last_position_seconds` to the trial session every 10s, and show a paywall overlay component on token-fetch 403 or on the Mux player's `error` event.
>
> 4. Build `/subscribe` page. After the user clicks "Subscribe," redirect them through Clerk sign-up (preserve `?show=<slug>` and `?resume=<seconds>` query params via Clerk's `redirectUrl`), then through Stripe Checkout, then back to `/watch/[show-slug]?resume=<seconds>`.
>
> 5. Add a Clerk webhook handler for `user.created` that finds any `trial_sessions` rows with this user's email-derived session and links them via `user_id`. (Or pass the `session_id` through Clerk's `unsafeMetadata` during signup and link in the webhook.)
>
> 6. In the Stripe webhook handler (already built in Phase 5), on `checkout.session.completed` followed by an active subscription, set `trial_sessions.converted = true` for any session belonging to this user.

**Verify:**
- Open `/watch/some-show` in a fresh incognito window: video plays for 5 min, then paywall appears.
- Refresh: still paywalled. Cookie remembers.
- Click "Subscribe," sign up, complete Stripe Checkout with test card: redirected to player, video resumes at ~5:00 with no time limit.
- Open the same show in a different incognito window: fresh 5 min trial. (Expected — this is the documented v1 trade-off.)
- Open a different show as the now-subscribed user: plays normally.

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
- Trial: anonymous, cookie-based. 5 minutes per (browser session, show). Triggered by visiting any /watch/[show-slug] URL — no auth required.
- Trial state survives signup + Stripe checkout via the trial_session cookie; on conversion, mark `trial_sessions.converted = true` and link `user_id`.
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