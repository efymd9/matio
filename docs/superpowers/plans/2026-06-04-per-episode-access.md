# Per-Episode Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each episode gets an admin-set `access` tier — Free (anyone) / Members (signed-in) / Subscribers — replacing the show-level positional counts, with a zero-downtime two-phase migration.

**Architecture:** New `episode_access` enum column on `episodes` (default `'subscriber'`), backfilled from the live positional config inside migration 0014. Enforcement reads the episode's own `access` (token route gets faster — no ordered-list query on hot paths); "legacy 60s-trial show" is derived (no ready non-subscriber episode). The client layer (player/walls/overlay) is untouched. The old `shows.free_episodes`/`member_episodes` columns are dropped by migration 0015 only after the new code is deployed.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle 0.45 + postgres-js (Neon), shadcn Select, Tailwind v4.

**Verification model:** No unit-test framework (deliberate — do not add one). Every task verifies with `pnpm typecheck` + `pnpm lint`; Task 11 runs build + a dev-server smoke; deploy and the column-drop are explicit phase gates at the end. Commit after every task.

**Spec:** `docs/superpowers/specs/2026-06-04-per-episode-access-design.md` (in this worktree).

**Working directory:** `/Users/matveidobrovolskii/dev/matio/.claude/worktrees/per-episode-access` (branch `worktree-per-episode-access`, based on main @ ae1ee54). All paths below are relative to it.

---

## File structure

| File | Change |
|---|---|
| `db/schema/episodes.ts` | + `episodeAccess` pgEnum, `access` column, `EpisodeAccess` type |
| `drizzle/0014_episode_access.sql` | generated DDL + hand-appended backfill |
| `lib/episode-access.ts` | + `showHasTierGating()`; (Task 9 deletes `getShowGating`/`tierForPosition`) |
| `app/api/playback-token/route.ts` | gated branch keyed on `row.access` |
| `app/watch/actions.ts` | access-based gates in both progress writes |
| `app/watch/[showSlug]/page.tsx` | `tier: e.access`; `gated` derived from episode list |
| `components/admin/access-select.tsx` | **new** — instant-apply + form-embedded selects |
| `app/admin/actions.ts` | + `updateEpisodeAccess`; `updateEpisode` gains `access`; count parsing removed |
| `app/admin/shows/[id]/seasons/[seasonId]/page.tsx` | per-row access select |
| `app/admin/shows/[id]/seasons/[seasonId]/episodes/[episodeId]/page.tsx` | access field in the edit form |
| `components/admin/show-form.tsx` | "Free preview" panel removed |
| `app/admin/shows/[id]/page.tsx` | count defaults removed |
| `lib/admin-analytics.ts` | `loadEpisodeFunnels` sets derived from `access` |
| `CLAUDE.md` | business-rule rewrite + stale auto-deploy note fixed |
| `db/schema/shows.ts` + `drizzle/0015_*.sql` | **phase 2 only** — columns dropped post-deploy |

**Tier vocabulary is unchanged end-to-end:** `"free" | "member" | "subscriber"` — the client's `EpisodeTier`, the DB enum, and the admin labels (Free / Members / Subscribers) all map 1:1. No client file changes in this plan.

---

### Task 1: Schema + migration 0014 (add + backfill, apply)

**Files:**
- Modify: `db/schema/episodes.ts`
- Create (generated, then edited): `drizzle/0014_episode_access.sql`

- [ ] **Step 1.1: Add the enum + column to `db/schema/episodes.ts`**

After the existing `episodeStatus` pgEnum, add:

```ts
// Who can watch this episode. Replaces the show-level positional counts
// (free_episodes/member_episodes — dropped post-deploy by migration 0015):
//   free       — anyone, anonymous included, full episode
//   member     — any signed-in user (sign-up wall for anonymous)
//   subscriber — active subscription required (the default: new uploads
//                are paid until the admin deliberately opens them)
// A show with ≥1 ready non-subscriber episode is "tier-gated"; a show whose
// ready episodes are ALL subscriber-only keeps the legacy 60s preview.
export const episodeAccess = pgEnum("episode_access", [
  "free",
  "member",
  "subscriber",
]);
```

In the `episodes` table columns, after `status`, add:

```ts
    access: episodeAccess("access").notNull().default("subscriber"),
```

After the existing type exports at the bottom, add:

```ts
export type EpisodeAccess = (typeof episodeAccess.enumValues)[number];
```

