# Per-episode access control — design

**Date:** 2026-06-04
**Status:** Approved design, pre-implementation
**Owner:** Matvei
**Supersedes:** the positional half of `2026-06-03-episode-gated-trial-design.md` (live on matio.tv since 2026-06-03)

## Goal

Let the admin choose, per episode, who can watch it:

- **Free** — anyone, anonymous included (trial users), full episode
- **Members** — any signed-in user (sign-up wall for anonymous viewers)
- **Subscribers** — active subscription required

This replaces the show-level positional counts (`shows.free_episodes` /
`shows.member_episodes`) shipped 2026-06-03. Launch is behavior-identical:
One look's 10/2 is backfilled to per-episode values; nothing changes for
viewers until the admin edits a tier.

## Decisions made (with the user)

1. **Replace, not layer** — per-episode `access` is the single source of
   truth; the show-level count fields disappear. Non-contiguous patterns
   become possible (e.g. a mid-season free teaser).
2. **Default `'subscriber'`** for new episodes — forgetting to configure an
   upload never leaks free content.
3. **Admin control in both places** — a compact three-way select on each
   episode row of the season page (bulk workflow) and the same field on the
   episode edit form.
4. **Legacy 60s preview is derived** — a show with ≥1 ready non-subscriber
   episode uses tier gating (no 60s clock); a show whose ready episodes are
   ALL subscriber-only keeps the legacy 60-second preview. The three
   all-subscriber shows behave exactly as today with zero reconfiguration.
5. **Two-phase migration** — 0014 adds + backfills (additive; old deployed
   code unaffected); the old show columns are dropped by 0015 only after the
   new code is deployed and verified. Zero downtime.

## Data model

### Migration 0014 (apply before deploy)

```sql
CREATE TYPE "episode_access" AS ENUM ('free', 'member', 'subscriber');
ALTER TABLE "episodes" ADD COLUMN "access" "episode_access" DEFAULT 'subscriber' NOT NULL;
```

plus a hand-appended backfill in the same migration file (raw SQL is allowed
in migrations) that reproduces today's positional semantics exactly:

```sql
WITH ranked AS (
  SELECT e.id,
         row_number() OVER (PARTITION BY se.show_id ORDER BY se.number, e.number) AS pos,
         s.free_episodes, s.member_episodes
  FROM episodes e
  JOIN seasons se ON e.season_id = se.id
  JOIN shows s ON se.show_id = s.id
  WHERE e.status = 'ready' AND s.free_episodes + s.member_episodes > 0
)
UPDATE episodes SET access = CASE
  WHEN ranked.pos <= ranked.free_episodes THEN 'free'
  WHEN ranked.pos <= ranked.free_episodes + ranked.member_episodes THEN 'member'
  ELSE 'subscriber'
END::episode_access
FROM ranked WHERE episodes.id = ranked.id;
```

(Ranking over READY episodes ordered by (season number, episode number) —
identical to `getOrderedReadyEpisodeIds`. Non-ready episodes keep the
default `'subscriber'`.)

Drizzle schema: `episodeAccess` pgEnum + `access` column on `episodes`
(default `"subscriber"`).

### Migration 0015 (generate + apply only AFTER the deploy is READY)

Drops `shows.free_episodes` and `shows.member_episodes` (schema columns
removed in phase 2; drizzle-kit generates the DROPs). Until then the columns
sit in the DB unread by the new code and read only by the old code during
the deploy window.

## Access resolution — `lib/episode-access.ts` rework

- `EpisodeTier` stays `"free" | "member" | "subscriber"`; an episode's tier
  IS its `access` value. `tierForPosition` and `getShowGating` are deleted
  (no callers remain after this change).
- New `showHasTierGating(showId): Promise<boolean>` — one indexed `EXISTS`
  over ready episodes with `access != 'subscriber'`, joined via seasons.
- `getOrderedReadyEpisodeIds` stays — positions still power the funnel's
  depth metric (`trial_sessions.furthest_episode_number`) and analytics.

### Token route (`/api/playback-token`) — gets simpler AND faster

Episode lookup adds `access: episodes.access` (drops the two show columns
from the select). After the subscriber branch:

- `access = 'free'` → 1h token `mode:"free"` + best-effort `kind='episodes'`
  tracking row (unchanged contract: rate limit degrades tracking, never
  playback). A free episode implies a gated show — no show-level query.
- `access = 'member'` → signed-in: 1h token `mode:"member"`; anonymous:
  403 `reason:"signup_required"` + best-effort wall stamp. Same implication —
  no show-level query.
- `access = 'subscriber'` → `showHasTierGating(showId)`: true → 403
  `reason:"subscribe_required"`; false → fall through to the LEGACY 60s
  trial branch, byte-for-byte untouched.

Net: the hot paths (free/member/subscriber-on-legacy-shows) lose the
ordered-ids query the positional system needed; only subscriber-tier
episodes on gated shows pay one `EXISTS`.

### Watch page

