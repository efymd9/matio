# Project: Matio Streaming Platform

A subscription video streaming platform for our studio's original content.
Netflix-inspired UX. 60-second anonymous trial per (browser session, show).

## Stack

- Next.js 16 App Router, TypeScript
- Postgres (Neon), Drizzle ORM (`postgres-js` driver, pooled endpoint)
- Clerk 7 (auth) — local `.env.local` carries the **production** instance keys (`pk_live`/`sk_live`); keyless mode is not used. Prod Clerk refuses localhost redirects, so the admin panel can't be browser-verified locally
- Stripe 22 (Checkout + Customer Portal + subscription webhooks)
- Mux (direct upload + signed playback IDs + asset webhooks)
- Tailwind v4 + shadcn (built on Base UI, not Radix)
- Resend (transactional email — new-episode reminder notifications; `RESEND_API_KEY` unset = sends off, capture keeps working)
- Meta Pixel + Conversions API (advertising measurement — consent-gated, no SDK)
- Vercel (hosting) + Vercel Blob (admin-uploaded show artwork — poster/hero)
- Sentry (`@sentry/nextjs` — errors + light tracing; `NEXT_PUBLIC_SENTRY_DSN`
  unset = the SDK never initialises, EU region, no Session Replay)

## Deeper docs

Always check these before changing integrations or guessing API shapes:

- [docs/architecture.md](./docs/architecture.md) — system diagram, data model, trial & playback pipelines, route protection model, *why* each decision was made
- [docs/services.md](./docs/services.md) — per-service setup (Clerk / Stripe / Mux / Neon / Vercel) and required env vars
- [docs/operations.md](./docs/operations.md) — pnpm scripts, migrations, deploy commands, end-to-end test recipes
- [docs/gotchas.md](./docs/gotchas.md) — **read this before touching webhooks or Mux** — version-specific traps for Next 16, Clerk 7, Stripe SDK 22 (API 2024+), Mux 14, Vercel Blob, shadcn/Base UI, Drizzle 0.45, tsx scripts

`PROJECT.md` is the original product spec — useful for build phases and product intent. Where it conflicts with this file or `docs/`, the latter wins.

## How we work

The development process itself is a playbook in [docs/mega-process/](./docs/mega-process/)
(stages 01–10). It is being rolled out stage by stage; every stage is tracked as
an issue on the board. Stages 01–08 are in force; **09 (load testing) and 10
(privacy/GDPR) are not rolled out yet** — 10 is the natural next module, and a
prerequisite for mobile push notifications (#98). What is already in force:

### Core rules

- **Scope = the task at hand.** Build what the spec asks for, not what a future
  stage might want. No "while I'm here" features.
- **Privacy.** User data (texts, content, profiles, emails) NEVER reaches logs,
  the error tracker, or analytics events — only ids, statuses, durations. This
  is the rule behind the hashed-IP and no-raw-PII patterns already in `lib/`.
  It is no longer only a promise: **the log audit** (`lib/log-audit.test.ts`)
  seeds recognisable user text — an address, a name, a password-bearing
  connection string — into the paths that report failures and fails if any of
  it comes out the other end; the Sentry scrubbers it exercises live in
  `lib/observability.ts` with their own suite. The audit is meant to GROW: a
  new server path that logs, or a new field on the error payload, gets a case
  there in the SAME PR.
- **Incidents start in the tracker, not in someone's memory.** A spike of
  errors in Sentry, a red nightly workflow, a 5xx spotted by hand → an issue
  first (`gh issue create` with `type:bug` + `domain:*` + priority by impact,
  then `tools/claude/board_status.sh <N> …`), and only then the fix. Same
  philosophy as the registry, and the same failure it prevents: during the
  2026-08-04 incident five PRs were opened with no issue behind them, so the
  work existed and the board did not know about it.
- **Minimal code.** No speculative abstractions, no layers for a second
  implementation that does not exist. Edits are surgical: change what the task
  needs, leave the rest alone.
- **Loose ends are tracked, not remembered.** Any stub, placeholder, or
  deliberately deferred piece gets a row in [docs/registry.md](./docs/registry.md)
  in the SAME PR that introduces it.
- **Process docs are LIVE documents.** Changed the process, the infrastructure,
  or a threshold → update the corresponding skill in `.claude/skills/` in the
  SAME PR. A stale map is worse than no map.
- **Architectural decisions** with lasting consequences get an ADR — see
  [docs/adr/README.md](./docs/adr/README.md).

### Commands

Web / server (pnpm, repo root):

```
pnpm lint          # eslint (mobile/ is excluded — it has its own toolchain)
pnpm typecheck     # tsc --noEmit
pnpm build         # next build
pnpm test          # vitest run — BOTH projects: unit (node) + Lab stories in
                   #   a real Chromium with screenshot goldens. Not a quick loop
pnpm test:unit     # the fast node-only suite — right for 90% of edits
pnpm test:stories  # Lab stories in Chromium only
pnpm test:watch    # vitest in watch mode, while writing tests
pnpm test:coverage # vitest run --coverage — what CI measures the ratchet against
pnpm test:locale   # just the locale/URL suites (kept: referenced by docs + plans)
                   # `pnpm typecheck` failing on .next/dev/types/validator.ts
                   # means a stale .next from another branch — `rm -rf .next`.
pnpm db:generate   # drizzle-kit generate — new migration from schema changes
pnpm db:migrate    # apply migrations — .env.local points at PROD; pass
                   #   DATABASE_URL=<staging> explicitly (NEVER db:push)
```

Mobile (npm, `mobile/` — deliberately outside the pnpm workspace):

```
cd mobile && npx expo start
# `npm run lint` in mobile/ does NOT work today: `expo lint` dies with "all
# files are ignored" — the app has no flat-config of its own and the root
# config ignores mobile/**. Tracked in docs/registry.md; lands with #96.
```

### The closed PR loop

`"Делай #N"` is a self-sufficient command. Nobody relays messages between the
owner and an agent, and nobody chases an agent for status.

1. `gh issue view N` — work only on `spec:ready`. No spec → stop, comment in the
   issue, ask for one. Do not invent the spec yourself.
2. `tools/claude/board_status.sh N progress` — **immediately**, before writing
   code. A task in flight that is not visible on the board does not exist.
3. Branch from `origin/main`: `git fetch && git checkout -b feat/<slug> origin/main`.
4. Build the whole vertical the spec asks for (server + UI, or app + API) in ONE
   PR. A half-vertical is not reviewable.
5. Open a PR with `Closes #N`.

**The PR body is the agent's only channel to the reviewer.** The reviewer does
not see the agent's session, and a report in the owner's chat is not a
substitute. It must contain: what was done and why · how it was verified
(commands, runs, devices) · the acceptance criteria answered **point by point** ·
what was deliberately deferred, with the matching rows in `docs/registry.md`.

**The reverse channel is the PR thread, not the issue.** An agent reads its
issue once, when it picks the task up; anything written there afterwards is
never seen. This is a mistake that has cost real downtime — an owner's decision
sat unread in an issue while the work stood still.

**Babysitting your own PR is mandatory.** Arm the watcher with the **Monitor**
tool: `command='bash tools/claude/pr_babysit.sh'`, `persistent: true` — never
via `Bash run_in_background` and never with `&`, because a process outside the
harness cannot wake the session. Then react to what it reports: red CI → fix ·
review comment → fix, push immediately, and answer in the thread · conflict or
`behind` → `git fetch && git merge origin/main` + push · `MERGED` → the cleanup
ritual. A deliberate pause (waiting on the owner) is declared by creating
`.claude/babysit-paused`; the Stop hook blocks ending a turn on an open PR with
a dead watcher.

**Only the main session merges.** An agent never merges its own PR, and
auto-merge is armed by the main session only, only after review.

### Skills, watchers and worktree mechanics

- Skills in `.claude/skills/`: `/duty` (the main session's start-of-day ritual
  — arm BOTH queue watchers via Monitor: `tools/claude/pr_watcher.sh` and
  `issue_watcher.sh`; autopilot dispatch; cleanup), `/spec`, `/release`,
  `/devops`, `/review`. They are LIVE documents — change the process, update
  the skill in the same PR.
- `tools/claude/` beyond `board_status.sh` and `pr_babysit.sh`:
  `pr_watcher.sh` + `issue_watcher.sh` (queue watchers), `watcher_guard.sh` +
  `babysit_guard.sh` (Stop hooks), `wt_janitor.py`, `link_shared_memory.py`,
  `board.env` (public board IDs, committed on purpose so scripts work inside
  a bare worktree).
- Worktrees: the committed `.claude/settings.json` sets `"worktree":
  {"baseRef": "fresh"}` — every agent worktree starts from a freshly fetched
  `origin/main` under `.claude/worktrees/`. `.claude/settings.local.json` is
  gitignored ON PURPOSE: it holds the main session's own hooks, which a worker
  agent must not inherit — do not copy it into a worktree.
- The project memory is a **symlink to one shared store**
  (`link_shared_memory.py` → `~/.claude/projects/<key>/memory`), physically
  one file set for all sessions — hence "writes are small and additive"; a
  wholesale rewrite clobbers another session's notes.

### Parallel instances (git worktrees)

- One branch = one PR. A new branch always starts from a freshly fetched
  `origin/main`.
- After a merge, never commit to that same branch again — the squash "burned"
  it. New work = new branch from `origin/main`.
- A conflict with `main` is resolved by whoever arrives second, in their own
  copy. Generated files are never merged by hand — they are regenerated.
- **Hot shared points are edited by one instance at a time** — in this repo:
  `lib/i18n/dictionaries.ts` AND `lib/i18n/admin-dictionaries.ts` (both
  locales in one file each); `vitest.config.mts` (the coverage ratchet moves
  in almost EVERY PR — two parallel raises always collide; the second
  recomputes from a fresh `origin/main`, never keeps "its own" numbers);
  `docs/registry.md` (every PR with a deferred tail writes there — the
  conflict is trivial but constant); `package.json` + `pnpm-lock.yaml` (the
  lock is never merged by hand — regenerate with `pnpm install`);
  `db/schema/*` plus `drizzle/` (two agents each running `pnpm db:generate`
  produce colliding migration numbers — coordinate, or the second
  regenerates); `.claude/skills/*`; and CLAUDE.md itself. `app/globals.css`
  changes rarely but stays coordinated — the tokens are shared.
- Never touch another instance's worktree.
- **A bare worktree has no gitignored files**: no `node_modules`, no
  `.env.local`, no `mobile/node_modules`. Copy them from the main checkout
  (`/Users/matveidobrovolskii/dev/matio`), then `pnpm install` — do not invent
  env values, and do not commit them.
- **`.env.local` carries LIVE PRODUCTION credentials.** `DATABASE_URL` is the
  production Neon pooler, next to `sk_live_…`, `pk_live_…` and live Blob / Mux
  / Resend / PostHog tokens. So, in the main checkout and in every worktree: a
  bare `pnpm db:migrate` or `pnpm db:studio` talks to **production**.
  Migrations always run with an explicit host — `DATABASE_URL=<staging branch>
  pnpm db:migrate` first, production only after (order in the `/devops`
  skill); any ad-hoc `tsx` script or seeder is assumed to point at prod until
  proven otherwise.
- Do not run two heavy builds (Next + Expo) in two worktrees at once — they
  share one machine.
- **Two concurrent `pnpm install`/builds corrupt the shared pnpm store**: the
  symptom is a random "bad package.json / MODULE_NOT_FOUND" in an unrelated
  package. Cure: `pnpm install --force`. (A different failure from the
  heavy-builds rule above — that one is about machine load.)
- **Ports**: `pnpm dev` takes :3000, `pnpm lab` takes :6006 — one session at a
  time, or pass an explicit port. :3000 on this machine is sometimes held by
  an unrelated project; `pnpm dev` then silently takes :3001 — read the port
  from the dev log, never assume.
- **Required checks & merge order**: ruleset `protect-main` requires `web
  (lint · types · tests)` and `Vercel – matio` with the branch UP TO DATE with
  main (`Vercel – matio-staging` and `Vercel Preview Comments` appear on PRs
  but are not required). Practical consequence: two PRs never merge
  simultaneously — the second merges `origin/main` and waits for a recount;
  arming `--auto` merge queues this automatically.
- Writes to the shared memory are small and additive.

### Routine on autopilot (the `auto` label)

The main session does not only dispatch work — it executes routine itself, with
sub-agents (Agent tool, `isolation: "worktree"`), one worktree each.

- **What qualifies**: `type:bug` and `type:debt` with **no new or changed
  visible UI**. Never on autopilot: anything visible, product decisions, paid
  actions, tearing down environments or data, and the Release PR. `p1` is
  allowed but the owner is told the moment it starts, not in a digest.
- **Who labels**: the main session at triage; a worker agent may label a bug it
  files in passing when the routine nature is obvious. **Doubt = no label** — an
  unlabelled task simply waits for a human decision, which costs nothing.
- **Slot cap: 2 concurrent.** Slots are not remembered, they are computed from
  the board (`auto` ∧ In progress). A slot is filled only by a task whose files
  and modules do not overlap the active ones. Overlapping *logic* blocks;
  purely additive neighbours (new independent config keys, new locale strings,
  new registry rows) do not — the second one merges `origin/main` and the
  conflict is trivial. Reading the rule too strictly keeps slots empty for
  nothing.
- **The sub-agent's prompt** says: work to the spec, open a PR with `Closes #N`,
  **do not babysit** (the pipeline belongs to the main session), and here are
  the bare-worktree traps (no gitignored files — copy `.env.local` from the main
  checkout, run `pnpm install`).
- **A silent sub-agent is a stuck sub-agent.** No PR and no questions for a long
  stretch usually means it stopped at a fork and is waiting. Ping it with
  SendMessage rather than waiting.
- **Review comments go to the same sub-agent** via SendMessage — its context is
  alive. A fresh agent would have to rediscover everything.
- **Cleanup**: `python3 tools/claude/wt_janitor.py` (dry-run) / `--yes`. It
  deletes a worktree only when it is provably safe: clean copy, a merged PR for
  the branch, and the branch tip inside that PR. Note the subtlety it exists
  for: a squash merge gives the merged commit a **new** SHA, so "is the tip an
  ancestor of main" is always false — the janitor compares against
  `refs/pull/<n>/head` instead.

**Every piece of work is an issue — including emergency fixes.** During the
2026-08-04 incident five PRs were opened with no issue behind them; the work
existed, the board did not know about it. On autopilot that pattern turns into
invisible fleets of sub-agents. File the issue first, even when the fix is
urgent — it costs one command.

### Releases and commit conventions

- **Commit messages are the changelog.** `fix:` → patch, `feat:` → minor,
  `feat!:` / `BREAKING CHANGE:` → major, `docs:` shows up in the changelog,
  `chore:`/`ci:`/`test:` stay hidden. Below 1.0.0 a `feat:` bumps the minor,
  never the major.
- **release-please** keeps a single open Release PR with the accumulated
  changelog and version bump. Nobody commits into its branch, and auto-merge is
  never armed on it. Merging it is a release: tag **`matio-vX.Y.Z`** (the component prefix lands in the tag; `/api/healthz` reports the bare `X.Y.Z`) + GitHub Release —
  and it happens only on the owner's explicit `"релизь"`. Ritual: the
  `/release` skill.
- **Merging to `main` deploys staging, not production.** Staging is the
  training ground: its own Neon branch, its own keys, seeded data, no live
  viewers. Production (`matio.tv`) is deployed by exactly one path — publishing
  a GitHub Release fires `.github/workflows/deploy-production.yml`, whose job is
  bound to the **`release-production`** GitHub Environment and therefore
  **stands and waits for the owner to press approve**. It is `release-production`
  on purpose, NOT `production`: the `Production`/`Preview` environments in this
  repo belong to the Vercel integration, and GitHub environment names are unique
  case-insensitively — an approval rule hung on `production` lands in someone
  else's record. "Релизь" is no longer just a version bump;
  it is the only door into production. Vercel still builds every PR as a
  preview, and a preview still has no database — green proves the build, nothing
  more.
  **Migrations go to staging first**: `pnpm db:migrate` against the staging
  branch → check it there → only then production. Order and the emergency
  manual deploy path live in the `/devops` skill.
  The two-step model has been in force since 2026-08-12: merging to `main`
  deploys staging; production is deployed only by a published Release, through
  `deploy-production.yml`, after the owner approves. Issue #40 (second Vercel
  project, staging Neon branch, `production` branch, `VERCEL_*` secrets) is
  closed — nothing about this is transitional any more (five gated releases
  shipped this way, v0.3.0 … v0.7.0).
