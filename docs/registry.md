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
| No staging environment: `main` deploys straight to matio.tv, and Vercel previews have no `DATABASE_URL` | Migrations and webhooks can only be exercised in production | Before the next migration that is not purely additive — see the tracking issue on the board |
| No database backups of our own; we rely on Neon's PITR, which has never been restore-tested | An untested restore is a hope, not a backup | Stage 06 of `docs/mega-process/` |
| `a11y` addon runs in `todo` mode — violations are visible in the Lab but do not fail CI | Nothing today; it is a gate that is deliberately off | After the existing components are cleaned up (see the design-system debt issue) |
| Mobile app (`mobile/`) is not versioned by release-please — it lives outside `main` | Product and app versions will diverge once the app ships | When `feat/mobile-app` merges: add `mobile/app.json` to `extra-files` |