- `tier: e.access` straight into `PlayerEpisode` (drop `positionById` /
  `tierForPosition`); `gated = playable.some(e => e.access !== "subscriber")`
  replaces `getShowGating(show).gated`. Mode selection, member branch
  (linking + signup pixel), anonymous resume, and the legacy branch are
  otherwise unchanged.

### Client (player / walls / overlay)

**Zero changes.** The tier values and `isEpisodeLocked` contract are
identical; `firstMemberEpisode`, `memberCount`, lock badges, wall routing
all keep working. (`memberCount` = episodes with tier `member` — already
derived from the episode list, not from show config.)

### Progress writes (`app/watch/actions.ts`)

- `saveWatchProgress`: the non-subscriber gate becomes
  `ep.access !== 'subscriber'` (lookup selects `access` instead of the two
  show counts; the ordered-ids/position computation goes away).
- `saveTrialPosition`: branch on the episode's access —
  `'free'` → the gated write (lastPositionSeconds + lastEpisodeId + depth;
  depth still records the 1-based POSITION via `getOrderedReadyEpisodeIds`,
  the funnel metric is positional); `'member'` → no write (anonymous viewers
  can never legitimately play one — forged calls must not pollute the row);
  `'subscriber'` → the plain legacy `lastPositionSeconds` write ONLY when
  the show is not tier-gated (`showHasTierGating` false), else no write.
- `markSignupWallShown`: unchanged.

## Admin

- **New server action** `updateEpisodeAccess(episodeId, seasonId, showId, access)`:
  validates `access` against the enum values, verifies the (episode, season,
  show) chain exactly like `deleteEpisode`, updates, revalidates the season
  page (and the episode edit page path).
- **Season page**: each episode row gains a compact three-way access select
  in the action cluster (Free / Members / Subscribers), auto-submitting on
  change — a small client component following the existing `StatusSelect`
  pattern. Server component passes current value.
- **Episode edit page**: the same select as a form field; `updateEpisode`
  gains the `access` field (validated against the enum).
- **Show form**: the "Free preview" panel and `freeEpisodes`/`memberEpisodes`
  form values are removed; `gatingCount` helper deleted; `createShow` /
  `updateShow` stop writing the old columns (phase 1) — required before 0015
  can drop them.

## Analytics — `loadEpisodeFunnels` set definitions

Same 6-stage funnel and card; sets are access-derived:

- gated shows = shows with ≥1 ready `access != 'subscriber'` episode
  (replaces `free_episodes + member_episodes > 0`)
- free set = ready `access='free'` episodes (ordered); `freeCount` = its size
- member set = ready `access='member'` episodes (ordered, with display fields)
- wall-hit threshold = POSITION of the LAST free episode in the ready
  ordering (`lastFreePos`); `wallHit` = `signup_wall_at IS NOT NULL OR
  furthest_episode_number >= lastFreePos`; same for the `signedUp` FILTER
- depth bars = positions 1…`lastFreePos`, cumulative `furthest >= N`
  (honest under non-contiguous free sets: "reached at least position N")
- free set empty (member-only gated show) → no depth bars, `started`
  counts whatever `kind='episodes'` rows exist (anonymous viewers can't
  create them on such a show, so ~0) — card still renders without errors

## Docs

CLAUDE.md: rewrite the **Episode-gated free tier** bullet for the
per-episode model (admin season page + episode form; default subscriber;
derived 60s-trial rule; two-phase migration note), and fix the stale
**Production context** claim that GitHub auto-deploy is not wired (it is —
`git push origin main` deploys; CLI deploys get BLOCKED).

## Rollout (zero-downtime two-phase)

1. Apply 0014 to the shared DB (additive + backfill — deployed code
   unaffected, new column inert to it).
2. Verify backfill (one-look: 10 free / 2 member / others subscriber).
3. Push → GitHub auto-deploy → READY.
4. Prod smoke: free 200 / member 403 signup_required / legacy 60s / admin
   select renders.
5. Remove the two columns from the Drizzle schema, generate + apply 0015
   (DROP COLUMN ×2). New code never reads them; old code is gone.

Rollback before step 5 = redeploy the previous build (old columns still
present and still correctly configured). After step 5, rollback requires
re-adding the columns (acceptable; the access column is then authoritative
anyway).

## Edge cases

- **New upload**: defaults to `'subscriber'` — invisible to free/member
  tiers until the admin opens it; on an all-subscriber show it simply joins
  the 60s-preview pool (status quo).
- **Setting the only free episode back to subscriber**: show reverts to
  legacy 60s-trial mode automatically (derived rule). Existing
  `kind='episodes'` rows stay (analytics history), playback follows the
  60s rules again.
- **Non-contiguous free sets**: enforcement is per-episode so it just works;
  the funnel's positional depth remains well-defined (see analytics).
- **Episode reprocessing / un-ready**: `access` persists on the row;
  un-ready episodes never get tokens regardless of tier (existing gate).
- **Subscribers**: untouched on every path (first branch everywhere).

## Out of scope

- Bulk tier actions ("set eps 1–10 free" in one click), per-season defaults,
  scheduled tier changes (e.g. auto-free after a date), any client-side UI
  changes, PostHog dashboard edits.
