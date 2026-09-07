# 0001. Branching video: a branch is an episode row, the graph is `episode_choices`

Date: 2026-09-06
Status: Accepted

## Context

The owner is launching interactive episodes (Bandersnatch-style): the video
plays, at a fixed point the viewer picks one of up to three options, and the
chosen continuation plays seamlessly. Decisions fixed in the 2026-08-31
brainstorm (issue #143): a fork always sits on a FILE boundary (the master is
cut at the fork point — no mid-file timecodes); v1 branches converge back into
a shared episode, but the schema must also allow multiple endings; ≤3 options
per fork with a per-fork timer; option labels and the prompt are UI copy in
es/en, not baked into the video; horizontal orientation only in v1; the mobile
app ignores branching shows.

Three designs were compared:

1. **A dedicated `branches` table** with its own Mux linkage and duration.
   Every piece of the upload pipeline (passthrough = `episodes.id` in
   `createMuxUpload`, the webhook resolver, the 24h upload timeout of #130,
   the retry codes of #131, the ready-poller of #136), `/api/playback-token`,
   the progress actions and the per-episode tier system would need a second
   implementation — or a union type through all of them.
2. **Timecoded forks inside one episode file** (`fork_at_seconds` +
   `jump_to_seconds`). Rejected by the owner: seeking inside one long asset
   is not seamless on every device, and the editor already cuts the master
   at the fork anyway.
3. **A branch is an ordinary `episodes` row** marked with
   `branch_of_episode_id`, plus a small edge table `episode_choices`.

Measured facts that decided it: analytics v2 divides by
`episodes.duration_seconds` in at least six places — a branch-as-episode has a
real duration and needs no `COALESCE`; `watch_progress (user_id, episode_id)`
already records which branch a viewer took, so resume and "path memory" come
for free; `unique(episodes_season_id_number_unique)` on `(season_id, number)`
stays untouched with a numbering convention (branches from 900).

## Decision

- A **branch is an `episodes` row** with `branch_of_episode_id NOT NULL`
  (FK to `episodes.id`, `ON DELETE SET NULL` — the branch survives as a
  regular episode when its parent goes; its video is real content). NOT NULL
  means "reachable only through a choice; absent from every public list":
  the show page and its JSON-LD, `getOrderedReadyEpisodeIds` (funnel
  positions, the app's positional signup gate), the watch page's episode list,
  the home hero's "first episode", and — wholesale, by show — the mobile
  `/api/v1` catalog.
- **`episode_choices`** holds the edges: `(from_episode_id, to_episode_id,
  position, label_en, label_es, is_default)`, unique on `(from, position)`,
  partial unique on `(from) WHERE is_default`, `to` protected by
  `ON DELETE RESTRICT`, `from` cascading.
- **The meaning of an edge set is its size** (`lib/branching.ts:
  resolveNextStep`): ≥2 rows = a fork (the parent's `fork_prompt_en/es` is
  shown; targets must be branches of that parent); exactly 1 row = a silent
  auto-transition (how a branch reconverges; the target may be any ready
  episode of the show); 0 rows on a branch = an ending; 0 rows on a regular
  episode = today's linear `episodes[idx + 1]`. No `kind` column: one schema
  covers v1 reconvergence, multiple endings and nested forks.
- **Fork copy is viewer copy** and therefore es/en (site locales) on the
  rows themselves — not in `lib/i18n/dictionaries.ts`, and not ru/en.
- **Validation is typed, in two places**: the admin form (`validateForkDraft`)
  refuses what an owner can get wrong (timer out of 3–30, a prompt with fewer
  than two options, a fork option that is not a branch of its parent, a
  not-ready target, duplicates, a missing locale), and the publish guard
  (`validateBranchGraph`) walks the choice graph from every listed ready
  episode and refuses a show with an unfinished fork, a not-ready target, a
  fork option that stopped being a branch, or a cycle. Both are pure and
  table-tested; the actions only load rows and write the result.
- **The player is a separate PR** (#144): the overlay, the timer and the
  transition build on `resolveNextStep`. Until it ships, branches are hidden
  everywhere and simply do not play.

## Consequences

- Easier: the whole upload/transcode/token/progress/tier pipeline works on
  branches with zero changes; analytics needs no special-casing; resume into a
  branch is a normal `watch_progress` row.
- Harder / accepted: the viewer-facing episode number of a branch is not its
  `number` (900+) — PR 2 derives it from the filtered list; a branch's
  `(season, number)` uniqueness is a convention shown in the admin panel, not
  a constraint; `deleteEpisode` on a choice target is refused by the FK — the
  episode page hides the button and explains why.
- Deliberately deferred (rows in `docs/registry.md`): re-choosing on a seek
  back, choice statistics in the admin panel, branching shows in the mobile
  app (the app's `continue` rail can still surface such a show, whose
  `/v1/shows/:slug` then 404s), and the paid-mode trial mint rate limit
  (10 per (IP, show) per hour — a branching show multiplies token mints).
- Revisit if: a fork ever needs to sit mid-file (then design 2's timecodes
  become columns on `episode_choices`, not a rewrite), or if branches need
  their own tier — today a branch inherits nothing; it has its own `access`
  like any episode, and the admin sets it.

## Addendum 2026-09-07 — the player (#144)

Three decisions with lasting consequences were taken while building the
viewer half on top of this graph; they are recorded here rather than only in
code comments because each rules out a plausible alternative.

- **The fork is a transition, not a second player state.** The prompt's
  countdown is the parent's own remaining time (`duration − currentTime`),
  and the branch installs through the existing gapless auto-advance path at
  `ended` — the same `<video>` element, playbackId and token swapped
  together, no remount. Rejected: a separate timer that pauses the video at
  zero (a pause loses WebKit's per-element autoplay blessing; on iOS the
  resume then needs a fresh gesture — the owner's "never pause" decision),
  and a keyed remount of the element per branch (same loss, on every fork).
  Consequence: the viewer can change the pick until the very end, a pause
  pauses the countdown, and the seam is exactly as good as auto-advance
  between two linear episodes — which the content rules (a choice tail of
  8–10s, a scene cut at the fork, one export pass for all branches) have to
  make invisible.
- **Branches stay in the player's `episodes` array; lists are derived.**
  The watch page no longer filters `branch_of_episode_id IS NULL`; instead
  the player computes the listed run (`listedEpisodes`), positions
  (`listedPosition`, 0 for a branch — the server's convention) and the
  printed number (`displayNumber` — the listed ancestor's position, so a
  branch reads as the episode it continues). Rejected: filtering in the
  page and carrying a side-channel of branches — `episodes.find(id) ??
  episodes[0]` over a filtered array silently restarts the show when a
  branch id arrives by `?ep=` (the rail's resume tile, the post-signup
  redirect).
- **Bandwidth over readiness for the options nobody picked.** Every
  candidate's token is prefetched 45s out, but only the option that will
  play if nothing is tapped gets a full hidden warm-up (`preload="auto"`);
  the others mount at `preload="metadata"` while the prompt is open and are
  promoted in place on a pick. Decided by arithmetic (three 30s buffers in a
  ≤30s window exceed a Fast-3G link), not by the device measurement the
  spec asked for — no branching show exists on a bench yet. The registry
  row says how to close it.

The prompt's look is Lab-first variant A of five (`Lab/Fork choice`); the
owner has not yet picked live — a registry row, not an ADR decision.