- [ ] **Step 1.2: Generate the migration**

Run: `pnpm db:generate --name episode_access`
Expected: `drizzle/0014_episode_access.sql` containing exactly `CREATE TYPE "public"."episode_access" AS ENUM('free', 'member', 'subscriber');` and `ALTER TABLE "episodes" ADD COLUMN "access" "episode_access" DEFAULT 'subscriber' NOT NULL;` — nothing else. If other statements appear, STOP and report (schema drift).

- [ ] **Step 1.3: Append the backfill to the SAME migration file**

Append to `drizzle/0014_episode_access.sql` (statement-breakpoint comment included — drizzle splits on it):

```sql
--> statement-breakpoint
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

This reproduces the live positional semantics exactly (ranked over READY episodes by season number then episode number — identical ordering to `getOrderedReadyEpisodeIds`). Editing a generated migration BEFORE applying it is fine; raw SQL is allowed in migrations.

- [ ] **Step 1.4: Apply + verify the backfill**

Run: `pnpm db:migrate`
Expected: exit 0. Then verify with a tiny throwaway script (DELETE it afterwards, do not commit) using `tsx` + the `postgres` package, or report the SQL for the controller to run via the Neon tooling:

```sql
SELECT e.access, count(*)::int AS n
FROM episodes e
JOIN seasons se ON e.season_id = se.id
JOIN shows s ON se.show_id = s.id
WHERE s.slug = 'one-look'
GROUP BY e.access ORDER BY e.access;
-- expected: free=10, member=2
SELECT count(*)::int AS non_sub FROM episodes WHERE access != 'subscriber';
-- expected: 12 (only one-look is gated today)
```

If the numbers differ, STOP and report BLOCKED with the actual rows.

- [ ] **Step 1.5: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass (no consumers yet).

```bash
git add db/schema/episodes.ts drizzle/
git commit -m "feat(db): per-episode access enum, backfilled from positional gating"
```

Exact message, no footer.

---

### Task 2: `showHasTierGating` in `lib/episode-access.ts`

**Files:**
- Modify: `lib/episode-access.ts`

- [ ] **Step 2.1: Add the helper (keep the old positional helpers for now)**

Add `ne` to the drizzle-orm import (`and, asc, eq, ne`). Then add at the end of the file:

```ts
// A show is tier-gated iff at least one READY episode is open below the
// subscriber tier. Gated shows use per-episode walls; shows where every
// ready episode is subscriber-only keep the legacy 60-second preview.
// One indexed probe — limit 1, not a count.
export async function showHasTierGating(showId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(seasons.showId, showId),
        eq(episodes.status, "ready"),
        ne(episodes.access, "subscriber"),
      ),
    )
    .limit(1);
  return row !== undefined;
}
```

Do NOT delete `getShowGating`/`tierForPosition` yet — their consumers migrate in Tasks 3–8 and every commit must stay typecheck-green; Task 9 deletes them.

- [ ] **Step 2.2: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add lib/episode-access.ts
git commit -m "feat(access): derived tier-gating probe for shows"
```

---

### Task 3: Token route — tier from `row.access`

**Files:**
- Modify: `app/api/playback-token/route.ts`

Read the whole file first. The CRITICAL invariants from the previous feature still bind: subscriber branch stays FIRST and untouched; the legacy trial path below the gated section stays byte-for-byte untouched; legacy 403s stay reason-less; no TTL > 1h; all responses carry `NO_CACHE`.

- [ ] **Step 3.1: Imports + episode lookup**

Replace the `@/lib/episode-access` import block with:

```ts
import { showHasTierGating } from "@/lib/episode-access";
```

(removing `getOrderedReadyEpisodeIds, getShowGating, tierForPosition` — no longer used here). In the episode lookup's `.select({...})`, replace the two show-count fields with the episode's own tier:

```ts
    .select({
      playbackId: episodes.muxPlaybackId,
      showId: seasons.showId,
      access: episodes.access,
    })
```

- [ ] **Step 3.2: Replace the gated-show section**

Delete the ENTIRE existing block from `const gating = getShowGating(row);` through the closing brace of `if (gating.gated) { ... }` (it ends just above the `// Trial path.` comment). In its place insert:

