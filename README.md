# matio

A subscription streaming home for original short-form stories. 60-second
anonymous trial per (browser session, show), then sign-up + Stripe
Checkout in one flow.

Production: **https://matio-ten.vercel.app**

## Stack

- Next.js 16 App Router · TypeScript · React 19
- Postgres on Neon · Drizzle ORM (`postgres-js` driver, pooled endpoint)
- Clerk 7 (auth, keyless in dev)
- Stripe 22 (Checkout + Customer Portal + webhooks)
- Mux 14 (direct upload + RS256-signed playback)
- Tailwind v4 · shadcn (built on Base UI)
- Vercel hosting

## Setup

```bash
pnpm install
cp .env.example .env.local            # fill in real values
pnpm db:migrate                       # apply schema to your Neon branch
pnpm stripe:setup                     # create Stripe products + prices
pnpm seed:fake-shows                  # optional: 35 placeholder shows for layout testing
pnpm dev
```

Open http://localhost:3000.

`AGENTS.md` lists every env var and where to obtain it; `.env.example`
mirrors the canonical names.

## Docs

Read these before changing integrations:

- [docs/architecture.md](./docs/architecture.md) — system diagram, data
  model, trial pipeline, playback pipeline, route protection, *why*
  each decision was made
- [docs/services.md](./docs/services.md) — per-service setup (Clerk,
  Stripe, Mux, Neon, Vercel) and env-var sources
- [docs/operations.md](./docs/operations.md) — pnpm scripts, migrations,
  deploy commands, end-to-end test recipes
- [docs/gotchas.md](./docs/gotchas.md) — version-specific traps for
  Next 16, Clerk 7, Stripe SDK 22 (API 2024+), Mux 14, Tailwind v4 +
  shadcn-on-Base-UI, Drizzle 0.45

[`CLAUDE.md`](./CLAUDE.md) summarises the rules and conventions agents
follow when working in this repo.

## Useful scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Next dev server with Turbopack |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Diff schema → write a new Drizzle migration |
| `pnpm db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `pnpm db:studio` | Drizzle Studio (browser DB GUI) |
| `pnpm stripe:setup` | Idempotently create Stripe products + prices |
| `pnpm seed:fake-shows` | Insert 35 demo shows (slug prefix `demo-`) |
| `pnpm seed:fake-shows -- --reset` | Delete every `demo-*` show |
| `pnpm promote-to-admin <email>` | Grant `users.role='admin'` |

## Deploying

GitHub auto-deploy is **not** wired (the Vercel project lives under a
different account than the GitHub repo owner). Ship via the CLI:

```bash
vercel --prod --yes
```

Migrations run separately against `DATABASE_URL` from `.env.local`:

```bash
pnpm db:migrate
```

Always migrate **before** deploying when a release adds new columns/tables.

## What's in the repo

```
app/
  (public)/              Catalog: / and /shows/[slug]
  admin/                 Admin panel: shows, episodes, analytics
  api/
    billing-portal/      Direct redirect to Stripe Customer Portal
    playback-token/      Mux RS256 JWT issuer (trial + subscriber)
    webhooks/            Clerk / Mux / Stripe webhooks
  subscribe/             Checkout form
  watch/[showSlug]/      Player + trial paywall
components/
  ui/                    shadcn primitives (Base UI under the hood)
  admin/                 Admin-specific (upload widget, status select)
  site/                  Marketing surfaces (header, footer, posters)
  watch/                 Player, paywall, overlays
db/                      Drizzle client + schemas
drizzle/                 Migrations (`pnpm db:migrate`)
lib/                     Server-only helpers (auth, trial, Mux, Stripe)
proxy.ts                 Next 16 middleware (auth gating + role cache)
scripts/                 One-off CLI tasks
```
