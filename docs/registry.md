# Registry of loose ends

Every stub, placeholder, hard-coded shortcut, and deliberately deferred piece of
work gets a row here **in the same PR that introduces it**. The point is that
"we'll do it later" survives outside anyone's memory: the registry is read
before a release (see the `/release` skill) and during review of every PR.

A row leaves the table only when the thing is actually done — or when a real
issue on the board takes over tracking it (put the issue number in "When to
close").

| What | What it blocks | When to close |
|---|---|---|
| No staging environment: `main` still deploys straight to matio.tv, and Vercel previews have no `DATABASE_URL`. The repository half is in place — `.github/workflows/deploy-production.yml` (release-gated production deploy) and a seed that can make one demo show playable — but it is dormant until the vendor-panel half exists: second Vercel project, Neon branch, staging Mux signing key, `VERCEL_*` secrets, prod project moved to the `production` branch | Migrations and webhooks can only be exercised in production | Issue #40 — closes when the bench actually runs (`/api/healthz` on staging answers `environment` ≠ `production` and a migration has gone staging-first at least once) |
| Backups exist but have never run against the live database: `db-backup` / `db-restore-check` ship here, and the loop was rehearsed end-to-end only against a local Postgres 18 with synthetic data. The Neon `production` branch is also still unprotected (a vendor-panel switch) | Until both workflows have gone green once from `main`, the restore probe proves the *scripts*, not this database's dumps | When `db-backup` and `db-restore-check` have each run green from `main` (the probe logs «OK: restore-проба пройдена …») and the Neon branch is marked protected |
| Only Postgres is backed up. Show artwork in Vercel Blob and video in Mux are not: the database holds links, the files live at the vendors | Losing the Blob store = a catalog without posters; losing the Mux account = a catalog without video. Both survive a database restore untouched | When the artwork bucket gets its own copy (or the owner accepts the risk in writing) |
| `a11y` addon runs in `todo` mode — violations are visible in the Lab but do not fail CI | Nothing today; it is a gate that is deliberately off | After the existing components are cleaned up (see the design-system debt issue) |
| Mobile app (`mobile/`) is not versioned by release-please — it lives outside `main` | Product and app versions will diverge once the app ships | When `feat/mobile-app` merges: add `mobile/app.json` to `extra-files` |