```ts
  // Per-episode access control: the episode's own `access` value decides
  // who may play it — free → anyone, member → any signed-in user,
  // subscriber → active subscription (subscribers already returned above).
  // A free or member episode implies a tier-gated show, so those paths need
  // no show-level lookup; only subscriber-tier episodes probe the show to
  // pick between the paywall (gated show) and the legacy 60s trial below.
  // Gated 403s carry a machine-readable `reason`; legacy 403s stay
  // reason-less.
  if (row.access === "free") {
    // Funnel tracking row (kind='episodes') — minted on the first free
    // play for this (cookie, show), carrying the attribution snapshot and
    // IP hash exactly like the legacy trial. STRICTLY best-effort: a rate
    // limit (or any DB hiccup) degrades tracking, never playback — free
    // content must not 429.
    const cookieStore = await cookies();
    const existingToken = cookieStore.get(TRIAL_COOKIE)?.value;
    const sessionToken = existingToken ?? crypto.randomUUID();
    let setCookie = false;
    try {
      const existing = existingToken
        ? await findTrialSession(existingToken, row.showId)
        : null;
      if (!existing) {
        await mintTrialSession({
          sessionToken,
          showId: row.showId,
          ipHash: hashClientIp(getClientIp(req)),
          attribution: readAttributionCookiesFromRequest(req),
          kind: "episodes",
        });
        setCookie = !existingToken;
      }
    } catch (err) {
      // TrialRateLimitError or transient DB failure — tracking skipped,
      // playback unaffected. Warn on the unexpected case so a systemic DB
      // failure can't silently zero the funnel (rate limits are normal
      // abuse-control noise, not failures).
      if (!(err instanceof TrialRateLimitError)) {
        console.warn(`[playback-token] free-tier tracking skipped: ${err}`);
      }
    }
    const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
    logToken({ result: 200, mode: "free", showId: row.showId, episodeId });
    const res = NextResponse.json(
      { token, expiresIn: SUBSCRIBER_TTL, mode: "free" },
      { headers: NO_CACHE },
    );
    if (setCookie) {
      res.cookies.set(TRIAL_COOKIE, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: ONE_YEAR_SECONDS,
      });
    }
    return res;
  }

  if (row.access === "member") {
    if (userId) {
      const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
      logToken({
        result: 200,
        mode: "member",
        showId: row.showId,
        episodeId,
      });
      return NextResponse.json(
        { token, expiresIn: SUBSCRIBER_TTL, mode: "member" },
        { headers: NO_CACHE },
      );
    }
    // Anonymous request for a member episode → sign-up wall. Stamp the
    // funnel timestamp on the session's row when one exists (deep-link
    // path; the end-of-tier path stamps via markSignupWallShown).
    const cookieStore = await cookies();
    const existingToken = cookieStore.get(TRIAL_COOKIE)?.value;
    if (existingToken) {
      try {
        await stampSignupWall(existingToken, row.showId);
      } catch (err) {
        // analytics-only — never block the response
        console.warn(`[playback-token] signup-wall stamp skipped: ${err}`);
      }
    }
    logToken({ result: 403, mode: "free", showId: row.showId, episodeId });
    return NextResponse.json(
      { error: "Not authorized", reason: "signup_required" },
      { status: 403, headers: NO_CACHE },
    );
  }

  // access === "subscriber" and the requester isn't one (subscribers
  // returned earlier). On a tier-gated show this is the subscription
  // paywall; on an all-subscriber (legacy) show, fall through to the
  // 60-second trial path below.
  if (await showHasTierGating(row.showId)) {
    logToken({
      result: 403,
      mode: userId ? "member" : "free",
      showId: row.showId,
      episodeId,
    });
    return NextResponse.json(
      { error: "Not authorized", reason: "subscribe_required" },
      { status: 403, headers: NO_CACHE },
    );
  }
```

The legacy trial path below (starting at the `// Trial path.` comment) stays byte-for-byte untouched — it declares its own `cookieStore`/`existingToken` at function scope, which doesn't collide with the block-scoped ones above.

- [ ] **Step 3.3: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add app/api/playback-token/route.ts
git commit -m "feat(playback): enforce per-episode access tiers"
```

---

### Task 4: Progress writes — access-based gates

**Files:**
- Modify: `app/watch/actions.ts`

Read the whole file first.

- [ ] **Step 4.1: Imports**

Replace the `@/lib/episode-access` import with:

```ts
import {
  getOrderedReadyEpisodeIds,
  showHasTierGating,
} from "@/lib/episode-access";
```

(`getShowGating`/`tierForPosition` drop out; `getOrderedReadyEpisodeIds` stays — funnel depth is positional.)

- [ ] **Step 4.2: `saveWatchProgress` — gate on the episode's access**

In the episode-validity lookup, replace the two count fields with the tier:

```ts
    .select({
      id: episodes.id,
      showId: seasons.showId,
      access: episodes.access,
    })
