# Project: Matio Streaming Platform

A subscription video streaming platform for our studio's original content.
Netflix-inspired UX. 5-min trial unlocked via ad banners.

## Stack
- Next.js 16 App Router, TypeScript
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
- proxy.ts                   # Auth and admin gating (Next 16: middleware.ts was renamed to proxy.ts)

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