- **`/api/healthz`** answers what is actually live: `curl -s
  https://matio.tv/api/healthz | jq` returns status, version (from
  `package.json`, bumped by release-please), the commit and the environment.
  The release workflow polls it after deploying and fails loudly when the live
  version does not match the released tag — "released but not actually live" is
  the failure this endpoint exists to catch.
- **Infrastructure is a live document too**: changed hosting, a vendor, CI, the
  database or a domain → update the `/devops` skill in the SAME PR. A stale
  infra map is read during an incident, which is exactly when being wrong costs
  the most.

### Data: migrations and backups

- **Migrations are expand-contract, always.** No DDL that breaks the previous
  version of the code ships in the same release as that code. It is two
  releases: *expand* — the new column is nullable or has a default and the code
  writes both shapes; *contract* — the old shape is dropped, and only once the
  expand deploy is READY. This is not theory in this repo: a `DROP COLUMN` that
  travelled with its own code cost three minutes of production downtime on
  2026-06-04, because Drizzle bakes the full column list into the build and a
  `SELECT` over the vanished column throws. Adding is the mirror image —
  migrate first, deploy second; dropping is migrate LAST.
- **An index on a table that can grow states its trade-off in the migration.**
  A plain `CREATE INDEX` holds a write lock for the entire build;
  `CONCURRENTLY` does not, but cannot run inside a transaction (its own
  migration file) and can leave an INVALID index behind if it fails. Either
  choice is defensible; an unexplained choice is not — the reason goes in a
  comment in the `.sql`.
- **Mutations are idempotent.** A client retry — double tap, lost response,
  webhook redelivery, a user reloading the success page — must never produce a
  second row. Reuse the patterns already in the codebase instead of inventing
  one: claim the vendor's event id before processing (`stripe_events.event_id`),
  a natural unique key plus `ON CONFLICT DO UPDATE` (`show_reminders
  (show_id, email)`, `watch_progress (user_id, episode_id)`), a partial unique
  index for "at most one active" (`subscriptions … WHERE status IN (…)`), a
  deterministic Stripe idempotency key for checkout sessions, and a claim-stamp
  under `FOR UPDATE SKIP LOCKED` for batch dispatch (`show_reminders.notified_at`).
  A new write path must be able to answer, in one sentence, what makes running
  it twice safe.
- **Backups are real, and the restore probe is what makes them real.**
  `db-backup` (daily, 03:40 UTC) dumps production with the Postgres 18 client,
  encrypts it with age and uploads it as a **private** Vercel Blob object;
  `db-restore-check` (monthly) restores the newest dump into a clean Postgres 18
  and runs smoke queries. Vercel Blob has no S3-style lifecycle rules, so the
  35-day retention is executed by the script itself (`infra/backup/blob.ts
  prune`) — never delete that step. The private age key exists in exactly two
  places, the owner's password manager and the `BACKUP_AGE_SECRET_KEY` secret;
  lose both and every dump is scrap. Restoring by hand:
  [docs/runbooks/db-restore.md](./docs/runbooks/db-restore.md). Neon's PITR
  stays as the fast "oops, deleted the wrong rows" layer, not as the backup —
  and its window is **6 hours** (free_v3, `history_retention_seconds: 21600`):
  shorter than the gap between daily dumps, so an incident noticed in the
  morning is already past PITR. `db-restore-check` has run on schedule from
  2026-09-01; before that its only run was a manual `workflow_dispatch`
  (2026-08-06). `db-backup` runs daily and green; its start drifts hours off
  the nominal 03:40 UTC — normal Actions queueing.

### Observability

- **Sentry is DSN-optional by construction.** `NEXT_PUBLIC_SENTRY_DSN` unset =
  no `Sentry.init` on any runtime, no `withSentryConfig` wrapper around
  `next.config.ts`, and not one byte of the browser SDK downloaded — the same
  degradation contract as `RESEND_API_KEY`. `NEXT_PUBLIC_*` is inlined at
  **build** time (the server bundle too), so the variable has to land in Vercel
  *before* the deploy that should report.