```

Replace the ENTIRE non-subscriber gate block (the `if (!(await hasActiveSubscription(userId))) { ... }` with the gating/position logic inside) with:

```ts
  // Ownership gate: subscribers may write progress on anything; signed-in
  // non-subscribers only on episodes open to them (free or member tier).
  // All-subscriber (legacy 60s-trial) shows have no such episodes, so
  // non-subscribers are rejected there exactly as before. Mirrors the token
  // route's gate so progress rows can't be written for content the user
  // can't play.
  if (!(await hasActiveSubscription(userId))) {
    if (ep.access === "subscriber") return;
  }
```

The trailing upsert stays byte-for-byte.

- [ ] **Step 4.3: `saveTrialPosition` — branch on access**

In its episode-validity lookup, replace the two count fields with the tier (keep `showId`):

```ts
    .select({
      showId: seasons.showId,
      access: episodes.access,
    })
```

Replace everything after that lookup's `if (!row) return;` (the gating/position branch AND the legacy plain write) with:

```ts
  // Per-episode access decides the write shape:
  //  - free: full tracking (resume target + monotonic positional depth) —
  //    the only tier an anonymous viewer can legitimately play on a gated
  //    show; the position-0 guard keeps a vanished-episode race out.
  //  - member: never legitimately playable anonymously — a forged action
  //    call must not pollute the funnel row.
  //  - subscriber: on legacy 60s-preview shows (no tier-gated episode) keep
  //    the plain position write; on gated shows it's not anonymously
  //    playable, so no write.
  if (row.access === "free") {
    const orderedIds = await getOrderedReadyEpisodeIds(row.showId);
    const position = orderedIds.indexOf(episodeId) + 1;
    if (position === 0) return;
    await db
      .update(trialSessions)
      .set({
        lastPositionSeconds: clamped,
        lastEpisodeId: episodeId,
        furthestEpisodeNumber: sql`GREATEST(${trialSessions.furthestEpisodeNumber}, ${position})`,
      })
      .where(
        and(
          eq(trialSessions.sessionToken, sessionToken),
          eq(trialSessions.showId, row.showId),
        ),
      );
    return;
  }
  if (row.access === "member") return;
  if (await showHasTierGating(row.showId)) return;

  await db
    .update(trialSessions)
    .set({ lastPositionSeconds: clamped })
    .where(
      and(
        eq(trialSessions.sessionToken, sessionToken),
        eq(trialSessions.showId, row.showId),
      ),
    );
```

`markSignupWallShown` and everything else stays untouched.

- [ ] **Step 4.4: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add app/watch/actions.ts
git commit -m "feat(watch): access-based progress gates"
```

---

### Task 5: Watch page — tier straight from the row

**Files:**
- Modify: `app/watch/[showSlug]/page.tsx`

Read the whole file first.

- [ ] **Step 5.1: Imports + episode select**

Remove `getShowGating, tierForPosition` from the `@/lib/episode-access` import — if nothing else remains in that import, delete the line entirely (the page derives gating from the episode list; it does not need `showHasTierGating`). In the `allReady` select, add the tier after `status`:

```ts
      status: episodes.status,
      access: episodes.access,
```

- [ ] **Step 5.2: Derive gating + tier from the rows**

Replace the two lines

```ts
  const gating = getShowGating(show);
  const positionById = new Map(ordered.map((e, i) => [e.id, i + 1]));
```

with:

```ts
  // Tier-gated iff any ready episode is open below the subscriber tier
  // (mirrors showHasTierGating in lib/episode-access.ts). All-subscriber
  // shows keep the legacy 60s-trial flow below.
  const gated = ordered.some((e) => e.access !== "subscriber");
```

In the `playable` map, replace the tier ternary

```ts
        tier: gating.gated
          ? tierForPosition(positionById.get(e.id)!, gating)
          : ("free" as const),
```

with the row's own value (on legacy shows every episode is `"subscriber"`, and `isEpisodeLocked` ignores tier entirely in trial/subscriber modes, so nothing locks there — same net behavior as the old `"free"` placeholder):

```ts
        tier: e.access,
```

- [ ] **Step 5.3: Swap the two `gating.gated` references**

`if (userId && (isSubscriber || gating.gated)) {` → `if (userId && (isSubscriber || gated)) {`
`if (gating.gated) {` → `if (gated) {`

Everything inside those branches (member linking, signup pixel, anonymous resume, legacy redirect) stays untouched.

- [ ] **Step 5.4: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass. (Type note: `e.access` is `EpisodeAccess` = `"free" | "member" | "subscriber"`, structurally identical to the player's `EpisodeTier` — no cast needed.)

```bash
git add "app/watch/[showSlug]/page.tsx"
git commit -m "feat(watch): per-episode tiers on the watch page"
```

---

### Task 6: Admin — access selects + actions

**Files:**
- Create: `components/admin/access-select.tsx`
- Modify: `app/admin/actions.ts`
- Modify: `app/admin/shows/[id]/seasons/[seasonId]/page.tsx`
- Modify: `app/admin/shows/[id]/seasons/[seasonId]/episodes/[episodeId]/page.tsx`

- [ ] **Step 6.1: Create `components/admin/access-select.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EpisodeAccess } from "@/db/schema";
import { updateEpisodeAccess } from "@/app/admin/actions";

// Who can watch an episode. Labels mirror the viewer-facing tiers:
// Free = anonymous trial viewers, Members = any signed-in account,
// Subscribers = active subscription only.
const ACCESS_LABELS: Record<EpisodeAccess, string> = {
  free: "Free",
  member: "Members",
  subscriber: "Subscribers",
};

const ACCESS_ORDER: EpisodeAccess[] = ["free", "member", "subscriber"];

// Instant-apply variant for the season page's episode rows: changing the
// value fires the server action immediately (no Save button). Optimistic
// local state + disabled-while-pending keeps double-fires out; the row's
// server value wins on the revalidated render.
export function EpisodeAccessSelect({
  episodeId,
  seasonId,
  showId,
  value,
}: {
  episodeId: string;
  seasonId: string;
  showId: string;
  value: EpisodeAccess;
}) {
  const [current, setCurrent] = useState<EpisodeAccess>(value);
  const [pending, startTransition] = useTransition();
  return (
    <Select
      value={current}
      onValueChange={(v) => {
        const access = v as EpisodeAccess;
        setCurrent(access);
        startTransition(async () => {
          await updateEpisodeAccess(episodeId, seasonId, showId, access);
        });
      }}
      disabled={pending}
    >
      <SelectTrigger className="h-8 w-36 text-xs" aria-label="Who can watch">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACCESS_ORDER.map((a) => (
          <SelectItem key={a} value={a}>
            {ACCESS_LABELS[a]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Form-embedded variant for the episode edit page — submits with the form
// via a hidden input (same pattern as StatusSelect).
export function AccessFormSelect({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: EpisodeAccess;
}) {
  const [value, setValue] = useState<EpisodeAccess>(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select
        value={value}
        onValueChange={(v) => setValue(v as EpisodeAccess)}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACCESS_ORDER.map((a) => (
            <SelectItem key={a} value={a}>
              {ACCESS_LABELS[a]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
```

(If `db/schema/index.ts` does not already re-export the `EpisodeAccess` type from `./episodes`, it will via the existing `export *` — verify; if the schema index uses named re-exports, add it.)

- [ ] **Step 6.2: `app/admin/actions.ts` — new action + `updateEpisode` field**

Add `episodeAccess` and `type EpisodeAccess` to the `@/db/schema` import. Add the new action after `updateEpisode`:

```ts
// Instant per-episode access change from the season page's row select.
// Validated against the enum (the client passes a string), chain-verified
// like deleteEpisode so crafted calls can't reach across shows.
export async function updateEpisodeAccess(
  episodeId: string,
  seasonId: string,
  showId: string,
  access: EpisodeAccess,
) {
  await requireAdmin();
  if (!episodeAccess.enumValues.includes(access)) {
    throw new Error("Invalid access tier");
  }
  const [chain] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.seasonId, seasonId),
        eq(seasons.showId, showId),
      ),
    )
    .limit(1);
  if (!chain) throw new Error("Episode not in this season/show");

  await db.update(episodes).set({ access }).where(eq(episodes.id, episodeId));

  revalidatePath(`/admin/shows/${showId}/seasons/${seasonId}`);
  revalidatePath(
    `/admin/shows/${showId}/seasons/${seasonId}/episodes/${episodeId}`,
  );
}
```

In `updateEpisode`, after the intro-marker validation block, add:

```ts
  // Per-episode access tier — the form's AccessFormSelect always submits
  // one of the enum values; anything else is a forged post.
  const accessRaw = str(formData, "access");
  if (!(episodeAccess.enumValues as readonly string[]).includes(accessRaw)) {
    throw new Error("Invalid access tier");
  }
  const access = accessRaw as EpisodeAccess;
```

and add `access,` to `updateEpisode`'s `.set({ ... })` object.

- [ ] **Step 6.3: Season page — per-row select**

In `app/admin/shows/[id]/seasons/[seasonId]/page.tsx`: add `access: episodes.access,` to the `seasonEpisodes` select (after `status`); import the component:

```ts
import { EpisodeAccessSelect } from "@/components/admin/access-select";
```

In the episode row's action cluster (`<div className="relative z-10 flex shrink-0 items-center gap-2">`), insert BEFORE the Edit `<Link>`:

```tsx
                    <EpisodeAccessSelect
                      episodeId={episode.id}
                      seasonId={season.id}
                      showId={show.id}
                      value={episode.access}
                    />
```

(The cluster's `relative z-10` already lifts it above the row's stretched-link overlay, so the select is clickable.)

- [ ] **Step 6.4: Episode edit page — form field**

In `app/admin/shows/[id]/seasons/[seasonId]/episodes/[episodeId]/page.tsx`: add `access: episodes.access,` to the episode select (after `status`); import:

```ts
import { AccessFormSelect } from "@/components/admin/access-select";
```

In the Details form, after the Description `Field` and before the Skip-intro block, add:

```tsx
          <Field
            label="Who can watch"
            hint="Free — anyone, no account. Members — any signed-in user. Subscribers — paid members only."
          >
            <AccessFormSelect name="access" defaultValue={episode.access} />
          </Field>
```

- [ ] **Step 6.5: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add components/admin/access-select.tsx app/admin/actions.ts "app/admin/shows/[id]/seasons/[seasonId]/page.tsx" "app/admin/shows/[id]/seasons/[seasonId]/episodes/[episodeId]/page.tsx"
git commit -m "feat(admin): per-episode access selects on season list and episode form"
```

---

### Task 7: Show form — remove the positional count fields

**Files:**
- Modify: `components/admin/show-form.tsx`
- Modify: `app/admin/actions.ts`
- Modify: `app/admin/shows/[id]/page.tsx`

The DB columns stay until phase 2 (0015); this task just stops the admin surface from reading/writing them.

- [ ] **Step 7.1: `components/admin/show-form.tsx`**

Delete `freeEpisodes: string;` and `memberEpisodes: string;` from `ShowFormValues`; delete `freeEpisodes: "0",` and `memberEpisodes: "0",` from `EMPTY_SHOW_FORM`; delete the ENTIRE "Free preview" `<Panel kicker="Free preview" ...>...</Panel>` block (between the Visibility panel and `<SaveBar>`).

- [ ] **Step 7.2: `app/admin/actions.ts`**

Delete the `gatingCount` helper function; delete the `freeEpisodes: gatingCount(formData, "freeEpisodes"),` / `memberEpisodes: gatingCount(formData, "memberEpisodes"),` lines from BOTH `createShow`'s values object and `updateShow`'s `.set({ ... })`.

- [ ] **Step 7.3: `app/admin/shows/[id]/page.tsx`**

Delete `freeEpisodes: String(show.freeEpisodes),` and `memberEpisodes: String(show.memberEpisodes),` from the `defaultValues` object.

- [ ] **Step 7.4: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add components/admin/show-form.tsx app/admin/actions.ts "app/admin/shows/[id]/page.tsx"
git commit -m "feat(admin): retire show-level gating counts from the admin surface"
```

---

### Task 8: Analytics — access-derived funnel sets

**Files:**
- Modify: `lib/admin-analytics.ts`

Only `loadEpisodeFunnels` (end of file) changes; the dashboard page is untouched. Read the function fully first.

- [ ] **Step 8.1: Imports**

Add `ne` to the `drizzle-orm` import.

- [ ] **Step 8.2: Gated-shows discovery**

Replace the `gatedShows` query (the one filtering `free_episodes + member_episodes > 0`) with:

```ts
  // Tier-gated shows = at least one READY episode below the subscriber
  // tier (set-query mirror of showHasTierGating).
  const gatedShowIds = db
    .selectDistinct({ showId: seasons.showId })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(eq(episodes.status, "ready"), ne(episodes.access, "subscriber")),
    );
  const gatedShows = await db
    .select({ id: shows.id, slug: shows.slug, title: shows.title })
    .from(shows)
    .where(and(isNull(shows.deletedAt), inArray(shows.id, gatedShowIds)))
    .orderBy(shows.title);
```

(The select no longer carries `freeEpisodes`/`memberEpisodes` — required before 0015 drops them.)

- [ ] **Step 8.3: Per-show sets from `access`**

Inside the per-show loop, delete the two lines `const freeCount = Math.max(0, s.freeEpisodes);` / `const memberCount = Math.max(0, s.memberEpisodes);`. Add `access: episodes.access,` to the `orderedEps` select. Then replace the member-slice block (`const memberEps = orderedEps.slice(...)` and the `lastMemberEp` line) with:

```ts
    // Sets come from each episode's own access value; positions stay
    // 1-based in the ready ordering (the funnel depth metric is
    // positional). Free sets may be non-contiguous — the wall threshold is
    // the LAST free episode's position: a viewer who started it has seen
    // everything the free tier offers.
    const freePositions = orderedEps
      .map((e, i) => (e.access === "free" ? i + 1 : 0))
      .filter((p) => p > 0);
    const freeCount = freePositions.length;
    const lastFreePos =
      freePositions.length > 0 ? freePositions[freePositions.length - 1] : 0;
    const memberEps = orderedEps.filter((e) => e.access === "member");
    const memberCount = memberEps.length;
    const memberEpIds = memberEps.map((e) => e.id);
    const lastMemberEp = memberEps.at(-1) ?? null;
```

(Delete the now-duplicated original `memberEpIds` line if it exists separately.)

- [ ] **Step 8.4: Wall threshold in the aggregates**

The agg query's `wallHit`/`signedUp` FILTERs currently compare `furthest_episode_number >= ${freeCount}`. Replace with a precomputed condition that degrades safely when no free episodes exist (`furthest >= 0` would match every row):

Above the `Promise.all`, add:

```ts
    // Wall-hit: explicit stamp, or positional depth reaching the last free
    // episode. With an empty free set there is no positional threshold —
    // only the stamp counts.
    const wallCond =
      lastFreePos > 0
        ? sql`(${trialSessions.signupWallAt} IS NOT NULL OR ${trialSessions.furthestEpisodeNumber} >= ${lastFreePos})`
        : sql`${trialSessions.signupWallAt} IS NOT NULL`;
```

and change the two FILTER expressions to:

```ts
            wallHit: sql<number>`COUNT(*) FILTER (WHERE ${wallCond})::int`,
            signedUp: sql<number>`COUNT(*) FILTER (WHERE ${wallCond} AND ${trialSessions.userId} IS NOT NULL)::int`,
```

- [ ] **Step 8.5: Depth bars span the free positions**

In the depth assembly, replace `Array.from({ length: freeCount }, ...)` with `Array.from({ length: lastFreePos }, ...)` (the body — `pos = i + 1`, cumulative `furthest >= pos`, label `E${pos}` — stays).

- [ ] **Step 8.6: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add lib/admin-analytics.ts
git commit -m "feat(analytics): derive episode-funnel sets from per-episode access"
```

---

### Task 9: Delete the dead positional helpers

**Files:**
- Modify: `lib/episode-access.ts`

- [ ] **Step 9.1: Remove `getShowGating`, `tierForPosition`, and `ShowGating`**

All consumers migrated in Tasks 3–8 — verify with `grep -rn "getShowGating\|tierForPosition\|ShowGating" --include="*.ts" --include="*.tsx" .` (expect ZERO hits outside `lib/episode-access.ts` itself and the historical docs/superpowers files; do NOT edit docs). Delete the three exports and their comments; update the module's header comment to describe the access-based model:

```ts
// Per-episode access control. An episode's tier IS its `access` column
// (free | member | subscriber — admin-set, default subscriber). A show is
// tier-gated iff any ready episode sits below the subscriber tier
// (showHasTierGating); all-subscriber shows keep the legacy 60-second
// preview. Positions in the ready ordering (getOrderedReadyEpisodeIds)
// remain the funnel's depth metric.
```

`EpisodeTier` (the type) STAYS — the watch page/player contract uses it.

- [ ] **Step 9.2: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass (any failure = a missed consumer; fix that consumer per its task's pattern, don't resurrect the helper).

```bash
git add lib/episode-access.ts
git commit -m "refactor(access): drop positional gating helpers"
```

---

### Task 10: Docs — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 10.1: Rewrite the episode-gating bullet**

Replace the ENTIRE `- **Episode-gated free tier**: ...` bullet under **Key business rules** with:

```markdown
- **Per-episode access control**: every episode has an `access` tier (`episodes.access` enum, admin-set via the season page's per-row select or the episode edit form, default `subscriber`): `free` (anyone, full episode, 1h auto-refreshing token), `member` (any signed-in user), `subscriber` (active subscription). A show with ≥1 ready non-subscriber episode is **tier-gated** (no 60s clock; per-episode walls); a show whose ready episodes are ALL subscriber-only keeps the legacy 60-second preview trial — the rule is derived, never configured. `/api/playback-token` enforces from the episode row (`showHasTierGating` probe only for subscriber-tier episodes); gated 403s carry `reason: "signup_required" | "subscribe_required"` and the player routes them to `SignupWall` (Clerk sign-up redirecting BACK to `/watch/<slug>?ep=<locked ep>`) or the tier-variant `Paywall`. Anonymous tracking reuses `trial_sessions` (`kind='episodes'`, positional `furthest_episode_number`, `last_episode_id`, `signup_wall_at`) with the same cookie/attribution/linking/conversion machinery as the legacy trial; the per-(IP, show) rate limit only degrades tracking on gated shows, never playback. Signup-completion events (Meta Lead + PostHog) also mount on the watch page. Admin analytics renders a per-show "Episode funnel" (`loadEpisodeFunnels`; wall threshold = last free episode's position). Replaced the show-level positional counts 2026-06-04 (live config backfilled by migration 0014; columns dropped by 0015).
```

- [ ] **Step 10.2: Fix the stale deploy note**

In **Production context**, replace the bullet starting `- GitHub auto-deploy is NOT wired` with:

```markdown
- GitHub auto-deploy IS wired: `git push origin main` triggers a production deployment (recent releases all shipped this way). CLI deploys (`vercel --prod`) from this machine get stuck in BLOCKED state — use the git-push path. `git push` is therefore BOTH source backup AND deploy.
```

- [ ] **Step 10.3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: per-episode access business rule + correct deploy-path note"
```

---

### Task 11: Phase-1 verification (controller-led)

- [ ] **Step 11.1:** `pnpm typecheck && pnpm lint && pnpm build && pnpm test:locale` — all green.
- [ ] **Step 11.2:** Dev-server smoke (`pnpm dev --port 3102`):
  - token route: one-look ep1 → `200 mode:"free"`; ep11 anonymous → `403 signup_required`; legacy show ep → `200 mode:"trial"` ≤60s (backfilled tiers honored, derived legacy rule works);
  - watch pages: one-look shows "Ver gratis", legacy shows "Ver 60 s gratis";
  - clean up any trial rows minted (delete by session token).
- [ ] **Step 11.3:** DB round-trip of the admin action — flip a one-look episode's access via SQL is NOT representative (the action is the product); instead verify the season page renders the selects (HTML contains three labels) and exercise `updateEpisodeAccess`'s chain validation only if a browser is available; otherwise defer to post-deploy human check.

### Task 12: Deploy gate (requires explicit user confirmation)

- [ ] **Step 12.1:** Merge the branch into `main` (fast-forward expected), push → GitHub auto-deploy → wait READY.
- [ ] **Step 12.2:** Prod smoke (same three token-route probes + page labels as 11.2, against matio.tv; clean up minted rows).

### Task 13: Phase 2 — drop the positional columns (only after 12.2 passes)

- [ ] **Step 13.1:** Remove `freeEpisodes`/`memberEpisodes` (and their comment block) from `db/schema/shows.ts`.
- [ ] **Step 13.2:** `pnpm db:generate --name drop_positional_gating` — expect `drizzle/0015_drop_positional_gating.sql` with exactly two `ALTER TABLE "shows" DROP COLUMN ...` statements. Anything else → STOP.
- [ ] **Step 13.3:** `pnpm db:migrate` (the deployed code no longer references the columns).
- [ ] **Step 13.4:** `pnpm typecheck && pnpm lint`, commit (`feat(db): drop retired positional gating columns`), push (schema-only deploy).