- **The privacy configuration is the whole point of wiring it by hand.** No
  Session Replay, no feedback widget (the wizard adds both — they record the
  viewer's screen and collect an address), `sendDefaultPii: false`,
  `includeLocalVariables: false`, `enableLogs: false`, and `beforeSend` /
  `beforeSendTransaction` / `beforeBreadcrumb` that strip query strings and URL
  credentials, delete cookies / request bodies / parsed query params, cut
  headers to an allowlist, reduce the user to an id, redact email-shaped
  strings, and drop console breadcrumbs wholesale. All of it in
  `lib/observability.ts`, one contract shared by the Node, edge and browser
  configs — change it and prove it with a test.
- **`environment` and `release` are the same answers `/api/healthz` gives**
  (`resolveStage` / `resolveRelease`): `APP_ENV` → `VERCEL_ENV` →
  `development`, and `APP_VERSION` — the version release-please stamps on the
  tag. The browser can only read `NEXT_PUBLIC_*`, so staging needs its own
  `NEXT_PUBLIC_APP_ENV=staging` or browser events from the bench report as
  production.
- **`/api/healthz` is liveness, `/api/readyz` is readiness.** healthz stays
  deliberately DB-free (an uptime ping must not become load, and a slow
  database must not read as an outage); readyz runs `select 1` against Neon
  with a 2s ceiling and answers **503** with a reason code (`timeout` /
  `unavailable` / `not_configured`) and nothing else — no connection strings,
  no driver messages. **A green readyz does not prove the service is
  serving**: connection-pool exhaustion is sudden, total, and invisible to a
  probe that opens its own cheap query.
- Ops details, the staging/production specifics and the incident ritual live in
  the `/devops` skill → «Наблюдаемость»; per-service setup in
  [docs/services.md](./docs/services.md).

### Tests and coverage

- **Runner: Vitest** (`vitest.config.mts`). Default environment is `node`; a
  component test opts into jsdom with `/** @vitest-environment jsdom */` at the
  top of the file. `mobile/` is a separate project and is excluded everywhere.
- **The ratchet: thresholds only ever go up.** Raised coverage in a PR? Raise
  the numbers in `vitest.config.mts` in the SAME PR. Lowering a threshold is a
  review blocker, not a negotiation.
- **diff-cover ≥85% on changed lines** (CI, `pull_request` only). This is the
  gate that actually bites: the overall percentage climbs slowly, but new
  untested code stops entering the project.
- **A test must assert behaviour** — a result, a state, an error. A test that
  merely executes lines to move a percentage is defective work and a reason to
  send a PR back. Never weaken an existing assertion to make a suite pass.
- **Untestable glue goes into `coverage.exclude` with a justification comment**,
  not into a theatrical test. The current exclusions (drizzle output, one-shot
  ops scripts, the Expo app) are documented in the config.
- **Fake secrets in tests must look fake** (`sk-test-…`, `dummy`, `invalid`) —
  otherwise the nightly gitleaks scan flags them and the finding costs a real
  investigation.
- CI runs lint → types → tests + coverage → diff-cover. The `next build` check
  is deliberately left to Vercel's own preview deployment; we do not pay twice
  for the same build.

### UI

- **Everything visual goes through tokens.** Colours, type and spacing come
  from `app/globals.css` (`@theme`) and the core components — never from a
  literal in a feature. `tools/qa/no-magic-styles.sh` runs in CI and fails with
  the file and line; run it locally with `pnpm qa:styles`. A shade that does
  not exist yet is added to `@theme` **and** to the token sheet in
  `lab/tokens.stories.tsx` in the same PR.
- **Lab-first.** A new or changed visible element appears in the UI Lab
  **first**, in **at least five genuinely different** variants — five variants,
  not one variant five times, and not a pixel copy of a reference. The owner
  looks at them live on a device and picks one; only then does it land in the
  product code, with the chosen values written into tokens and into the task's
  spec. Iterating on UI inside the main codebase is how three rounds of review
  get spent on something a one-minute look would have settled.
- **Run the Lab**: `pnpm lab` (Storybook on :6006). Stories live next to their
  components (`components/**/*.stories.tsx`); the gallery's own pages — the
  token sheet, variant boards — live in `lab/`.
- **Stories are tests.** Every story runs in real Chromium under
  `pnpm test:stories`: it must render without throwing and its play function
  must pass. A component without a story is a component nobody can look at.
- **Goldens are decisions, not chores.** The gallery boards (variants, tones,
  token sheet) are screenshot-compared. Baselines are per platform and only the
  Linux ones are committed — CI is the arbiter, a macOS run only writes its own
  gitignored `*-darwin.png`. When a golden fails, download the CI artifact
  `visual-baselines`, look at the diff, and if the change was intended commit
  the regenerated PNGs in the same PR. Never regenerate until green.

### Task tracker

- Tasks live **only** in GitHub Issues; their status lives **only** on the
  Projects board (https://github.com/users/efymd9/projects/1). Not in chat, not
  in a notebook, not in someone's memory.
- **`gh issue create` does NOT put the issue on the board.** Creating an issue
  is always a pair of commands:

  ```
  gh issue create --title "…" --label "type:bug,domain:web,p2,by:agent-claude"
  tools/claude/board_status.sh <N> backlog     # или tech | spec | progress | review | done
  ```

  Which backlog: `tech` for tech debt and infrastructure that needs no product
  decision, `backlog` (product) for ideas and anything awaiting the owner. In
  doubt — product, so the owner sees it.
- A bug found in passing is never fixed silently: it becomes an issue with
  labels, so it is visible on the board.
- Every issue carries labels: `type:*` + `domain:*` + priority (`p1`/`p2`/`p3`)
  + authorship (`by:claude-code` for the main session, `by:agent-claude` for a
  worker agent). `spec:ready` means the spec is written and the task can be
  picked up; `needs:owner` means it is blocked on the owner personally.
- Specs are written on the owner's `"распиши #N"` command, to the template in
  the `/spec` skill. A spec whose acceptance criteria cannot be checked by a
  command or a number is not a spec.

## Conventions

- All DB access goes through Drizzle. Never write raw SQL except in migrations.
- All payment state changes flow through Stripe webhooks. Never trust client-side
  subscription status.
- All video playback requires a server-issued Mux signed JWT. Never expose
  playback IDs without a token.
- Server actions for mutations, route handlers for webhooks and token issuance.
- shadcn components live in `components/ui/`. Custom components in `components/`.
- Drizzle schemas in `db/schema/*.ts`, one file per logical domain.
- Env vars: Clerk = `CLERK_*`, Stripe = `STRIPE_*` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (client `pk_…` for in-site Embedded Checkout), Mux = `MUX_*`, Meta = `META_*` / `META_CAPI_ACCESS_TOKEN_{n}` / `NEXT_PUBLIC_META_PIXEL_ID` / `NEXT_PUBLIC_META_PIXEL_IDS`, PostHog = `POSTHOG_*` / `NEXT_PUBLIC_POSTHOG_*`, Google Analytics = `NEXT_PUBLIC_GA_MEASUREMENT_ID` (GA4 `G-…`; blank → off), Vercel Blob = `BLOB_READ_WRITE_TOKEN`, Resend = `RESEND_API_KEY` (blank → email off; optional `RESEND_FROM` / `RESEND_REPLY_TO` sender overrides), Sentry = `NEXT_PUBLIC_SENTRY_DSN` (blank → the SDK never initialises; optional `NEXT_PUBLIC_APP_ENV` for the browser's stage marker and `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` for build-time source-map upload). Kill-switches (runtime reads, bind-at-deploy): `PAYMENTS_ENABLED` (unset = free mode), `REQUIRE_SIGNUP` (=1 in prod), `PAY_FIRST_CHECKOUT`. Mobile levers (no store release needed): `APP_MIN_SUPPORTED_BUILD` / `APP_LATEST_BUILD` / `APP_SIGNUP_GATE_EPISODES` / `APP_DOWNLOADS_ENABLED` / `APP_CAST_ENABLED`. Bench: `STAGING_LOCK_PASSWORD`. Backups split across TWO stores — `BACKUP_STORE_ID` in Vercel but `BACKUP_AGE_SECRET_KEY` / `BACKUP_DATABASE_URL` / `BLOB_READ_WRITE_TOKEN` in GitHub-Actions secrets (keys get lost on exactly this gap). Never log secrets.
- Webhook route handlers declare `export const runtime = "nodejs";` (raw body + DB).
- Server-only modules use `import "server-only";` so they can't leak into a client bundle.
- All images go through `next/image`. `images.remotePatterns` in `next.config.ts` allowlists `image.mux.com` (Mux thumbnails) and `*.public.blob.vercel-storage.com` (Blob-hosted poster/hero artwork) — any other host throws at render on the public pages. Use `fill` + `sizes` for absolutely-positioned cover images; raw `<img>` is reserved for cases where the Safari < 16.4 `aspect-ratio` quirk requires pinning the img's own intrinsic ratio (see `components/site/poster.tsx`) and for admin-only previews of arbitrary URLs.
- The hero `MuxPlayer` on `/` is `next/dynamic({ ssr: false })` — keep it that way (a static import pulls ~350KB gzipped into every cold home-page visit) — **and keep its `key={muxDataEnabled ? "mux-data-on" : "mux-data-off"}`**: flipping `disable-tracking`/`env-key` on a live element makes @mux/mux-video run `unload(); …then(() => play())` with no `.catch`, and the orphaned play() lands in Sentry as an unhandled AbortError (issue #126, seen in prod 2026-08-24). This is the OPPOSITE rule to the watch player, where a remount kills WebKit's per-element autoplay blessing (`key` forbidden there) — and freezing consent into a mount-time snapshot is forbidden everywhere (the AUDIT.md H2 pre-consent leak).

## File structure

```
app/
  (public)/                # Public catalog: /, /shows/[slug]
    about/                 # /about — studio page («About page v3» design):
                           #   4K hero, mission/vision, manifest, values,
                           #   team slider, press hand-off; bilingual, indexed
    press/                 # /press — press room: boilerplate, press-kit ZIP
                           #   (public/press/matio-press-kit.zip, static),
                           #   press contact; bilingual, indexed
    terms/                 # /terms — bilingual legal page (filled; counsel review pending)
    privacy/               # /privacy — bilingual privacy policy (filled; counsel review pending)
    cookies/               # /cookies — bilingual cookie policy (filled; counsel review pending)
    unsubscribe/           # /unsubscribe — reminder-email opt-out (noindex;
                           #   GET renders a confirm button, the server action
                           #   deletes — never delete on GET, scanners prefetch)
  admin/                   # /admin — admin role required (proxy-gated, DB check)
    analytics/             # /admin/analytics — free mode renders the spec'd
                           #   retention dashboard (page.tsx, 7 blocks — see
                           #   "Analytics dashboard v2" rule); paid mode
                           #   renders legacy-dashboard.tsx verbatim (the
                           #   pre-2026-07-18 dual-mode page, dormant)
    links/                 # /admin/links — tracked-link generator (page +
                           #   actions.ts: createMarketingLink/archive; typed
                           #   error codes, not throw-to-boundary)
    reminder-actions.ts    # sendShowReminders — dispatches the show_reminders
                           #   backlog via Resend (typed state; panel lives on
                           #   the show edit page — see "Episode reminder
                           #   emails" rule)
  api/
    v1/                    # JSON surface for the mobile app (Expo). Native
                           #   twin of the web routes, three deliberate
                           #   differences: POST (not GET) for the token,
                           #   device-UUID header instead of the trial cookie
                           #   (proxy.ts skips /api for cookie minting), and a
                           #   POSITIONAL signup gate that is SOFTER than the
                           #   web's REQUIRE_SIGNUP wall — see the mobile rule
      config/              #   startup call: kill-switches, build floor,
                           #     signupGate, legal URLs. DB-free, never 500s
      catalog/             #   published shows + ready-episode count (CDN-
                           #     cacheable, auth-independent)
      shows/[slug]/        #   one show + ready episodes; playback ids NEVER
                           #     leave here — only signed thumbnail URLs
      playback-token/      #   the app's only Mux JWT mint; enforces the same
                           #     gate /v1/config reports
    admin/
      upload-image/        # /api/admin/upload-image — Vercel Blob client-upload
                           #   token issuer (admin-gated; poster/hero artwork)
    billing-portal/        # /api/billing-portal — 302 to Stripe Customer Portal
    email/
      unsubscribe/         # RFC 8058 one-click unsubscribe (POST target of the
                           #   List-Unsubscribe header; GET redirects to the
                           #   /unsubscribe confirm page)
    healthz/               # /api/healthz — liveness + which build is live
                           #   (status/version/commit/environment). NEVER
                           #   touches the database, on purpose
    playback-token/        # /api/playback-token — Mux JWT issuer
    readyz/                # /api/readyz — real readiness: `select 1` against
                           #   Neon, 2s ceiling, 503 + a reason code
                           #   (timeout|unavailable|not_configured). Status
                           #   and duration only, no connection details
    t/                     # /api/t — first-party visit beacon (sendBeacon
                           #   target; consent-EXEMPT audience measurement,
                           #   writes visitors + visitor_days; aid from the
                           #   httpOnly cookie only, never the body)
    webhooks/
      clerk/               # user.created → mirrors to users
      mux/                 # video.asset.{ready,errored} (ready also stamps
                           #   episodes.released_at write-if-null when the
                           #   show is already published)
      stripe/              # checkout.session.completed, customer.subscription.*,
                           #   invoice.{paid,payment_failed} — idempotency via
                           #   stripe_events.event_id claim before processing
  subscribe/               # /subscribe — single membership card ($1/3-day
                           #   trial → $38/mo); CTA links to /checkout
                           #   (actions.ts:createAuthCheckoutSession — signed-in
                           #   session builder) + guest-actions.ts
                           #   (createGuestCheckoutSession — no-auth pay-first
                           #   builder, PAY_FIRST_CHECKOUT-gated)
  checkout/                # /checkout — in-site Embedded Checkout (Stripe iframe,
                           #   no redirect to checkout.stripe.com). actions.ts:
                           #   createCheckoutSession dispatches auth vs guest;
                           #   checkout-client.tsx mounts <EmbeddedCheckout>. Both
                           #   /subscribe + the paywall route here. Falls back to
                           #   hosted redirect when the publishable key is unset.
  watch/[showSlug]/        # /watch/<slug> — public, trial-aware
  welcome/                 # /welcome — guest-checkout success page (outside the
                           #   /subscribe(.*) auth matcher; verifies session +
                           #   checkout_claim cookie, claims, ticket sign-in)
components/
  ui/                      # shadcn primitives (Base UI under the hood)
  about/                   # /about + /press bodies (about-content, press-
                           #   content, press-contact band, team-slider) —
                           #   presentational, dict/locale via props, each
                           #   with stories

  admin/                   # admin-specific (video upload widget, image-upload-
                           #   field for poster/hero artwork, status select,
                           #   reminders-panel — episode-reminder send form)
  site/                    # header, footer, cookie-banner, language switcher,
                           #   posters, hero, logo, meta-pixel (consent-gated
                           #   loader), view-content-pixel,
                           #   complete-registration-pixel,
                           #   posthog-provider (consent-gated, dynamic import),
                           #   social-icon (filled brand glyphs for the footer
                           #   social row)
  watch/                   # player, paywall, playback-status, overlays
                           #   (series-end-overlay captures reminder emails
                           #   into show_reminders — see "Episode reminder
                           #   emails" rule)
  welcome/                 # ticket-sign-in (consumes the Clerk sign-in ticket
                           #   client-side; email-code fallback)
db/
  index.ts                 # postgres-js client (prepare: false for pooler)
  schema/                  # one file per domain; re-exported from schema/index.ts
                           #   users, subscriptions, stripe_events, shows,
                           #   seasons, episodes, trial_sessions, watch_progress,
                           #   marketing_links (tracked links; partial unique on
                           #   active UTM triple), show_reminders (episode
                           #   reminder emails; unique (show_id, email), locale
                           #   snapshot, notified_at claim stamp),
                           #   visitors + visitor_days (first-party visit
                           #   ledger, aid = matio_aid cookie), watch_days
                           #   (user×day activity), watch_segments (episode×
                           #   day×10s-bucket retention counters)
drizzle/                   # migrations (sql) + drizzle-kit meta
                           # (schema/ also holds: actors, guest_checkout_attempts)
lib/
  admin.ts                 # getCurrentUser / requireAdmin
  free-mode.ts             # paymentsEnabled() — PAYMENTS_ENABLED env kill-
                           #   switch (unset = FREE MODE, see "Free pivot"
                           #   rule). server-only; client components get it
                           #   as a prop, next.config.ts inlines the env read
  checkout-target.ts       # shared show/ep/resume validation for both
                           #   checkout actions (Stripe URL inputs)
  guest-checkout.ts        # claimGuestCheckout (Stripe customer → Clerk user
                           #   → users mirror; idempotent, webhook + /welcome)
                           #   + checkout_claim cookie / guest metadata keys
  subscription-mirror.ts   # mirrorSubscription (moved out of the Stripe
                           #   webhook route so /welcome can run the same
                           #   idempotent mirror inline)
  catalog.ts               # getPublishedShows() cached via unstable_cache
                           #   (tag 'catalog'); shared by / + /sitemap.xml
  cookie-consent.ts        # cookie_consent parse/serialize, banner helpers
                           #   (universal — imported by proxy.ts AND banner)
  slug.ts                  # SLUG_PATTERN/isValidSlug/slugify (RU translit) —
                           #   universal; one charset rule for the admin
                           #   forms' pattern attr + server validation
  db-errors.ts             # isUniqueViolation — walks e.cause (Drizzle 0.44+
                           #   wraps PostgresError; .code is NOT on the
                           #   thrown error). Use this, never e.code directly
  observability.ts         # universal + PURE: resolveStage/resolveRelease
                           #   (shared with /api/healthz) + the Sentry privacy
                           #   contract (scrubbers + sentryPrivacyOptions()).
                           #   Reads no env itself — see "Observability"
  mux.ts                   # lazy Mux SDK client
  mux-token.ts             # RS256 JWT signer for signed playback
  stripe.ts                # lazy Stripe SDK client
  resend.ts                # lazy Resend SDK client + resendConfigured() +
                           #   sender identity (updates@matio.tv; RESEND_FROM /
                           #   RESEND_REPLY_TO overrides)
  reminder-email.ts        # server-only es/en "new episode" email renderer —
                           #   copy lives here, NOT in dictionaries.ts (that
                           #   module ships in the client bundle)
  email-unsubscribe.ts     # HMAC unsubscribe tokens + URL builders +
                           #   unsubscribeEmail() (deletes ALL rows for the
                           #   address; salt = MUX_SIGNING_KEY_PRIVATE_KEY,
                           #   same reuse as lib/trial.ts ip hashing)
  subscription-access.ts   # ACCESS_GRANTING_STATUSES + hasActiveSubscription()
  trial.ts                 # mintTrialSession, link/convert helpers, IP hashing
  tracked-links.ts         # universal (client form preview + server action):
                           #   canonicalizeUtmTriple/TargetPath, buildTrackedUrl
                           #   — MUST stay byte-identical to attribution's
                           #   normalizeUtm(Source) or link stats never match
  admin-analytics.ts       # LEGACY dashboard data layer (paid mode only since
                           #   2026-07-18): parseFilters, loadDashboard,
                           #   loadEpisodeFunnels, loadFreeShowDepth,
                           #   loadTrackedLinks
  admin-analytics-v2.ts    # spec'd free-mode dashboard data layer:
                           #   parseSpecFilters + loaders for KPIs / pulse
                           #   (rolling WAU, new/returning/lost) / funnel /
                           #   geo / source×geo matrix / content table /
                           #   retention curves / release retention — see
                           #   "Analytics dashboard v2" rule
  analytics-spec-shared.ts # SOURCE_BUCKETS (universal — client filter bar
                           #   must not import the server-only data layer)
  visitor.ts               # server-only first-party visit ledger writers:
                           #   recordVisitorDay, stampVisitorWallSeen,
                           #   linkVisitorToUser (visitor→user merge +
                           #   users.country stamp)
  visitor-cookie.ts        # matio_aid constants (universal; middleware-safe)
  watch-segments.ts        # 10s bucket constants (universal; player + action)
  world-map-grid.ts        # tile-grid world map dataset (ISO2 → col/row/name)
  attribution.ts           # UTM cookie capture + per-funnel-milestone
                           #   persistence + Stripe metadata flatten/unflatten
                           #   (writes gated on cookie consent in proxy.ts)
  meta-pixel-events.ts     # client fbq wrapper (trackPixel/onPixelReady) +
                           #   NEXT_PUBLIC_META_PIXEL_ID
  meta-capi.ts             # server-only Conversions API client (fetch, no SDK;
                           #   SHA-256 PII hashing; best-effort, never throws)
  capi-identity.ts         # server-only _fbp/_fbc/IP/UA capture + Stripe
                           #   metadata round-trip (capi_* keys + capi_consent)
  mux-data.ts              # server-only Mux Data API client for the admin
                           #   watch-time panel (Basic auth, cached 5m)
  use-marketing-consent.ts # client hook: live cookie_consent.marketing
                           #   (gates Mux Data on the players)
  posthog-events.ts        # client-side PostHog event helpers (curated named
                           #   events: show_viewed, trial_play_started, etc.)
  posthog-server.ts        # server-only posthog-node client (captureImmediate
                           #   for subscribe_succeeded in the Stripe webhook)
  posthog-query.ts         # server-only PostHog HogQL query client (personal
                           #   API key, plain fetch) — feeds the dashboard's
                           #   "Signup funnel" panel; under REQUIRE_SIGNUP the
                           #   anonymous top of funnel exists ONLY in PostHog
  i18n/                    # dictionaries.ts + server.ts + client.tsx (optimistic
                           #   LocaleProvider) + actions.ts + shared.ts +
                           #   negotiate.ts (pure Accept-Language/geo locale
                           #   detection — see "Locale detection" rule)
                           # + admin-* twins (admin-dictionaries/-server/
                           #   -client/-actions/-shared): admin-panel-only
                           #   ru/en locale, Russian default — see "Admin
                           #   locale" rule
  social-links.ts          # official social profiles (2 TikToks es/en, IG,
                           #   YT, X, FB) — single source for the footer row
                           #   (locale-matched TikTok), Organization sameAs,
                           #   and llms.txt; universal, canonical clean URLs
  about-team.ts            # /about team roster (owner content from the
                           #   «About page v3» mock): names + localized
                           #   roles/bios + card gradients; props for the
                           #   team slider, deliberately NOT in dictionaries
  utm.ts                   # normalizeUtm() — shared UTM canonicalization
                           #   (trim+lowercase+strip; universal, app + PostHog)
  utils.ts                 # cn() from shadcn
app/ root files rules refer to by name: layout.tsx, globals.css,
sitemap.ts, robots.ts, manifest.ts, llms.txt/route.ts, global-error.tsx,
both opengraph-image.tsx. Other load-bearing modules not listed above:
app/admin/actions.ts (all admin CRUD; typed error states),
app/admin/reminder-actions.ts, app/watch/actions.ts (saveWatchProgress /
saveTrialPosition / saveWatchSegments), app/admin/analytics/sessions/
(PostHog HogQL event feed — the live consumer of POSTHOG_PERSONAL_API_KEY),
lib/episode-access.ts (isEpisodeLocked), lib/continue-watching.ts,
lib/can-autoplay.ts, lib/checkout-session.ts / -trial.ts / -rate-limit.ts,
lib/posthog-sessions.ts, lib/staging-lock.ts, lib/use-vertical-layout.ts,
lib/api/ (types.ts universal + v1.ts server-only), lib/about-team.ts,
components/watch/signup-wall.tsx + vertical-chrome.tsx + watch-shell.tsx,
components/site/visit-beacon.tsx (client half of /api/t),
components/about/ (about/press bodies + team slider).
proxy.ts                   # Auth + admin gating (Next 16: was middleware.ts)
instrumentation.ts         # Sentry register (Node/edge) + the onRequestError
                           #   export — without it App Router route/server-
                           #   action errors never reach the tracker. No DSN
                           #   = neither runtime config is even imported
instrumentation-client.ts  # browser half; lazily imports sentry-client-init
sentry-client-init.ts      # browser Sentry.init (no Session Replay, no
                           #   feedback widget — both record the viewer)
sentry.server.config.ts    # Node init  — all three spread the same
sentry.edge.config.ts      # edge init     privacy options from lib/observability
lab/                       # UI Lab gallery pages (token sheet, golden.ts)
tools/claude/              # board + watcher + janitor scripts (see above)
tools/qa/                  # no-magic-styles.sh (CI style gate)
docs/                      # architecture/services/operations/gotchas +
                           #   mega-process/ (playbook), adr/, runbooks/,
                           #   registry.md (loose ends)
.github/workflows/         # ci, security, release-please, db-backup,
                           #   db-restore-check, deploy-production
public/press/              # press-kit ZIP + thumbs (committed, served static)
mobile/                    # Expo app (npm, OUTSIDE the pnpm workspace)
vercel.json                # regions=['fra1'] (co-located with Neon eu-central-1)
                           # + Cache-Control headers for /shows/* static assets
scripts/
  promote-to-admin.ts      # pnpm promote-to-admin <email>
  stripe-setup.ts          # pnpm stripe:setup — "Matio Membership" $38/mo
                           #   product+price + one-time $1 "Matio — 3-day trial"
                           #   product+price (STRIPE_PRICE_TRIAL_FEE). Archives
                           #   stale prices per plan on amount mismatch.
  check-subscription-dupes.ts # pnpm db:check-sub-dupes — pre-flight for 0008
                           #   (locale tests moved to lib/i18n/negotiate.test.ts
                           #    + lib/seo.test.ts — vitest, `pnpm test:locale`)
infra/
  backup/                  # DB backups (run by .github/workflows/db-backup.yml
                           #   + db-restore-check.yml, not by the app)
    backup_db.sh           #   pg_dump → age → private Vercel Blob → 35-day prune
    restore_check.sh       #   newest dump → decrypt → pg_restore into a clean
                           #     PG18 → smoke; fails on a STALE dump too
    blob.ts                #   tsx CLI over @vercel/blob (put/latest/fetch/
                           #     prune/selftest); Blob has no S3 lifecycle, so
                           #     retention IS this script
    retention.ts           #   pure prune rules (+ tests) — the one piece of
                           #     backup logic whose bug DELETES objects
```

## Key business rules

- **Mobile app + `/api/v1` (Expo/React Native, `mobile/`)**: the native client talks to `/api/v1/*` — `config` (startup: kill-switch flags, `minSupportedBuild` retirement lever, signup gate, legal URLs; DB-free), `catalog`, `shows/[slug]`, `playback-token`. Server half in `lib/api/v1.ts` (`import "server-only"`), wire types in `lib/api/types.ts` (**universal — imported by the app**, so a DTO change fails compilation instead of failing on a user's phone). Three deliberate divergences from the web, all forced by there being no browser: the token route is **POST** (side effects, never cached); the anonymous identity is a **device UUID header** (`x-matio-device-id`, validated as a canonical UUID) taking the `sessionToken` slot in `trial_sessions`, because `proxy.ts` skips `/api` for cookie minting; and the signup gate is **positional and softer than the web's** — `resolveSignupGate()` returns `{mode:'after_episodes', episodes: APP_SIGNUP_GATE_EPISODES ?? 1}` under free-mode + `REQUIRE_SIGNUP`, so the first episode of each show plays anonymously (a login wall on first launch is the likeliest App Store 5.1.1(v) rejection). `/v1/config` REPORTS that gate and `/v1/playback-token` ENFORCES it through the same function — never let those drift (the free-pivot lesson). Playback ids never cross the boundary: `shows/[slug]` returns signed **thumbnail** URLs (audience `t`, cannot mint video). Media URLs are absolutized (`absoluteMediaUrl`) — a native client has no origin to resolve `/shows/x.png` against. Free-tier tracking is best-effort: a rate limit or DB failure degrades measurement, never playback. `mobile/` is **outside the pnpm workspace** (own npm; `metro.config.js` watches `../lib` and sets `disableHierarchicalLookup` so Metro can't bundle a second React) and is excluded from `pnpm lint` / vitest / tsconfig. Plan and phasing: [docs/mobile-app-plan.md](./docs/mobile-app-plan.md); remaining work is issues #96–#99.

- **Free pivot (2026-07-04): payments are OFF by default — the whole site is free.** `lib/free-mode.ts:paymentsEnabled()` reads `PAYMENTS_ENABLED`; **unset (the current state) = free mode**, `PAYMENTS_ENABLED=1` + redeploy = paid mode back with zero code changes. Every rule below about trials / tiers / paywalls / checkout describes **paid mode** and is dormant while the flag is off. What free mode changes: `/api/playback-token` coerces the effective tier (signed-in → the `member` path, anonymous → the `free` path with its best-effort `kind='episodes'` tracking mint — anonymous funnel analytics + resume keep working) so it never 403s/429s; the watch page forces the gated branch (`gated = !paymentsOn || …`), presents every episode as `tier:'free'` to the player (the player locks episodes CLIENT-SIDE from that prop — coercing only the token route is not enough), and threads `freeMode` into `Player` so the series-end `ended` handler (also purely client-side) shows the neutral `seriesEnd` overlay instead of the member Paywall / free SignupWall; `saveWatchProgress` skips the subscriber-tier ownership gate and `saveTrialPosition` takes the full-tracking free branch (whose UPDATE is now filtered to `kind='episodes'` rows — a legacy `kind='preview'` row occupying the (cookie, show) slot must never receive uncapped positions or a `lastEpisodeId`); `/subscribe` + `/checkout` `redirect("/")` at the top of the page AND all three checkout server actions guard-return `{kind:'redirect',to:'/'}` as their first statement (they're independently POST-invocable); `proxy.ts` skips the Clerk sign-up bounce for `/subscribe(.*)` (falls through to UTM cookie capture; the page redirect does the bounce); the header/footer Subscribe links hide via a `paymentsEnabled` prop from `app/layout.tsx`; indexed copy (layout/twitter descriptions, OG tagline, manifest, about page, show `synopsisFallback`) and the show-page JSON-LD `isAccessibleForFree` switch to free variants; `/terms` renders a payments-disabled notice above the (untouched, counsel-pending) legal sections so the indexed page doesn't sell "$1 today" as a current fact. What free mode does NOT touch: the Stripe/Clerk/Mux webhooks, `mirrorSubscription` + `claimGuestCheckout` + `/welcome` (in-flight checkouts complete for ~24h after the flip and must still mirror/claim), `ACCESS_GRANTING_STATUSES` + `hasActiveSubscription()` (must always mean REAL subscription state — the guest duplicate guard depends on it), the billing portal (legacy subscribers cancel there; footer "Manage subscription" + user-menu item stay visible), the admin panel (tier selects keep working, just unenforced), and all dictionary keys (paid-mode copy stays for re-enable). **Re-enable checklist**: set `PAYMENTS_ENABLED=1` in Vercel (all environments) BEFORE the redeploy; verify `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_TRIAL_FEE` still exist (the `next.config.ts` build guard is now scoped to `PAYMENTS_ENABLED==="1"`); know that `kind='episodes'` trial rows minted during free mode read as *expired* trials on legacy all-subscriber shows (`findTrialSession` is kind-blind → instant 403 instead of a fresh 60s preview for cookies that watched during free mode — clear those rows or retier if it matters); annotate PostHog (grain era #5: `trial_play_started`/`paywall_shown`/`checkout_started` flatline during free mode, `free_episode_started` covers all anonymous playback).
- **Signup gate (2026-07-16): `REQUIRE_SIGNUP=1` = no playback without an account — free-mode only.** `lib/free-mode.ts:signupRequired()` is true only when payments are OFF **and** `REQUIRE_SIGNUP === "1"`; in paid mode the flag is a deliberate no-op (the per-episode tier system owns gating there — no second flag matrix). What it changes: the watch page presents every episode to **anonymous** visitors as `tier:'member'` (mode `free` + member tier ⇒ `isEpisodeLocked` locks everything, so the player renders `SignupWall` full-surface **prop-driven with zero token fetches/mints** — the same path a paid-mode member-tier deep link takes) and passes `autoplay={false}` (skip the useless capability probe) + `signupGate` (wall copy variant "Watch for free" / "Mira gratis", dict keys `signupWall.gateKicker`/`gateBody`; PostHog `signup_wall_shown` gains a `gate` property); `/api/playback-token` coerces anonymous requests to the member tier → 403 `reason:'signup_required'` (belt-and-braces for direct/scripted requests); `saveTrialPosition` coerces anonymous saves to member (reject, no write); show-page JSON-LD `isAccessibleForFree` flips to **false** (Google treats registration walls like paywalls — claiming "free" for account-gated video reads as cloaking). Signed-in users are untouched: member path plays everything, series-end keeps the neutral `seriesEnd` overlay via `freeMode`. After Clerk sign-up the wall redirects back to `/watch/<slug>?ep=<target>`, where the member branch already does attribution stamping + `CompleteRegistrationPixel` + trial-row linking. The hero teaser on `/` deliberately stays public (inline-minted JWT, not the token route). Analytics: anonymous playback stops ⇒ no new `trial_sessions` rows ⇒ the free/organic dashboard funnel (Sessions/Played/2+/3+, sources rollup, tracked-link stats, show depth) flatlines from the flip (**grain era #6**); the funnel becomes signups (`signup_origin='clerk_signup'`) + `watch_progress` engagement + PostHog `signup_wall_shown(gate:true)` → `signup_completed`. **Dashboard re-point (2026-07-18, SUPERSEDED same day)**: a PostHog-backed "Signup funnel" panel briefly re-pointed the free-mode dashboard; the full v2 redesign (see "Analytics dashboard v2" rule) replaced the whole free-mode page hours later, retiring that panel — `loadSignupFunnelDb` survives only inside the dormant legacy dashboard; `lib/posthog-query.ts` itself is still the live HogQL transport behind `/admin/analytics/sessions` (the `POSTHOG_PERSONAL_API_KEY` env pair stays required for THAT page; `/admin/analytics` itself is first-party).
- **Analytics dashboard v2 + first-party audience measurement (2026-07-18)**: `/admin/analytics` in free mode is the spec'd retention dashboard ("does the content hook people enough that they come back?") — 7 blocks: KPI row (Visits / Registrations+conv / North-Star deep-watch ≥80% of first episode / release retention), pulse chart (rolling-WAU line over daily new/returning/lost bars + release markers; "lost" = 7 straight days without a watch), cohort funnel (site → show → wall → registered → started → 25/50/80/100%), geo (tile-grid world map + country table), source×geo quality matrix, content block (episode table + clickable YouTube-Studio-style retention curve + watch-time widget), per-show release retention (% of ep-N finishers starting ep N+1 within 7 days of release). Data model: **consent-EXEMPT first-party measurement** — `matio_aid` httpOnly cookie (13 months, minted once in `proxy.ts`, never refreshed, skips bots/non-GET/api/admin; documented on /cookies + /privacy as strictly-necessary audience measurement, legal basis legitimate interests) + `/api/t` sendBeacon endpoint writing `visitors` (write-once first-visit UTM/referrer/country; raw IP never stored) and `visitor_days` (aid×day with home/show/wall flags); the wall flag is also stamped server-side by `markSignupWallShown` and the token route's 403. `linkVisitorToUser` (signed-in watch render, next to `applyUserAttribution`) merges visitor→user ("склейка", first link wins, funnel counts only accounts YOUNGER than the visitor row) and stamps `users.country`. Watch side: `saveWatchProgress` also upserts `watch_days` (user×day) and maintains monotonic `watch_progress.max_position_seconds` (`completed` keeps live flip-on-rewatch semantics — the continue-watching rail depends on it; analytics derive "finished" as `completed OR max_position ≥ 95%·duration`); the player marks 10s buckets on timeupdate (dedupe per continuous pass, seek re-arms — rewatch peaks are intentional) and flushes ≤120 buckets/20s to `saveWatchSegments` → `watch_segments` (episode×day×bucket counters) + `total_watched_seconds`. `episodes.released_at` is stamped write-if-null by the show-publish action AND the Mux ready webhook (published shows only); back-catalog release dates fall back to first observed watch in queries. Data layer `lib/admin-analytics-v2.ts` (fraction params need `::float8` casts — pg types bare numeric params as int against int columns); the single raw-SQL exception is the `generate_series` rolling-WAU query (`gs.d` must be cast `::date`). Page = Suspense islands per block; charts are static server SVG (`components/admin/spec-charts.tsx`; palette validated against `#0f0a07`); admin dict section `analyticsSpec` (ru/en). **Caveats**: ledgers accrue from deploy (older ranges read zero — the migration backfills `first_watched_at`≈`updated_at`, `max_position`≈`position` only); paid mode renders the untouched `legacy-dashboard.tsx`; `/admin/links` still generates tracked links but the legacy link-stats panel is dormant with it. 
- **Per-episode access control**: every episode has an `access` tier (`episodes.access` enum, admin-set via the season page's per-row select or the episode edit form, default `subscriber`): `free` (anyone, full episode, 1h auto-refreshing token), `member` (any signed-in user), `subscriber` (active subscription). A show with ≥1 ready non-subscriber episode is **tier-gated** (no 60s clock; per-episode walls); a show whose ready episodes are ALL subscriber-only keeps the legacy 60-second preview trial — the rule is derived, never configured. `/api/playback-token` enforces from the episode row (`showHasTierGating` probe only for subscriber-tier episodes); gated 403s carry `reason: "signup_required" | "subscribe_required"` and the player routes them to `SignupWall` (Clerk sign-up redirecting BACK to `/watch/<slug>?ep=<locked ep>`) or the tier-variant `Paywall`. Anonymous tracking reuses `trial_sessions` (`kind='episodes'`, positional `furthest_episode_number`, `last_episode_id`, `signup_wall_at`) with the same cookie/attribution/linking/conversion machinery as the legacy trial; the per-(IP, show) rate limit only degrades tracking on gated shows, never playback. Signup-completion events (Meta Lead + PostHog) also mount on the watch page. Admin analytics renders a per-show "Episode funnel" (`loadEpisodeFunnels`; wall threshold = last free episode's position). Replaced the show-level positional counts 2026-06-04 (live config backfilled by migration 0014; columns dropped by 0015).
- Trial state survives signup + Stripe checkout via the `trial_session` cookie. `linkTrialSessionsToCurrentUser` (runs on `/subscribe` render) links unlinked rows by cookie; Stripe webhook flips `trial_sessions.converted=true` on active subscription.
- **60-second anonymous trial (legacy; PAID MODE only — dormant while payments are off)**: triggered when the player on `/watch/[show-slug]` requests its first token — `/api/playback-token` mints the `trial_session` cookie and `trial_sessions` row at that point, after verifying the show is published+ready. Since 2026-06-09 the player **autoplays on land** for capable sessions: a muted-autoplay capability probe (`lib/can-autoplay.ts`, runs only once the tab is visible) decides whether `started` flips on mount — capable sessions fetch the token immediately so the 60s clock starts together with actual playback (deliberate funnel-friction tradeoff, supersedes the 2026-05-31 click-play-only gate), while autoplay-blocked sessions (iOS Low Power Mode, strict Safari/Firefox settings) and background-tab lands keep the poster play-gate so the clock can't burn with zero frames rendered. Crawlers always stay gated (`userAgent().isBot` + a UA supplement in the watch page → `autoplay={false}`). A **pre-gesture 429** (the mount fetch losing the IP bucket to other landers) degrades to the poster gate, not the full-surface `RateLimitedNotice` — only a real tap surfaces the honest error. Constant: `TRIAL_DURATION_SECONDS` in `lib/trial.ts`.
- Trial creation is rate-limited at **10** per (`ip_hash`, `show_id`) per hour (`TRIAL_RATELIMIT_PER_HOUR` in `lib/trial.ts`; was 3 until autoplay-on-land 2026-06-09 — mints are per-land now, not per-play-press). The client IP is sourced from `x-vercel-forwarded-for` only — `x-forwarded-for` is appended-to by Vercel (not replaced) so the leftmost entry is attacker-controlled. Missing header → fallback to `"unknown"`, which puts all unidentified requests in one shared bucket (fail-CLOSED). `ip_hash = HMAC-SHA256(MUX_SIGNING_KEY_PRIVATE_KEY, client_ip)` — no raw IPs in the DB. Cap exceeded → `/api/playback-token` returns 429 (with `Retry-After: 3600`).
- **Subscriptions**: single monthly plan at $38/mo — no annual, no other tiers. **New checkouts open with a $1 / 3-day intro trial (2026-06-11)**: a one-time **$1** line item (`STRIPE_PRICE_TRIAL_FEE`, charged at checkout) + `subscription_data.trial_period_days: 3` on the **unchanged** $38/mo price (`STRIPE_PRICE_MONTHLY`) — Stripe's Checkout-native paid-trial pattern (one-time prices bill on the *initial* invoice, so the $1 is collected today; the trial defers only the recurring $38). The sub is `status='trialing'` from day 0 (access-granting), flips `trialing→active` at day 3 when the first $38 invoice clears (`billing_reason=subscription_cycle`), then renews monthly. Shared config lives in `lib/checkout-trial.ts`; **both** checkout actions require `STRIPE_PRICE_TRIAL_FEE` and throw if unset (fail loud — never silently charge $38 against the "$1" copy). **Conversion value = $1, at day 0**: Meta `Purchase` + PostHog `subscribe_succeeded` fire on the trialing-start transition valued at the $1 actually collected (`TRIAL_FEE_VALUE`, not the $38 recurring amount); the day-3 `trialing→active` edge fires no second Purchase (by product decision — accepts undercounting the eventual $38). `InitiateCheckout`/`checkout_started` also report $1. Existing $38 subscribers are untouched (recurring price unchanged, nothing grandfathered). Repeat $1 trials are **not** deduped per-email yet (known gap — best handled via Stripe Radar, since the anonymous guest path can't pre-check trial history; the guest checkout action itself IS now IP/hour rate-limited in-app, see Production context). Stored in `subscriptions` table; mirrored from Stripe via webhook (one source of truth). The `subscription_plan` enum still carries an `'annual'` value for any historical (pre-launch test) rows but no new row is ever written with it. The webhook is idempotent — every delivery claims its `event.id` in `stripe_events` before processing; duplicates short-circuit. Partial unique index on `(user_id) WHERE status IN ('active','trialing','past_due')` guarantees at most one access-granting row per user; historic rows (status='canceled') stay. Every subscription gate also checks `current_period_end > now()` so a dropped `customer.subscription.deleted` webhook can't extend playback past the user's term.
- **Subscription gate**: all read sites (`/api/playback-token`, `/watch/[showSlug]`, `saveWatchProgress`) go through `hasActiveSubscription(userId)` in `lib/subscription-access.ts`. `ACCESS_GRANTING_STATUSES = ["active","trialing","past_due"]` — past_due grants access (Stripe is mid-retry on a failed invoice; locking the user out makes recovery via Customer Portal impossible). Stripe's `paused` status maps to `past_due` for the same reason.
- **In-site checkout (Embedded, 2026-06-14)**: both checkout entry points — the signed-in `/subscribe` CTA and the signed-out pay-first paywall CTA — are `<Link>`s to **`/checkout`** (`app/checkout/`), which renders **Stripe Embedded Checkout** (`@stripe/react-stripe-js` `<EmbeddedCheckout>`) in an iframe **on our domain** — the buyer never leaves `matio.tv`. `app/checkout/checkout-client.tsx` calls the unified `createCheckoutSession` server action (`app/checkout/actions.ts`) on mount; it resolves auth **server-side** and dispatches to `createAuthCheckoutSession` (signed-in) or `createGuestCheckoutSession` (guest) — the **same** session builders as before, with **all** prior config intact (the $1+$38 line items, `subscription_data` trial, `automatic_tax`, billing-address collection, ToS-withdrawal `consent_collection`, locale, and the full attribution/CAPI/guest-claim metadata). The only Stripe change is `ui_mode: "embedded_page"` (the pinned `2026-04-22.dahlia` API renamed `embedded`→`embedded_page`) + `return_url` instead of `success_url`/`cancel_url`; the action returns a `CheckoutSessionResult` (`lib/checkout-session.ts`) the client handles — `embedded` (mount the iframe), `hosted` (full-navigate to Stripe), or `redirect` (guard bounce via `router.replace`). After payment, `redirect_on_completion` defaults to `always` so Stripe sends the **top frame** to `return_url` (`/welcome` for guests, the watch path for signed-in) — the `/welcome` claim + webhook-mirror machinery is **untouched**. **Graceful degradation**: when `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is unset (server `embeddedCheckoutEnabled()` false), the actions create a **hosted** session and `/checkout` full-navigates to `checkout.stripe.com` — the exact pre-embedded behavior, so a deploy missing the key never breaks checkout. NEXT_PUBLIC is build-time-inlined, so set the key in Vercel **before** the deploy that wants embedded. The checkout-intent events (Meta `InitiateCheckout` + PostHog `checkout_started`) still fire server-side inside the builders (now at `/checkout` mount, not CTA click); `signup_cta_clicked` still fires at the CTAs. **Webview caveat**: Embedded Checkout is an iframe to `js.stripe.com` — in restrictive in-app browsers (Instagram/Facebook), iframes + Apple/Google Pay can be flaky vs. a full hosted page; `OpenInBrowserHint` is kept on the pay-first paywall to nudge those users out to a real browser. Stripe Dashboard → Branding controls the embedded form's look (no client-side `appearance` API for Embedded Checkout).
- **Pay-first guest checkout (`PAY_FIRST_CHECKOUT=1`, "invisible account", 2026-06-09)**: with the flag on, the paywall's **signed-out** CTA links to `/checkout`, which calls `createGuestCheckoutSession` (`app/subscribe/guest-actions.ts`) — a Checkout session with NO Clerk step (no `customer`/`customer_update`; Stripe creates the Customer from the email typed on the checkout form). The purchasing browser is bound to its session via the httpOnly `checkout_claim` cookie mirrored into `client_reference_id` (cookie reused across tabs so the `checkout:guest:<token>:<hour>` idempotency key dedupes parallel submits). `subscription_data.metadata` carries `guest=1` + `claim_token` + `trial_token` (the trial cookie, for exact-token trial→paid linkage) plus the usual attr_*/capi_*/ph_consent keys. **Claim** (`lib/guest-checkout.ts:claimGuestCheckout`, idempotent, THROWS on failure): resolve email from the Stripe customer → find-or-create the Clerk user (`createUser({skipPasswordRequirement:true})` — passwordless, email-code is the canonical credential) → upsert the users mirror with `stripeCustomerId` → link trials by exact token + stamp attribution from metadata. Runs from BOTH the webhook (`lib/subscription-mirror.ts` no-user branch — a throw rolls back the `stripe_events` claim so Stripe retries; never warn-and-return a guest sub) AND the `/welcome` success page (closes the webhook-vs-redirect race; both writers idempotent, whichever lands first wins). The guest **duplicate guard** lives in `mirrorSubscription`: a guest sub whose user already holds an access-granting row is NOT mirrored — loud `console.error`, manual refund (alert-only by design; never auto-refund from a webhook). `/welcome` mints a Clerk sign-in ticket (`signInTokens.createSignInToken`, 600s) **only when the `checkout_claim` cookie equals the session's `client_reference_id`** — the no-cookie/webview path degrades to email-code sign-in with a masked email, NEVER token minting (the URL-borne `session_id` is shareable; that cookie check is load-bearing security). Ticket consumed client-side via the signal-based `signIn.ticket({ticket})` + `signIn.finalize()` (`components/welcome/ticket-sign-in.tsx`). Lead/CompleteRegistration + signup_completed fire post-sign-in on /welcome (AFTER Purchase — funnel reorder: don't optimize Meta ad sets on Lead while the flag is on). The flag also disables the expired-trial server redirect to `/subscribe` on the watch page (the player's token 403 renders the pay-first paywall instead). Flag off → everything falls back to the auth-first flow. **Clerk prod prerequisite: "Email verification code" sign-in must be enabled** (the created accounts have no password). Stripe's no-code Customer Portal login page is the account-less cancel safety net.
- **Subscribe surface**: `/subscribe` shows a single membership card now leading with the intro trial (`$1 / 3 days` → `Then $38/month`, EN default; `$1 / 3 días` → `Luego 38 $/mes`, ES) — no plan picker. The in-player paywall (`components/watch/paywall.tsx`) leads with **sign-up**, not pricing — the in-player CTA opens Clerk's `<SignUpButton mode="modal">` with `forceRedirectUrl=/subscribe?show=…`; its pay-first CTA now reads `Pruébalo · 1 $ por 3 días` / `Try it · $1 for 3 days`. Signed-in non-subscribers (paid→canceled→returned) skip the sign-up step via a direct `<Link>` to `/subscribe`. Checkout's `line_items` is the $38/mo price **plus** the one-time $1 trial fee (`checkoutLineItems`); it collects billing address (`customer_update.address: "auto"`, `billing_address_collection: "required"`), runs `automatic_tax: { enabled: true }` on a `tax_behavior=exclusive` price (so tax stacks on top of $38 — currently $0 until a Stripe Tax registration is added, see [Production context](#production-context)), and requires the EU/UK 14-day-withdrawal waiver via `consent_collection.terms_of_service: "required"` + localized `custom_text.terms_of_service_acceptance` (`createAuthCheckoutSession` in `app/subscribe/actions.ts`). `locale` is passed so the checkout matches the site language. The `/subscribe` CTA is now a `<Link>` to `/checkout` (in-site Embedded Checkout — see next rule), not a `<form action>` redirect.
- **Autoplay + instant auto-advance (2026-06-09)**: the watch player owns its first-play attempt in an effect (deliberately NOT `<MuxVideo autoPlay="any">` — playback-core's chain retries muted on ANY rejection including the AbortError from a user's own startup pause; ours retries muted **only on `NotAllowedError`**). A muted-fallback start shows a "Tap for sound" pill (gated on a loadstart muted-snapshot so a persisted media-chrome mute pref doesn't trigger it; the pill unmutes via the `mediaunmuterequest` event so the pref updates too). A fully blocked play (element left paused, **no signal**) is detected by a loadedmetadata/canplay+2s probe (loadedmetadata matters: iOS native HLS never reaches canplay while paused) that surfaces a tap-to-play overlay unless the pause was the user's own (`pause`-event ref). `trial_play_started` fires on the first `playing` frame, not token issuance — saved PostHog funnels keep meaning "started watching". At `ended` with an unlocked next episode (subscriber/member/free modes), the player advances **instantly on the same `<video>` element**: `EpisodePlayback` is keyed on a `mountKey` that only manual swaps bump, the `<MuxVideo>` key is a `refreshNonce` that only subscriber token-refreshes bump, and the advance changes `playbackId`+`token` together (the wrapper re-derives src in place). Element identity is load-bearing — WebKit's autoplay blessing is **per-element** and survives src changes but not remounts, so never reintroduce `key={current.id}`/`key={token}`. The next episode's token is prefetched 45s before the end (`PRELOAD_LEAD_SECONDS`) and a hidden muted `<MuxVideo display:none>` preloader warms ~30s of the next stream into the browser HTTP cache (Mux segment URLs are deterministic + cacheable ~a week; playlists are no-store but tiny). Per-episode state resets split three ways: refs in the `onEnded` handler, visual state in a render-phase `prevEpisodeId` adjustment (NOT an effect — `react-hooks/set-state-in-effect`; NOT `Date.now()` in render — `react-hooks/purity`), and everything else via the manual-swap remount. The legacy 60s trial keeps the countdown card (its prefetched token would be dead on arrival; the preview ends at the paywall). `episode_auto_advanced` fires per transition (PostHog).
- **Player end-states**: token-fetch failures branch into three distinct overlays in `components/watch/`: `Paywall` (403 in trial → "Sign up to keep watching"), `RateLimitedNotice` (429 → "Too many previews this hour"), `PlaybackUnavailable` (5xx / network / video decode error → "Try again"). The latter two used to all dump into the paywall, which framed infrastructure failures as a payment issue. The `<video>` element's own `error` event uses a rolling 10-second 3-error window before tripping `PlaybackUnavailable` — codes `MEDIA_ERR_DECODE` (3) and `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) are terminal and flip immediately; transient `MEDIA_ERR_NETWORK` (2) gives Mux/HLS room to retry. A single buffer-stall on cellular shouldn't kill the player.
- **Token refresh**: subscriber tokens auto-refresh **60 seconds before expiry** (not at expiry). Mux validates the JWT `exp` per-segment-request, so a refresh exactly at the boundary races segment fetches that go out a hair late and 403s mid-playback. 5xx/network failures during refresh retry with exponential backoff (1s/2s/4s, 4 attempts total) before flipping to `PlaybackUnavailable`. The existing token keeps playing through the refresh window — we deliberately don't `pause()` while retrying. **Trial** tokens (60s TTL) are deliberately *not* refreshed: the refresh lead (60s) equals the whole TTL, so the old code re-armed every network round-trip in a tight loop (re-minting the token endlessly, and — since `@mux/mux-video-react` only re-derives its src on a `playbackId` change — never reaching the player); the player now schedules a single transition to the paywall at the trial token's expiry instead.
- **Watch-progress save** (`components/watch/player.tsx`) is gated on `document.visibilityState === "visible"` and flushes immediately on `visibilitychange`/`pagehide`. Without the gate, mobile users lost up to 10s of progress every time they backgrounded the app and burned battery on hidden tabs.
- **Billing portal**: `/api/billing-portal` is the single entry point — it does auth + customer lookup + Stripe billingPortal session + 302 in one server hop. The Clerk user menu's "Manage subscription" item links straight to it; no `/account` page exists.
- **Admin role**: set via DB column `users.role`, never via Clerk metadata alone. `proxy.ts` does the lookup on every `/admin/*` request via a module-scoped 5-second cache; `requireAdmin()` does it again inside actions (cache-free) for belt-and-braces.
- **Auth gating**: `proxy.ts` sends unauth'd `/subscribe(.*)` requests to Clerk's **sign-up** page (not sign-in) — most paywall conversions are first-time users; Clerk's sign-up page still links to sign-in for the minority case. Admin routes keep `redirectToSignIn` since admins already have accounts.
- **Locale detection (preferred language)**: **English is the site default since 2026-07-04 (was Spanish)** — Spanish remains for visitors likely to prefer it, via negotiation and geo affinity. `getLocale()` (`lib/i18n/server.ts`, React-`cache()`d per request) resolves: **`x-matio-locale` request header (URL-derived, set by the /es rewrite — authoritative, see "Bilingual URL routing" below)** → `locale` cookie (explicit switcher choice) → `Accept-Language` negotiation (an es header still wins Spanish) → `en` (`DEFAULT_LOCALE` in `lib/i18n/dictionaries.ts`). **The geo tiebreak was REMOVED 2026-08-31** (owner decision): an unmatched header (ru/de/fr/pt) now gets English everywhere — the old ES_AFFINITY_COUNTRIES guess handed Spanish to every non-es-non-en browser in Spain/LatAm and then pinned it via the sticky cookie. Geo (`x-vercel-ip-country`) is no longer consulted for language at all (it still drives cookie-consent geo logic — separate map, untouched). The pure matching rules live in `lib/i18n/negotiate.ts` (universal — also used by `global-error.tsx`'s `navigator.languages` fallback and `pnpm test:locale`). Detection persists nothing **on bare (English) paths** (self-heals when the browser language changes); an `/es` visit does set the sticky `locale` cookie so the non-localized app surfaces (/watch, /subscribe) follow. Two deliberate asymmetries: (1) a *missing* `Accept-Language` (Googlebot sends none, crawling from US IPs) skips geo and returns `en` — **the indexed language at a bare path is English** (the 2026-07-04 flip deliberately changed it; re-crawl/Search Console impact expected); (2) an unmatched header goes straight to `en` — no geo consultation (since 2026-08-31). The locale-invariant crawler-facing surfaces (`app/manifest.ts`, both `opengraph-image.tsx` files, `websiteJsonLd.inLanguage` order) hard-code the `en` dict for the same reason they used to hard-code `es`. PostHog gets `locale` + `locale_source: chosen|detected` super-props for funnel segmentation. Never call `getLocale()` inside `unstable_cache`/`use cache` (`headers()` throws there). See [architecture → Locale resolution](./docs/architecture.md#locale-resolution-i18n).
- **Bilingual URL routing + hreflang (2026-07-24)**: the indexable public set is served on **distinct per-language URLs** so BOTH languages are crawlable (before this, only the crawler-default English was ever indexed — Spanish was invisible to search). Scheme: **English = bare path** (canonical + `x-default`), **Spanish = `/es` prefix** (`/es`, `/es/shows/<slug>`, `/es/about`, …). Single source of truth is `lib/seo.ts` (`isLocalizablePath` / `stripLocalePrefix` / `localizedPath` / `localeAlternates` — dependency-free, shared by proxy + metadata + sitemap + client switcher). Localized set: `/`, `/shows/[slug]`, `/actors/[slug]`, `/about`, `/terms`, `/privacy`, `/cookies` — **nothing else** (admin/api/`/watch`[noindex]/`/subscribe`/`/checkout` stay single-URL; a crafted `/es/admin` strips to `/admin`, fails `isLocalizablePath`, and 404s rather than bypassing the gate). Mechanics (`proxy.ts`, no `app/[locale]` restructuring): a `/es/*` request is **rewritten** to the base route with an `x-matio-locale: es` request header (`getLocale` reads it first) + the sticky `locale` cookie set; it runs the SAME marketing/visitor cookie machinery as a bare landing (an es ad landing on `/es/shows/*` still captures UTM/_fbc/consent — `applyLocalizedRewrite` reuses `evaluateMarketing`/`writeMarketingCookies`). A **Spanish-preferring human** (cookie `es`, or no cookie + `negotiateLocale`→es) on a bare localizable URL gets a **307 to the `/es` twin** (bots are NOT redirected, so English stays the indexed bare-path default; the 307 preserves `?utm_*`/`?fbclid`). Every localized page emits reciprocal `alternates.languages` (en/es/x-default) via `localeAlternates(basePath, locale)`, and the sitemap emits the same cluster per entry. The language switcher (`lib/i18n/client.tsx`) **navigates** bare↔`/es` on public pages (a bare refresh would leave an `/es` URL rendering Spanish regardless of the new cookie — URL wins in `getLocale`). Cost: es users incur a redirect hop on bare internal links (acceptable; a future locale-aware `<Link>` could avoid it). JSON-LD `@id`/url stay English-canonical (locale-invariant brand graph). `pnpm test:locale` covers the URL helpers.
- **Clerk UI locale**: `ClerkProvider` in `app/layout.tsx` receives the `@clerk/localizations` bundle matching the site locale (`esES` or `enUS` per the resolved locale — detected or switched). Sign-in/sign-up modals, UserButton menu, and form validation copy all follow the site language; the switch propagates to Clerk on the next `router.refresh` tick after the optimistic site flip.
- **Admin locale (admin panel only)**: the admin panel has its own locale system in `lib/i18n/admin-*` — **Russian by default**, English via the RU|EN toggle in the admin nav (`components/admin/locale-switcher.tsx`). Own `admin_locale` cookie (1y, httpOnly:false, written by `setAdminLocale` + optimistic client mirror — same pattern as the public switcher); no Accept-Language/geo detection (admin is internal). Completely separate from the public es/en system: flipping it never touches the visitor-facing language, and the EN admin dict reproduces the panel's original hard-coded copy verbatim. Server components use `getAdminDict()` (`lib/i18n/admin-server.ts`, React-`cache()`d); client components use `useAdminT()` under `AdminLocaleProvider` (mounted in `app/admin/layout.tsx`). Russian pluralization (3 forms) lives inside the dict's count functions (`ruPlural`) — never reintroduce `n === 1 ? "x" : "xs"` ternaries in admin copy. `components/admin/ui.tsx` and `components/admin/charts.tsx` are now **server-only** (they call `getAdminDict()` internally; all importers are server components — don't import them from a client component). Server-action `throw new Error` messages stay English on purpose (masked in prod anyway).
- **Actors (2026-07-09)**: a global actor roster (`db/schema/actors.ts`,
  migration 0021) + per-show cast; public `/actors/[slug]` (localized, part of
  the bilingual URL set) and admin `/admin/actors/**`; hover-card chip on the
  show page (touch taps navigate — no tap popup); avatars live in Blob; actors
  are hard-deleted, not soft-deleted.
- **Vertical player**: `shows.orientation` (pgEnum, migration 0018) switches
  the watch player's chrome — one engine, branched chrome
  (`components/watch/vertical-chrome.tsx` vs the horizontal transport), gated
  by `lib/use-vertical-layout.ts` (vertical && viewport ≤768px). Any player
  edit has to be checked in both orientations.
- **Mux re-upload safety**: `createMuxUpload` only creates the upload URL — it does NOT clear the episode's playback fields. The clearing happens in `markEpisodeReprocessing`, which the upload widget calls from upchunk's `success` event. A cancelled mid-upload no longer permanently breaks the episode (Mux's webhook refuses to overwrite a different existing `asset_id`). Two numbers in this path are anti-regressions, not decoration: `uploads.create({ timeout: 86_400 })` (`app/admin/actions.ts` — Mux's one-hour default doesn't survive a multi-GB master and filled the account with `timed_out` uploads, #130), and upchunk's `retryCodes: [0, 408, 429, 500, 502, 503, 504]` + `attempts: 10` + `dynamicChunkSize` capped at 20MB (`components/admin/upload-widget.tsx` — the default list has no `0`, and a dropped connection is exactly status 0, so every network hiccup used to kill the upload on the FIRST try, #131). After success the widget polls `router.refresh()` every 10s (≤15 min) until the `episodeStatus` prop from the episode page reads `ready` (#136) — removing that prop unhooks the poller.
- **Show artwork (poster/hero)**: drag-and-drop in the show form uploads **client-direct to Vercel Blob** — `components/admin/image-upload-field.tsx` calls `upload()` from `@vercel/blob/client`, which gets a scoped token from `/api/admin/upload-image` (`handleUpload`; admin-gated via `getCurrentAdmin()`, image content-types only, ≤15 MB, pathname pinned to `shows/(poster|hero)-*`, `addRandomSuffix` so nothing is ever overwritten). The file bytes never touch our functions (same philosophy as the Mux/upchunk video path — sidesteps the ~4.5 MB body limit). The returned URL lands in the existing `posterImageUrl`/`heroImageUrl` form fields, so `createShow`/`updateShow` persist it unchanged; `updateShow` best-effort `del()`s the previous Blob object when artwork is replaced/cleared (scoped to our Blob host — legacy same-origin `/shows/*.png` values are left alone and still work). The URL input remains as a fallback for same-origin paths; arbitrary external hosts will throw in `next/image` on the public pages (not in the `remotePatterns` allowlist).
- Playback always goes through `/api/playback-token` → signed Mux JWT. Subscriber TTL: 1 hour (auto-refreshed). Trial TTL: `min(remaining, TRIAL_DURATION_SECONDS)`.
- **Campaign attribution**: `proxy.ts` reads `?utm_source / utm_medium / utm_campaign` on every non-admin request and writes two cookies — `attribution_first` (90d, write-if-absent) and `attribution_last` (30d, overwrite). Helpers in `lib/attribution.ts`. **Both writes are gated on `hasMarketingConsent(cookie_consent)`** — without consent the UTM params still flow through the request but aren't persisted to cookies, so we never drop tracking on EU visitors before they've accepted the banner. The cookies are snapshotted at each funnel milestone: `trial_sessions.attribution_*` (six cols) on first play via `mintTrialSession`, `users.attribution_*` on `/subscribe` render via `applyUserAttribution`, and `subscriptions.attribution_*` at Stripe Checkout creation via `subscription_data.metadata` → webhook `mirrorSubscription`. Subscription attribution is **never overwritten on conflict** (renewals would otherwise erase the original conversion campaign months later, when no UTM cookies are present). `clean()` runs every UTM value through `normalizeUtm` (`lib/utm.ts` — trim + lowercase + strip every char outside `[a-z0-9_-]`, keeping the 100-char cap) before persisting, so case drift / encoded spaces / stray junk don't fragment campaigns (numeric Meta `{{campaign.id}}` values pass through unchanged). Admin analytics renders two side-by-side per-campaign tables — first-touch is the default and the right cut for "is this awareness channel working?" since Matio's funnel is delayed-conversion; last-touch is the comparison view for reconciling with Meta/Google dashboards. **Free-mode addendum (2026-07-06)**: `/subscribe` (the historical `applyUserAttribution` + trial-linking surface) redirects home in free mode, so the watch page's signed-in gated branch now runs `applyUserAttribution` too — **gated on `!paymentsOn`** (paid mode keeps /subscribe-only stamping). Without it every free-mode signup reads "(direct)".
- **Tracked links + dual-mode dashboard (2026-07-06)**: `/admin/links` generates shareable UTM links for social posts, stored in `marketing_links` (target path + UTM triple; **partial unique on the active triple** — archive frees it). Link stats need NO new instrumentation: `lib/tracked-links.ts` canonicalizes the triple with the SAME `normalizeUtmSource`/`normalizeUtm` the attribution pipeline uses (byte-identical or stats never match — never add a second normalization layer), and `loadTrackedLinks` matches sessions/signups on the **first-touch** triple (`kind='episodes'` only). Target paths are lowercased (App Router matching is case-sensitive). `/admin/analytics` branches on `paymentsEnabled()`: **free mode** = organic funnel (Sessions → Played → 2+ → 3+ eps, all `kind='episodes'`-scoped incl. the campaign table), sources rollup, tracked-links panel, per-show depth cards (`loadFreeShowDepth` — ALL shows, not just tier-gated), 2-metric trend; **paid panels are stubbed** (`loadDashboard(f, paymentsOn)` resolves dead queries to zeros — previews/conversions/subs/MRR/donut/episode-funnels render only when `PAYMENTS_ENABLED=1`, nothing deleted). `loadTrackedLinks` degrades to `[]` on a missing table (42P01) so a premature deploy can't 500 the dashboard — but the migrate-before-deploy order still applies.
- **Episode reminder emails (Resend, 2026-07-13)**: the series-end overlay (last episode's `ended`) captures an email into `show_reminders` via `subscribeToShowReminder` — unique `(show_id, email)`, site locale + hashed IP snapshotted per row, published-show check, works signed-out, **rate-limited at 10 new rows per (hashed IP, rolling hour)** (`REMINDER_RATELIMIT_PER_HOUR` — an unlimited anonymous write would let garbage addresses flood the ledger and tank sender reputation when dispatched). A **resubmit re-arms the reminder** (conflict path sets `notified_at` back to NULL, refreshes locale, coalesce-backfills `user_id`) — "notify me" after an already-dispatched episode means the NEXT one; `created_at`/`ip_hash` keep original values so re-arms don't consume rate-limit budget. Dispatch is deliberately **manual**: the "Episode reminders" panel on the admin show edit page posts to `sendShowReminders` (`app/admin/reminder-actions.ts`), which announces one *ready* episode of a *published* show — claims pending rows in batches of 100, up to 50 batches per click — one press can dispatch up to **5,000 emails** (mind Resend's free tier: 100/day) — by stamping `notified_at` (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` so concurrent clicks claim disjoint rows), renders each row's locale via `lib/reminder-email.ts`, batch-sends through Resend (`replyTo` contact@; idempotency key = `show-reminder/<episodeId>/<sha256 of the SORTED claimed row-id set>` — an identical retry dedupes for 24h regardless of RETURNING order, a changed composition mints a new key instead of 409-wedging; `batchValidation: "permissive"` so one Resend-rejected address fails only its own item — those rows stay STAMPED and are error-logged, never re-queued, or a permanently-bad address would wedge every future send), and **un-claims the batch on a failed send** — `notified_at IS NULL` must always mean "still owed an email". Every email carries a footer unsubscribe link (`/unsubscribe` confirm page — never deletes on GET, mail scanners prefetch) plus RFC 8058 `List-Unsubscribe`/`List-Unsubscribe-Post` one-click headers (POST `/api/email/unsubscribe`); both paths verify an HMAC token (salt = `MUX_SIGNING_KEY_PRIVATE_KEY`, same reuse as trial IP hashing) and unsubscribing hard-deletes every `show_reminders` row for the address. `RESEND_API_KEY` unset = graceful degradation: the capture form keeps storing, the admin panel shows a connect hint, nothing throws. Watch links deep-link `?ep=<episode id>` with a normalizeUtm-clean `utm_source=email` triple so email sessions segment in attribution. Both `console.error` paths run Resend's message through `redactEmails` and log `show_reminders.id`, never the address (Resend quotes the rejected address in its error text — #132; do not "simplify" back to raw `e.message`). Reminders are the only app-sent email — Stripe receipts and Clerk auth codes remain those services' own.
- **Meta Pixel + Conversions API**: consent-gated advertising measurement. The browser pixel (`components/site/meta-pixel.tsx`) only injects `fbevents.js` after `cookie_consent.marketing === true`; the banner's accept/reject broadcasts `CONSENT_CHANGED_EVENT` so it loads/halts without a reload. **Multiple browser pixels** are supported: `META_PIXEL_IDS` (`lib/meta-pixel-events.ts`) = primary `NEXT_PUBLIC_META_PIXEL_ID` + comma-separated extras from `NEXT_PUBLIC_META_PIXEL_IDS`; `meta-pixel.tsx` runs one `fbq('init',…)` + one `<noscript>` img per pixel, and every `fbq('track',…)` (no pixel arg) fires to all of them, so each call site hits every pixel. Browser events (`lib/meta-pixel-events.ts` → `fbq`) follow the **2026-06-10 funnel mapping** (started watching → ViewContent, reached paywall → Lead, started checkout → InitiateCheckout, subscribed → Purchase): `PageView`; `ViewContent` fires on the watch player's **first playing frame** (any mode, once per player mount — moved off `/shows/[slug]` because ad traffic lands directly on `/watch` and never fired it there; the show page keeps only the PostHog `show_viewed`); `Lead` fires when a viewer **finishes the first episode of a show** (2026-07-19 remap; the player's `ended` handler in `components/watch/player.tsx`, `currentPosition === 1`, `content_category:"first_episode_finished"` — the hooked-viewer signal, browser-side twin of the dashboard's North-Star deep-watch metric; neither wall fires Meta events anymore — wall impressions are PostHog-only), once per browser via the historical `matio:fb:lead` localStorage flag (Lead ≈ unique hooked prospects; mode-agnostic, so it works identically in free, gate, and paid eras); `InitiateCheckout` fires server-side from both checkout actions (paywall CTA for guests, `/subscribe` submit signed-in); `CompleteRegistration` (no Lead) still fires at account materialization (first authed `/subscribe` or post-sign-in `/welcome`), deduped per user on the historical `matio:fb:creg:` flag. Server-side CAPI (`lib/meta-capi.ts`, plain `fetch` to graph.facebook.com — **no SDK**) fires **`Purchase`** from the Stripe webhook on the *transition into* an access-granting status only (guards renewal double-counts), `event_id=sub.id`, with SHA-256 email/external_id + the `_fbp`/`_fbc`/IP/UA captured at checkout. Those match params ride through Stripe `subscription_data.metadata` (`capi_*` keys + a `capi_consent` sentinel) exactly like UTM attribution — set in `startCheckout`, read back in `mirrorSubscription`, written on INSERT only. `_fbc` is also derived from `?fbclid` in `proxy.ts` under the same consent gate. CAPI is best-effort (never throws, 3s-bounded) so a Meta outage can't roll back the webhook idempotency claim. `sendCapiEvents` **fans out to every pixel that has its own token**, in parallel: primary (`NEXT_PUBLIC_META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN`) plus each extra in `NEXT_PUBLIC_META_PIXEL_IDS` paired with `META_CAPI_ACCESS_TOKEN_{n}` (2-based, by position) — same never-throws/3s-bounded contract, webhook unchanged. Extra pixels **without** a token stay browser-only. Env: `NEXT_PUBLIC_META_PIXEL_ID` + `NEXT_PUBLIC_META_PIXEL_IDS` (public), `META_CAPI_ACCESS_TOKEN` + `META_CAPI_ACCESS_TOKEN_{n}` (secret), optional `META_CAPI_TEST_EVENT_CODE` / `META_GRAPH_API_VERSION`. No DB migration — match params are carried in Stripe metadata, not new columns.
- **Mux Data + engagement analytics**: Mux Data (watch-time / unique viewers / QoE) is wired onto the watch `<MuxVideo>` and hero `<MuxPlayer>` via `envKey={NEXT_PUBLIC_MUX_DATA_ENV_KEY}` (public token). **Consent-gated**: `lib/use-marketing-consent.ts` (live `cookie_consent.marketing` via `CONSENT_CHANGED_EVENT`) → the players pass `disableTracking`/`disableCookies` and omit `envKey` unless the key is set AND consent is given, so no beacons/viewer-id cookies fire pre-consent (this also closed the AUDIT.md H2 pre-consent leak). Leave the env key blank to keep Mux Data fully off. The admin analytics dashboard (`app/admin/analytics/page.tsx`) also derives **approximate** engagement from `watch_progress` (completion rate, avg % watched, avg watched/viewer, per-show viewers/completion) + trial preview depth from `trial_sessions.last_position_seconds` — approximate because `position_seconds` is the last-saved resume playhead, not cumulative watch time. For **real** watch-time it has a "Watch time · Mux Data" panel that pulls totals (watch time, views, unique viewers) + per-show breakdown from the **Mux Data API** server-side (`lib/mux-data.ts`, Basic auth, cached 5 min, hero excluded via `filters[]=!player_name:matio-hero`). That needs a separate **secret** token with Mux Data: Read — `MUX_DATA_API_TOKEN_ID`/`MUX_DATA_API_TOKEN_SECRET` (distinct from the public env key and the video token); unconfigured → a connect hint, never breaks the page. The Mux panel renders in its **own `<Suspense>` island** (`MuxDataSection`) and the API fetch is bounded by `AbortSignal.timeout(3500)` — the external call must never gate the DB-backed sections. **Dashboard metric grains (2026-06-06; grain shift 2026-06-09)**: autoplay-on-land changed what a `trial_sessions` row means — since 2026-06-09 rows (both kinds) mint when a **visible, autoplay-capable session lands** (playback starts in the same moment), not when the user presses play; blocked-autoplay sessions still mint on tap. Pre/post series aren't comparable (third grain era after the 2026-05-31 click-play fix). Every trial metric is `trial_sessions.kind`-scoped — the acquisition funnel / depth histogram / "Превью" KPI are `kind='preview'` only (free-tier rows aren't 60s-capped and used to inflate them; preview positions are also `LEAST`-capped at 60 in queries AND clamped at the save source in `app/watch/actions.ts`); the conversion cohort + campaign-table "Sessions" count both kinds; the trend chart has a separate free-tier metric. The campaign table is **flow-grain**: Subs/MRR = subscriptions *created in range* (access-granting), plus a "Wall %" engagement column (preview ≥55s OR `signup_wall_at` reached) — the buy/kill signal while conversion volume is tiny. The "Subs" filter scopes the status-mix donut (`statusSet` → `inArray`). Time-series granularity auto-coarsens past `MAX_SERIES_BUCKETS` (750) so hourly×all-time can't truncate the chart. Range scans are indexed: `trial_sessions(kind, started_at)` + `subscriptions(created_at)` (migration 0016). **Pay-first adaptations (2026-06-10)**: the Signups KPI / trend / campaign column scope to `users.signup_origin='clerk_signup'` (guest-checkout accounts are created AT purchase and would double-read "New subs"; `signup_origin` added in migration 0017, stamped `'guest_checkout'` by `claimGuestCheckout` on insert only); the campaign table's "Wall %" episodes-kind arm has a **positional fallback** (`furthest_episode_number >= last free position`, via `loadLastFreePositions` — the `signup_wall_at` stamp is member-tier-only and never fires on member-less shows like post-retier thunder-lady); the per-show episode funnel renders **tier-adaptively** (member stages hidden when `memberCount===0`, wall stage relabeled to the subscription paywall); `/welcome` emits `welcome_signin_succeeded/failed` + `welcome_fallback_shown(reason)`. The 7 saved PostHog funnels were redefined same day (no `/subscribe` step; conversion = `trial_play_started → checkout_started → subscribe_succeeded`) — see docs/posthog-funnel.md.
- **Funnel analytics (PostHog)**: consent-gated PostHog EU Cloud for funnel measurement (where visitors drop, which campaigns convert). `components/site/posthog-provider.tsx` dynamically imports `posthog-js` only after `cookie_consent.marketing === true` (same pattern as the Meta Pixel); on withdrawal, `opt_out_capturing()` + `reset()`. Autocapture OFF; curated named events (`lib/posthog-events.ts`): `$pageview` (fired manually on every route change — App Router doesn't trigger posthog-js's default), `show_viewed`, `trial_play_started`, `paywall_shown`, `signup_cta_clicked`, `signup_completed`, `checkout_started`. Server-side `subscribe_succeeded` fires from the Stripe webhook via `posthog-node` `captureImmediate` (`lib/posthog-server.ts`), under the same `metadataHasCapiConsent` guard as CAPI. Ingestion reverse-proxied through `/ingest` (Next.js rewrite) to bypass ad blockers; `/ingest` excluded from the `proxy.ts` Clerk matcher. Session replay + heatmaps enabled, all inputs/text masked. UTM values are **normalized** to match the app: a `before_send` hook in `posthog.init` runs auto-captured `utm_campaign/utm_source/utm_medium` (and thus the derived `$initial_utm_*` person props) through the same `normalizeUtm` rule as `lib/utm.ts`; the saved "Ads funnel" breakdown insights use the matching HogQL `replaceRegexpAll(lower(trim(properties.utm_campaign)), '[^a-z0-9_-]', '')` (the hook is forward-only, the HogQL also fixes history). Live "Ads funnel" dashboard (EU project, id 714865): overall (`/watch` landing) + by-UTM-source + by-UTM-campaign + `/shows`-landing variant. Env: `NEXT_PUBLIC_POSTHOG_KEY` (public, build-time), `NEXT_PUBLIC_POSTHOG_HOST=/ingest`, `POSTHOG_HOST=https://eu.i.posthog.com`. All blank → PostHog fully off. See [docs/posthog-funnel.md](./docs/posthog-funnel.md) for the funnel recipe.
- **Google Analytics 4**: consent-gated site analytics, same pattern as the Meta Pixel — `components/site/google-analytics.tsx` injects `gtag.js` (loaded directly, **no npm SDK**, like `fbevents.js`) only after `cookie_consent.marketing === true`, sharing the layout's server-parsed `initialConsent` so an already-consented returning visitor is tracked on first paint. The tag can't be unloaded once injected, so on withdrawal it (1) flips GA's `ga-disable-<id>` kill-switch so gtag stops sending **all** hits incl. the otherwise-unstoppable cookieless Consent-Mode pings, (2) pushes a **Consent Mode v2** `gtag('consent','update', …'denied')`, and (3) stops emitting via `consentRef` — together the real equivalent of Meta's `fbq('consent','revoke')` (Consent Mode 'denied' alone only drops cookies, it keeps beaconing). `page_view` is sent on App-Router route changes (the inline `config` fires the first one; `trackedPathRef` avoids the double-count). Env: `NEXT_PUBLIC_GA_MEASUREMENT_ID` (GA4 `G-…`, public/build-time) — **blank → GA fully off** (loader renders `null`). Helpers in `lib/ga-events.ts` (`trackGA` / `onGAReady`, no-ops until loaded). Cookie policy (`/cookies`) lists `_ga`/`_ga_*` and names Google Ireland Ltd.
- **Cookie consent (geo-aware)**: opt-in is legally required only in the **EU/EEA/UK/CH** — there the banner shows and nothing marketing-related fires until "Accept all". **Everywhere else (the Americas, etc.) marketing consent defaults ON with no banner**: `proxy.ts` reads Vercel's `x-vercel-ip-country`, and for a non-required country with no prior choice it writes the `cookie_consent` cookie (`marketing:true`) itself AND forwards it on the request so the same render hides the banner + loads the pixel (`marketingConsentRequired()` in `lib/cookie-consent.ts`; unknown geo fails CLOSED → treated as required). An explicit choice (incl. opting out via the footer "Cookie preferences") always wins, so non-EU users keep an opt-out. This is why ad traffic landing straight on `/watch` is measurable in the Americas without a banner click. `components/site/cookie-banner.tsx` (mounted in root layout) renders a bottom bar when no `cookie_consent` cookie is present. Two equally-prominent buttons ("Accept all" / "Essential only") satisfy ICO/AEPD/CNIL guidance. The banner reads its initial state server-side (`cookies().get(CONSENT_COOKIE)`) so it doesn't flash for returning users. The SiteFooter has a "Cookie preferences" button that dispatches `COOKIE_PREFS_EVENT` to reopen the banner. `lib/cookie-consent.ts` exports the parse/serialize helpers and is universal (imported by both `proxy.ts` for the attribution gate and the client banner).
- **Catalog cache**: `lib/catalog.ts:getPublishedShows()` wraps the published-shows query in `unstable_cache` (tag `'catalog'`, 1h fallback TTL). Consumed by both `/` and `/sitemap.xml`. Admin server actions that mutate `shows.status` or `shows.deleted_at` call `revalidateTag('catalog', 'default')` (Next 16 changed the signature to require the second profile arg) so the catalog reflects publish/unpublish/soft-delete immediately. The page itself stays `force-dynamic` because the hero mints a fresh Mux JWT per request.
- **Legal pages**: `/terms`, `/privacy`, `/cookies` live in `app/(public)/` and are bilingual (EN default since 2026-07-04; ES via detection/switcher). Filled 2026-05-28 with the real sole-trader details (Matvei Dobrovolskii t/a Matio, England & Wales, no DPO). **Public contact is `contact@matio.tv`. The registered-office address (66 Paul Street, London EC2A 4NA) IS published on the legal pages, JSON-LD and email footers since 2026-08-16 — it's DEEP ORDINARY LTD's Companies-House address, public by definition. (The pre-Ltd rule «no street address on the site» protected the sole trader's home address and is retired.)** **Still marked DRAFT pending a counsel review** — the facts are in, the legal wording hasn't been lawyer-checked. ToS §6's EU 14-day right-of-withdrawal waiver is now live on Checkout (`consent_collection.terms_of_service: "required"` + `custom_text`), and the matching ToS/Privacy URLs are set in the Stripe account's Public Details. Privacy/terms say "business address" not "registered office" (sole trader has no Companies House registered office).

## What NOT to do

- Don't add new dependencies without asking. Lock the stack.
- Don't bypass Stripe webhooks (e.g., don't mark a user "subscribed" from the
  client after Checkout success — wait for the webhook).
- Don't add `paymentsEnabled()` branches to the webhook/mirror/claim path
  (`app/api/webhooks/*`, `lib/subscription-mirror.ts`, `lib/guest-checkout.ts`,
  `/welcome`) or to `ACCESS_GRANTING_STATUSES` / `hasActiveSubscription()` —
  those must always reflect REAL subscription state, in both modes. The flag
  belongs at access-gate call sites and payment SURFACES only.
- Don't delete `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` /
  `STRIPE_PRICE_MONTHLY` from Vercel while any live subscriber exists, even in
  free mode — the webhook mirror needs all three at runtime (an unknown price
  makes `planFromPriceId` warn-and-skip, silently freezing renewal/cancel
  mirroring), and the build guard no longer trips on them when payments are off.
- Don't issue playback tokens with TTL > 1 hour. (The rule is about PLAYBACK tokens, `aud: 'v'`. The reminder email's hero image uses a **thumbnail** token, `aud: 't'`, valid 90 days on purpose — mail-client proxies fetch it days later, and it cannot mint video. See `signMuxThumbnailToken`.)
- Don't store credit card details. Stripe handles all of that.
- Don't roll our own auth or password handling. Clerk owns that.
- Don't `db:push` against production — use `db:generate` + `db:migrate` so changes are tracked.
- Don't read `subscription.current_period_end` or `invoice.subscription` off the Stripe object root — both moved in 2024+ API. See [gotchas](./docs/gotchas.md#stripe-api-2024-moves).
- Don't put `asChild` on shadcn `Button` — there is no such prop. Use `buttonVariants()` on the Link instead.
- Don't `throw new Error` for typable validation in admin form server actions — production masks the message behind a digest, so the admin gets the generic error page with zero explanation (the 2026-07-16 slug incident). Return typed codes rendered inline by the form (`AdminFormState` in `app/admin/actions.ts`, `CreateLinkState` in `app/admin/links/actions.ts`); reserve throws for forged-post integrity guards a real UI flow can't reach.
- Don't drive critical-path UI state with CSS `:has()` (or Tailwind's `group-has-[*]:` variants) — iOS Safari < 15.4 silently no-ops the selector, leaving older iPhones with unselectable plans / invisible toggles. Use `peer-*:` (sibling combinator, Safari 3+) or React-controlled state. See [gotchas → cross-browser CSS](./docs/gotchas.md#cross-browser-css-ios-safari--154).
- Don't add a new `oklch()` color to `globals.css` without a hex/rgb fallback **declared first** (double-declaration pattern). Safari < 15.4 can't parse `oklch()` and drops the line entirely — without the fallback the whole dark theme collapses to default light on older iPhones.
- Don't pin UI to the bottom of the player / page without `pb-[max(env(safe-area-inset-bottom),...)]`. `viewport-fit=cover` is set via `viewport` export in `app/layout.tsx`, so the inset values are non-zero on notched iPhones — collisions with the home indicator are a 30-second fix when authored, an UX bug otherwise.

## Production context

- Vercel projects — TWO: **prod** `mad-matttts-projects/matio` (id `prj_bT5c7cdVTRzAIPX7uLGYjQLBF5EI`, `matio.tv`, follows the `production` branch) and **staging** `mad-matttts-projects/matio-staging` (`matio-staging.vercel.app`, follows `main`; whole origin behind Basic Auth via `lib/staging-lock.ts` + `STAGING_LOCK_PASSWORD`, `/api/healthz` open and answering `"environment":"staging"`)
- Prod URL: `https://matio.tv` (apex is canonical; `www.matio.tv` 307-redirects to apex; legacy Vercel alias `matio-ten.vercel.app` still resolves)
- Functions pinned to **`fra1`** (Frankfurt) via `vercel.json` so they co-locate with Neon's `aws-eu-central-1`. Without this every DB query was a trans-atlantic round-trip; warm TTFB dropped from ~1s to ~300ms after pinning.
- Neon project: `little-base-06482402` (org `Matvei`, aws-eu-central-1, Postgres 18, pooled endpoint)
- **Business entity**: UK **limited company** — **DEEP ORDINARY LTD**, company
  no. 17381666, incorporated 2026-08-04, registered office 66 Paul Street,
  London EC2A 4NA (a registered-office service address, safe to publish — it
  IS published on /terms, /privacy, in the Organization JSON-LD and the
  reminder-email footer since 2026-08-16). Replaces the sole-trader identity
  (Matvei Dobrovolskii t/a Matio) everywhere user-facing. Not VAT-registered
  (yet); ICO data-protection fee + EU digital-VAT (OSS) remain open admin
  tasks — now for the Ltd. Vendor accounts (Stripe legal entity, Clerk,
  domain registrant) still name the old identity — migrating them is owner
  ops work, tracked on the board.
- **Stripe is in LIVE mode** (`sk_live_…`) as of 2026-05-27. Product (`prod_UatJzLBiTYS8pS` "Matio Membership"), recurring price (`price_1TbhWlCGXbzphNyzoAGW3wXM` — $38/mo USD, `tax_behavior=exclusive`). **$1/3-day intro trial — configured in live since 2026-06-11**: the one-time "Matio — 3-day trial" product+price exists and `STRIPE_PRICE_TRIAL_FEE` is set in Vercel Production; the whole paid surface is dormant with `PAYMENTS_ENABLED` unset. Removing the env var + redeploying reverts to the plain $38/mo sub (no trial). A `next.config.ts` guard **fails the production build** if `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_TRIAL_FEE` are unset (scoped to `VERCEL_ENV==="production"`), so a premature push fails the build and the previous deployment keeps serving — it never ships broken checkout. Webhook endpoint `we_1Tbdh2CGXbzphNyzsw1zWSZf` at `https://matio.tv/api/webhooks/stripe` (apex, not www — Stripe doesn't follow redirects). Stripe Tax `status=active`, head office GB, but **collects $0 until a tax registration is added** (none yet) — checkout already collects the billing address so tax will switch on automatically once registered. ToS + Privacy URLs set in Public Details (powers the Checkout withdrawal-waiver checkbox). Customer Portal default config has `subscription_cancel.enabled=true, mode=at_period_end`. **Full purchase verified end-to-end 2026-05-28** (checkout → 3 webhooks 200 → active row → playback-token 200 → cancel).
- **Clerk is in production instance** with custom domain (`clerk.matio.tv`, `accounts.matio.tv`). DNS CNAMEs are all live (`accounts`, `clerk`, `clk._domainkey`, `clk2._domainkey`, `clkmail`). Webhook URL: `https://matio.tv/api/webhooks/clerk` (apex — needs verifying / updating from www in Clerk dashboard if not yet on apex).
- **Mux**: webhook URL also should be on apex — `https://matio.tv/api/webhooks/mux`. Add referrer restriction on the signing key (`matio.tv`) in Mux dashboard for defence in depth on the hero preview JWT.
- **Mux: paid plan, and the account is SHARED with another project of the
  owner's.** The free-plan 10-asset cap is history — as of 2026-08-31 the
  account holds 42 `ready` assets. Some belong to the owner's second project
  (**courseplayer** — its direct uploads carry `cors_origin:
  http://courseplayer.…sslip.io`), so: (1) storage/encoding billing is shared,
  and unfamiliar assets in the dashboard are **not matio garbage — do not
  delete them**; (2) matio's own assets are the ones whose `passthrough`
  matches an `episodes.id` — any inventory/cleanup script must join against
  the DB, never sweep "everything in the account"; (3) the old symptom
  "`uploads.create` 400s on the free-plan cap" no longer reproduces — a
  failing upload has some other cause (see
  [gotchas → Mux](./docs/gotchas.md#mux-sdk-14)). Still open: no playback
  referrer restriction is configured (`/video/v1/playback-restrictions` → `[]`).
- **Vercel Blob**: store `matio-blob` in **Frankfurt** (co-located with fra1 functions; chosen over iad1), **Public** access (required — `next/image` fetches by bare URL), connected to the project so `BLOB_READ_WRITE_TOKEN` is set on all environments. Store host `waoyoctqyyvecbhm.public.blob.vercel-storage.com` (matched by the `*.public.blob.vercel-storage.com` remotePattern). Round-trip (put → public fetch → del) verified 2026-06-03.
- **Pay-first checkout (`PAY_FIRST_CHECKOUT`): the var IS present in Vercel Production** (set 2026-06-10 under paid mode; value Encrypted — re-read it in the Vercel dashboard before re-enabling payments, don't assume it's off). The whole item is dormant today: payments are off and all three checkout actions guard-return first. Prerequisites when payments return: (1) ~~Clerk email-code sign-in~~ **DONE — enabled in prod** (verified during the 2026-06-16 webview incident); (2) activate Stripe's **no-code Customer Portal login page** (`billing.stripe.com/p/login/…`, email + OTP) as the account-less cancel safety net; (3) ~~Vercel WAF rate-limit~~ **DONE in-app (2026-06-13)** — `startGuestCheckout` is now rate-limited per (IP hash, clock-hour) via the `guest_checkout_attempts` table (`lib/checkout-rate-limit.ts`, default 30/hr, env `GUEST_CHECKOUT_RATELIMIT_PER_HOUR`), checked right after the auth guard, before any Stripe session / Meta+PostHog work; over-limit degrades into the auth flow. Done in code rather than a WAF rule because that server action shares the `POST /watch/*` endpoint with `saveWatchProgress` — a path-level rule would throttle progress saves. Funnel note: with the flag on, Meta `Lead`/`CompleteRegistration` + PostHog `signup_completed` fire AFTER `Purchase` (on /welcome), so don't optimize ad sets on `Lead` and annotate PostHog (trial-metrics grain era #4 for the funnel reorder).
- **FREE PIVOT (2026-07-04): `PAYMENTS_ENABLED` is deliberately UNSET in prod → the site is fully free** (see the "Free pivot" business rule for exact semantics). Merging the pivot code to main flipped prod to free on deploy — no env change needed (unset = free is the designed default). Open ops items that code can't do: (1) ~~cancel the existing live Stripe subscriptions~~ **DONE**: as of 2026-08-31 `subscriptions` holds zero access-granting rows (7 historical). The rule "don't delete Stripe env vars while a live subscriber exists" now stands for a different reason — the build guard and any re-enable need them; (2) annotate PostHog + the admin dashboard mentally for grain era #5 (paid-funnel events flatline while free); (3) when/if re-enabling, follow the re-enable checklist in the business rule (env BEFORE redeploy, Stripe prices still present, legacy-show trial-row caveat).
- **Signup gate is LIVE in prod since 2026-07-16**: `REQUIRE_SIGNUP=1` is set
  in Vercel Production (payments off ⇒ `signupRequired()` true). One-command
  check: `curl -s https://matio.tv/api/v1/config | jq .signupGate` →
  `{"mode":"after_episodes","episodes":1}` (the app's positional gate; the web
  wall is total), corroborated by `"isAccessibleForFree":false` in show-page
  JSON-LD. Reverting = remove the var + redeploy (runtime read, no build
  guard). PostHog is annotated (grain era #6): the anonymous organic funnel
  stopped accruing on the flip — `trial_sessions` is effectively frozen (last
  row 2026-08-20); the live ledgers are `visitors` / `visitor_days` /
  `watch_days` / `watch_segments`. The analytics-v2 redesign retired the
  PostHog signup-funnel panel — but `POSTHOG_PERSONAL_API_KEY` /
  `POSTHOG_PROJECT_ID` **must NOT be removed**: they power the live
  `/admin/analytics/sessions` event feed (in prod since 2026-07-20). Deploy
  order note for migration 0023 is history (applied 2026-07-18).
- **Sentry — LIVE in prod since v0.5.0 (2026-08-16)**: org `deep-ordinary`
  (region EU), project `javascript-nextjs`. `NEXT_PUBLIC_SENTRY_DSN` is baked
  at build time. The staging bench had a DSN verified with a live event during
  stage 07, but carries **no `NEXT_PUBLIC_APP_ENV=staging`** — any browser
  event from the bench reports `environment: production`; the reliable
  discriminator is `request.url` (the #126 triage lesson, also in
  docs/registry.md). Source maps are off (`SENTRY_ORG/PROJECT/AUTH_TOKEN`
  unset) — prod stack traces name minified chunks.
- **Resend email — LIVE.** Domain `matio.tv` verified (region eu-west-1), DNS
  in place: DKIM at `resend._domainkey`, `send.matio.tv` MX →
  `feedback-smtp.eu-west-1.amazonses.com` + SPF `include:amazonses.com`, and
  `_dmarc` = `v=DMARC1; p=none;` (root SPF `spf.privateemail.com` and Clerk's
  `clk*` records untouched). `RESEND_API_KEY` is set in Vercel Production
  (since mid-July 2026). Real send history so far: exactly ONE reminder
  dispatched (July, quedate-conmigo); the scarlet-oath queue (~30 rows) awaits
  the owner's button — the audited dispatch mechanics are in the "Episode
  reminder emails" rule. Sender `Matio <updates@matio.tv>`, replies to
  contact@. Free tier: 100 emails/day, 3,000/mo. Dropping `RESEND_API_KEY`
  degrades gracefully by design. Open tail: DMARC is `p=none` with no `rua=`
  — no delivery reports.
- GitHub auto-deploy is wired to the TWO-STEP model (live since 2026-08-12):
  merging to `main` deploys **staging** (`matio-staging.vercel.app`, Basic Auth;
  see `/devops`); **production deploys only from a published GitHub Release**,
  through `.github/workflows/deploy-production.yml`, after the owner approves
  the `release-production` GitHub Environment. The prod Vercel project follows
  the `production` branch, which no automation pushes — it is the break-glass
  lever: `git push --force origin <sha>:production` deploys production even
  with Actions down. Emergency deploy = `workflow_dispatch` of
  deploy-production (any ref), or that push. CLI deploys (`vercel --prod`)
  from this machine get stuck in BLOCKED state. `git push` remains the source
  backup either way.
