# Episode-Gated Free Tier + Funnel Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonymous viewers watch the first 10 episodes of a gated show (One look) in full; episodes 11–12 require a free account (sign-up wall that redirects back into playback); 13+ require a subscription — plus an "Episode funnel" section on /admin/analytics.

**Architecture:** Positional tier gating (`free` / `member` / `subscriber`) computed live from the episode's 1-based position in the show's ready-episode ordering vs two new per-show admin columns. `/api/playback-token` stays the single enforcement gate (403s carry a machine-readable `reason`); the watch page passes per-episode tiers to the player so walls render proactively. Anonymous tracking extends `trial_sessions` (`kind='episodes'` rows) to reuse the existing signup-linking / attribution / conversion machinery. Spec: `docs/superpowers/specs/2026-06-03-episode-gated-trial-design.md`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle 0.45 + postgres-js (Neon), Clerk 7, Mux signed JWTs, PostHog (consent-gated), Tailwind v4.

**Verification model:** This repo has NO unit-test framework (deliberate — do not add one). Every task verifies with `pnpm typecheck` + `pnpm lint`, and the final task runs the end-to-end manual recipes against `pnpm dev`. Commit after every task.

**Conventions that bind every task** (from CLAUDE.md):
- All DB access through Drizzle; raw SQL only inside `sql` template tags.
- Server-only modules start with `import "server-only";`.
- Never expose playback IDs without a server-issued Mux JWT; token TTL ≤ 1 hour.
- Don't `db:push`; use `db:generate` + `db:migrate`.
- Public-surface copy is bilingual — every user-facing string goes through `lib/i18n/dictionaries.ts` (es default + en).

---

## File structure (what's created / modified)

| File | Change |
|---|---|
| `db/schema/shows.ts` | + `freeEpisodes`, `memberEpisodes` columns |
| `db/schema/trial_sessions.ts` | + `kind`, `furthestEpisodeNumber`, `lastEpisodeId`, `signupWallAt` |
| `drizzle/0013_episode_gating.sql` | generated migration |
| `lib/episode-access.ts` | **new** — tier computation (server-only) |
| `lib/trial.ts` | `mintTrialSession` gains `kind`; new `stampSignupWall` |
| `app/api/playback-token/route.ts` | tier enforcement branch for gated shows |
| `app/watch/actions.ts` | `saveTrialPosition` depth tracking; `saveWatchProgress` tier gate; new `markSignupWallShown` |
| `lib/i18n/dictionaries.ts` | + `signupWall` section, paywall tier-variant keys, lock labels, free play-gate label |
| `lib/posthog-events.ts` | + 3 funnel event names |
| `components/watch/signup-wall.tsx` | **new** — sign-up wall overlay |
| `components/watch/paywall.tsx` | optional `variant` prop (trial vs tier copy + event prop) |
| `components/watch/player.tsx` | modes `free`/`member`, tier locks, wall rendering, 403-reason classification |
| `components/watch/episodes-overlay.tsx` | lock badges on episodes above the viewer's tier |
| `app/watch/[showSlug]/page.tsx` | tier computation, mode selection, member resume, linking, signup pixel |
| `components/admin/show-form.tsx` | + Free preview panel (two number fields) |
| `app/admin/actions.ts` | parse/persist the two new columns |
| `app/admin/shows/[id]/page.tsx` | pass new defaults to the form |
| `lib/admin-analytics.ts` | **new export** `loadEpisodeFunnels()` |
| `app/admin/analytics/page.tsx` | "Episode funnel" section |
| `CLAUDE.md` | document the new business rule |

Episode **position** is always 1-based within the show's ready episodes ordered by (season number, episode number) — identical ordering in `lib/episode-access.ts`, the watch page, and analytics. `furthest_episode_number` stores this position, not `episodes.number`.

---

### Task 1: Schema columns + migration

**Files:**
- Modify: `db/schema/shows.ts`
- Modify: `db/schema/trial_sessions.ts`
- Create (generated): `drizzle/0013_episode_gating.sql`

- [ ] **Step 1.1: Add gating columns to `db/schema/shows.ts`**

Add `integer` to the existing `drizzle-orm/pg-core` import (it currently imports `boolean, pgEnum, pgTable, text, timestamp, uuid`). Then add the two columns after `popularNow`:

```ts
  popularNow: boolean("popular_now").notNull().default(false),
  // Episode-gated free tier (microdrama model). Positions are 1-based within
  // the show's READY episodes ordered by (season number, episode number):
  //   position <= free_episodes                      → playable by anyone
  //   position <= free_episodes + member_episodes    → any signed-in user
  //   beyond                                         → subscribers only
  // Both 0 (the default) → the legacy 60-second preview trial applies.
  freeEpisodes: integer("free_episodes").notNull().default(0),
  memberEpisodes: integer("member_episodes").notNull().default(0),
```

- [ ] **Step 1.2: Add tracking columns to `db/schema/trial_sessions.ts`**

Add `import { episodes } from "./episodes";` next to the existing `shows`/`users` imports. Then add four columns after `attributionLastCampaign` (inside the columns object, before the `(t) => [...]` constraints):

```ts
    // 'preview' = legacy 60s-trial row; 'episodes' = episode-gated free-tier
    // row (shows with free_episodes > 0). Explicit discriminator (not derived
    // from the show's current config) so the two funnel populations stay
    // separable even if a show's gating is later turned on/off.
    kind: text("kind").notNull().default("preview"),
    // Deepest 1-based episode POSITION started on this session (ordering as
    // in lib/episode-access.ts) — powers the funnel depth distribution.
    // Always 0 for kind='preview'.
    furthestEpisodeNumber: integer("furthest_episode_number")
      .notNull()
      .default(0),
    // Last episode watched — anonymous resume target on gated shows.
    lastEpisodeId: uuid("last_episode_id").references(() => episodes.id, {
      onDelete: "set null",
    }),
    // First time this session hit the sign-up wall (end of free tier or a
    // deep link to a member episode). Stage 3 of the episode funnel.
    signupWallAt: timestamp("signup_wall_at", { withTimezone: true }),
```

- [ ] **Step 1.3: Generate the migration**

Run: `pnpm db:generate --name episode_gating`
Expected: a new file `drizzle/0013_episode_gating.sql` containing exactly six `ALTER TABLE ... ADD COLUMN` statements (2 on `shows`, 4 on `trial_sessions`) plus one `ADD CONSTRAINT ... FOREIGN KEY ("last_episode_id") REFERENCES ... ON DELETE set null`. Read the generated SQL and confirm there are NO other statements (no drops, no unrelated diffs). If unrelated statements appear, stop — the schema files have drifted from the DB; investigate before migrating.

- [ ] **Step 1.4: Apply to the dev database**

Run: `pnpm db:migrate`
Expected: exits 0. (This applies to whatever `DATABASE_URL` is in `.env*` — the dev/prod split is handled in the final rollout task.)

- [ ] **Step 1.5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass (no consumers of the new columns yet).

- [ ] **Step 1.6: Commit**

```bash
git add db/schema/shows.ts db/schema/trial_sessions.ts drizzle/
git commit -m "feat(db): per-show episode-gating config + trial session depth tracking"
```

---

### Task 2: Tier computation module `lib/episode-access.ts`

**Files:**
- Create: `lib/episode-access.ts`

- [ ] **Step 2.1: Create the module**

```ts
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";

// Episode-gated free tier (microdrama model). An episode's tier comes from
// its 1-based POSITION in the show's ready-episode ordering — ready episodes
// ordered by (season number, episode number); the same ordering the watch
// page builds for its `playable` list. Tiers are computed live at request
// time in every enforcement site (token route, watch page, progress
// actions) — never stored — so publishing/unpublishing episodes
// self-corrects everywhere on the next request.

export type EpisodeTier = "free" | "member" | "subscriber";

export type ShowGating = {
  gated: boolean;
  freeCount: number;
  memberCount: number;
};

// Negative values can't be entered through the admin form, but clamp anyway
// so a hand-edited row can't produce a nonsense tier split.
export function getShowGating(show: {
  freeEpisodes: number;
  memberEpisodes: number;
}): ShowGating {
  const freeCount = Math.max(0, show.freeEpisodes);
  const memberCount = Math.max(0, show.memberEpisodes);
  return { gated: freeCount + memberCount > 0, freeCount, memberCount };
}

export function tierForPosition(
  position: number,
  gating: ShowGating,
): EpisodeTier {
  if (!gating.gated) return "subscriber";
  if (position <= gating.freeCount) return "free";
  if (position <= gating.freeCount + gating.memberCount) return "member";
  return "subscriber";
}

// Ordered ready-episode ids for a show; position = array index + 1. The
// caller is responsible for show-level checks (published, not deleted) —
// every current caller has already verified them.
export async function getOrderedReadyEpisodeIds(
  showId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(and(eq(seasons.showId, showId), eq(episodes.status, "ready")))
    .orderBy(asc(seasons.number), asc(episodes.number));
  return rows.map((r) => r.id);
}
```

- [ ] **Step 2.2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: pass.

- [ ] **Step 2.3: Commit**

```bash
git add lib/episode-access.ts
git commit -m "feat(access): episode tier computation for gated shows"
```

---

### Task 3: `lib/trial.ts` — `kind` on mint + `stampSignupWall`

**Files:**
- Modify: `lib/trial.ts`

- [ ] **Step 3.1: Let `mintTrialSession` mint `kind='episodes'` rows**

In `lib/trial.ts`, change `mintTrialSession`'s signature and body. The parameter object gains an optional `kind` (default `"preview"`), and for `'episodes'` rows `expiresAt` is set to "now" — a sentinel equal to `startedAt`; the 60s-expiry code paths never run for gated shows. Replace the current function header and the `expiresAt`/values block:

```ts
export async function mintTrialSession({
  sessionToken,
  showId,
  ipHash,
  attribution,
  kind = "preview",
}: {
  sessionToken: string;
  showId: string;
  ipHash: string;
  attribution?: { first: AttributionPayload; last: AttributionPayload };
  // 'preview' = legacy 60s trial; 'episodes' = episode-gated free tier
  // (expiresAt becomes a startedAt sentinel — gated shows never read it).
  kind?: "preview" | "episodes";
}): Promise<TrialSession> {
```

and where `expiresAt` is computed / the insert values are built:

```ts
  const expiresAt =
    kind === "episodes"
      ? new Date()
      : new Date(Date.now() + TRIAL_DURATION_SECONDS * 1000);
  const first = attribution?.first ?? EMPTY_ATTRIBUTION;
  const last = attribution?.last ?? EMPTY_ATTRIBUTION;
  const inserted = await db
    .insert(trialSessions)
    .values({
      sessionToken,
      showId,
      expiresAt,
      ipHash,
      kind,
      ...toFirstColumns(first),
      ...toLastColumns(last),
    })
```

The rate-limit count above this stays exactly as-is — it deliberately counts BOTH kinds per (ip, show) bucket. (The token route decides what a `TrialRateLimitError` means per tier: legacy → 429, free tier → tracking skipped, token still issued.)

- [ ] **Step 3.2: Add `stampSignupWall` at the end of the file**

```ts
// Records the first time a session hit the sign-up wall on a gated show
// (stage 3 of the episode funnel). Write-once via the IS NULL guard so a
// repeat visit doesn't move the timestamp. Called from the token route
// (anonymous deep link to a member episode) and from the wall overlay's
// mount action (end-of-free-tier path, which never hits the token route).
export async function stampSignupWall(
  sessionToken: string,
  showId: string,
): Promise<void> {
  await db
    .update(trialSessions)
    .set({ signupWallAt: new Date() })
    .where(
      and(
        eq(trialSessions.sessionToken, sessionToken),
        eq(trialSessions.showId, showId),
        isNull(trialSessions.signupWallAt),
      ),
    );
}
```

(`and`, `eq`, `isNull` are already imported at the top of `lib/trial.ts`.)

- [ ] **Step 3.3: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add lib/trial.ts
git commit -m "feat(trial): episodes-kind session rows + signup-wall stamp"
```

---

### Task 4: Token route — tier enforcement

**Files:**
- Modify: `app/api/playback-token/route.ts`

The route currently flows: episode lookup → subscriber branch → legacy trial branch. Insert a gated-show branch between subscriber and legacy. Response contract additions: `mode: "free" | "member"` on 200s; `reason: "signup_required" | "subscribe_required"` on gated 403s (legacy trial 403s stay reason-less — the player maps those to today's paywall).

- [ ] **Step 4.1: Extend imports + episode lookup + logger**

Add to the imports from `@/lib/episode-access` and `@/lib/trial`:

```ts
import {
  getOrderedReadyEpisodeIds,
  getShowGating,
  tierForPosition,
} from "@/lib/episode-access";
import {
  TRIAL_COOKIE,
  TRIAL_DURATION_SECONDS,
  TrialRateLimitError,
  findTrialSession,
  getClientIp,
  hashClientIp,
  mintTrialSession,
  stampSignupWall,
} from "@/lib/trial";
```

Extend the episode lookup's select to carry the gating config (the query already joins `shows`):

```ts
    .select({
      playbackId: episodes.muxPlaybackId,
      showId: seasons.showId,
      freeEpisodes: shows.freeEpisodes,
      memberEpisodes: shows.memberEpisodes,
    })
```

Widen `logToken`'s mode union:

```ts
function logToken(fields: {
  result: number;
  mode: "subscriber" | "trial" | "free" | "member" | "none";
  showId?: string;
  episodeId?: string | null;
}) {
  console.info(`[playback-token] ${JSON.stringify(fields)}`);
}
```

- [ ] **Step 4.2: Insert the gated-show branch**

Directly after the subscriber branch's closing `}` (after the `return NextResponse.json({ token, expiresIn: SUBSCRIBER_TTL, mode: "subscriber" }, ...)` block) and BEFORE the existing `// Trial path.` comment, insert:

```ts
  // Episode-gated show (free_episodes + member_episodes > 0): positional
  // tier enforcement replaces the 60s trial entirely for this show. The
  // episode's 1-based position in the ready ordering decides who may play:
  // free → anyone, member → any signed-in user, beyond → subscribers only
  // (subscribers already returned above). Gated 403s carry a machine-
  // readable `reason` so the player can route to the right wall; legacy
  // trial 403s below stay reason-less.
  const gating = getShowGating(row);
  if (gating.gated) {
    const orderedIds = await getOrderedReadyEpisodeIds(row.showId);
    const position = orderedIds.indexOf(episodeId) + 1;
    // position 0 = not found in the ready ordering. The gate above already
    // verified ready+published, so this is a vanishing race (episode went
    // un-ready between queries) — fail toward the most restrictive tier.
    const tier =
      position === 0 ? "subscriber" : tierForPosition(position, gating);

    const cookieStore = await cookies();
    const existingToken = cookieStore.get(TRIAL_COOKIE)?.value;

    if (tier === "free") {
      // Funnel tracking row (kind='episodes') — minted on the first free
      // play for this (cookie, show), carrying the attribution snapshot and
      // IP hash exactly like the legacy trial. STRICTLY best-effort: a rate
      // limit (or any DB hiccup) degrades tracking, never playback — free
      // content must not 429.
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
      } catch {
        // TrialRateLimitError or transient DB failure — tracking skipped.
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

    if (tier === "member") {
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
      if (existingToken) {
        try {
          await stampSignupWall(existingToken, row.showId);
        } catch {
          // analytics-only — never block the response
        }
      }
      logToken({ result: 403, mode: "free", showId: row.showId, episodeId });
      return NextResponse.json(
        { error: "Not authorized", reason: "signup_required" },
        { status: 403, headers: NO_CACHE },
      );
    }

    // tier === "subscriber" and the requester isn't one (subscribers
    // returned earlier) — applies to anonymous and signed-in members alike.
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

Then in the LEGACY trial path below, the `const cookieStore = await cookies();` + `const existingToken = ...` pair now appears twice (once in the gated branch, once in legacy). Leave the legacy block untouched — the gated branch always `return`s, so there's no double-declaration in the same scope; TypeScript block-scoping keeps them separate because the gated branch declares its `cookieStore`/`existingToken` inside `if (gating.gated) { ... }`.

- [ ] **Step 4.3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: pass. If `readAttributionCookiesFromRequest` is flagged unused-before-defined, confirm it's still imported from `@/lib/attribution` (it already is, for the legacy path).

- [ ] **Step 4.4: Manual smoke (dev server)**

Run `pnpm dev`, then in another shell (replace `<EP1_ID>` with episode 1's UUID from the admin or DB):

```bash
curl -s "http://localhost:3000/api/playback-token?episode_id=<EP1_ID>" | head -c 200
```

Expected while One look is still 0/0 (gating not yet configured): legacy behavior — a `mode":"trial"` token. The gated branch is exercised in Task 12's recipes after the admin form lands. This step only confirms no regression on the legacy path.

- [ ] **Step 4.5: Commit**

```bash
git add app/api/playback-token/route.ts
git commit -m "feat(playback): positional tier enforcement for episode-gated shows"
```

---

### Task 5: Progress writes — depth tracking + member gate + wall stamp action

**Files:**
- Modify: `app/watch/actions.ts`

- [ ] **Step 5.1: Extend imports**

```ts
import {
  getOrderedReadyEpisodeIds,
  getShowGating,
  tierForPosition,
} from "@/lib/episode-access";
import { TRIAL_COOKIE, stampSignupWall } from "@/lib/trial";
import { sql } from "drizzle-orm";
```

(`sql` joins the existing `and, eq, isNull` import from `drizzle-orm`; `TRIAL_COOKIE` is already imported — add `stampSignupWall` to that line. `shows` is already imported from `@/db/schema`.)

- [ ] **Step 5.2: Widen `saveWatchProgress`'s gate from "subscriber" to "subscriber OR within tier"**

Replace the current early-return block

```ts
  if (!(await hasActiveSubscription(userId))) return;
```

and the episode-validity lookup with a combined version (the lookup now also fetches gating config, so reorder: validate episode first, then gate):

```ts
  const clamped = clampPositionSeconds(positionSeconds);
  if (clamped === null) return;

  // Verify the episode is actually playable: status='ready', on a
  // published, non-deleted show — and fetch the show's gating config in
  // the same query for the tier check below.
  const [ep] = await db
    .select({
      id: episodes.id,
      showId: seasons.showId,
      freeEpisodes: shows.freeEpisodes,
      memberEpisodes: shows.memberEpisodes,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.status, "ready"),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);
  if (!ep) return;

  // Ownership gate: subscribers may write progress on anything; signed-in
  // non-subscribers only on gated shows, and only for episodes inside
  // their tier (free + member positions). Mirrors the token route's gate
  // so progress rows can't be written for content the user can't play.
  if (!(await hasActiveSubscription(userId))) {
    const gating = getShowGating(ep);
    if (!gating.gated) return;
    const orderedIds = await getOrderedReadyEpisodeIds(ep.showId);
    const position = orderedIds.indexOf(episodeId) + 1;
    if (position === 0) return;
    if (tierForPosition(position, gating) === "subscriber") return;
  }
```

The trailing upsert into `watchProgress` stays byte-for-byte. Delete the now-duplicated original `clamped`/lookup block (this replaces it — make sure `clamped` is declared exactly once).

- [ ] **Step 5.3: Teach `saveTrialPosition` to record depth + resume target**

In `saveTrialPosition`, the episode-validity lookup also pulls gating config:

```ts
  const [row] = await db
    .select({
      showId: seasons.showId,
      freeEpisodes: shows.freeEpisodes,
      memberEpisodes: shows.memberEpisodes,
    })
```

(rest of that query unchanged). Then replace the final `db.update(trialSessions)` with:

```ts
  // Gated shows additionally track funnel depth (furthest 1-based position
  // started) and the anonymous resume target. GREATEST() keeps the depth
  // monotonic — re-watching episode 2 after reaching 7 must not regress
  // the funnel. Legacy 60s previews keep the plain position write.
  const gating = getShowGating(row);
  if (gating.gated) {
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

- [ ] **Step 5.4: Add the `markSignupWallShown` server action at the end of the file**

```ts
// Stamps signup_wall_at on the caller's session row for a show — fired by
// the SignupWall overlay on mount. This covers the end-of-free-tier path
// (episode 10 finishes → wall renders without any token request); the
// deep-link path is stamped server-side by the token route's 403. Write-
// once semantics live in stampSignupWall. Analytics-only: scoped to the
// caller's own cookie, no information returned.
export async function markSignupWallShown(showId: string) {
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return;
  if (typeof showId !== "string" || showId.length === 0) return;
  try {
    await stampSignupWall(sessionToken, showId);
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 5.5: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add app/watch/actions.ts
git commit -m "feat(watch): tiered progress gates, funnel depth tracking, wall stamp action"
```

---

### Task 6: Bilingual copy — `lib/i18n/dictionaries.ts`

**Files:**
- Modify: `lib/i18n/dictionaries.ts`

The `en` dict is type-checked against `typeof es` (`Dict`), so add to **both** or typecheck fails — that's the safety net.

- [ ] **Step 6.1: Spanish (`es`) additions**

Inside `player` add one key (the play-gate label for gated shows — "Ver 60 s gratis" would be wrong there):

```ts
    playFreeEpisode: "Ver gratis",
```

Inside `episodesOverlay` add:

```ts
    lockedSignup: "Crea una cuenta",
    lockedSubscribe: "Suscríbete",
    lockedAria: "Episodio bloqueado",
```

Inside `paywall` add the tier-variant copy (the existing keys stay):

```ts
    allFreeWatched: "Episodios gratis completados",
    subscribeBody:
      "Suscríbete para ver todo el catálogo y los próximos episodios.",
```

After the `paywall` object, add a new top-level `signupWall` section:

```ts
  signupWall: {
    kicker: "Continúa gratis",
    freeComplete: "Episodios gratis vistos",
    headlineFallback: "Tu historia",
    body: (n: number) =>
      n === 1
        ? `Crea una cuenta gratis y desbloquea ${n} episodio más al instante.`
        : `Crea una cuenta gratis y desbloquea ${n} episodios más al instante.`,
    bodyNoCount: "Crea una cuenta gratis para seguir viendo.",
    signUpCta: "Crear cuenta gratis",
    alreadyMember: "¿Ya tienes cuenta?",
    signInLink: "Inicia sesión",
    noCardNeeded: "Sin tarjeta. Solo un email.",
  },
```

- [ ] **Step 6.2: English (`en`) additions — same shape**

`player`:

```ts
    playFreeEpisode: "Watch free",
```

`episodesOverlay`:

```ts
    lockedSignup: "Create account",
    lockedSubscribe: "Subscribe",
    lockedAria: "Locked episode",
```

`paywall`:

```ts
    allFreeWatched: "Free episodes complete",
    subscribeBody:
      "Subscribe to watch the full catalog and every upcoming episode.",
```

Top-level `signupWall`:

```ts
  signupWall: {
    kicker: "Keep watching free",
    freeComplete: "Free episodes watched",
    headlineFallback: "Your story",
    body: (n: number) =>
      n === 1
        ? `Create a free account and instantly unlock ${n} more episode.`
        : `Create a free account and instantly unlock ${n} more episodes.`,
    bodyNoCount: "Create a free account to keep watching.",
    signUpCta: "Create free account",
    alreadyMember: "Already have an account?",
    signInLink: "Sign in",
    noCardNeeded: "No card needed. Just an email.",
  },
```

- [ ] **Step 6.3: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass (a missing key in `en` fails typecheck here, by design).

```bash
git add lib/i18n/dictionaries.ts
git commit -m "feat(i18n): sign-up wall, lock badge, and tier-paywall copy (es+en)"
```

---

### Task 7: PostHog funnel event names

**Files:**
- Modify: `lib/posthog-events.ts`

- [ ] **Step 7.1: Extend the `FunnelEvent` union**

In the `FunnelEvent` type, after `| "paywall_shown"`, add:

```ts
  // Episode-gated free tier (gated shows only):
  //   free_episode_started   — token issued mode:"free", once per episode mount
  //   member_episode_started — token issued mode:"member", once per episode mount
  //   signup_wall_shown      — SignupWall overlay mounted
  | "free_episode_started"
  | "member_episode_started"
  | "signup_wall_shown"
```

- [ ] **Step 7.2: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add lib/posthog-events.ts
git commit -m "feat(analytics): episode-funnel PostHog event names"
```

---

### Task 8: `SignupWall` component + `Paywall` tier variant

**Files:**
- Create: `components/watch/signup-wall.tsx`
- Modify: `components/watch/paywall.tsx`

- [ ] **Step 8.1: Create `components/watch/signup-wall.tsx`**

Visual sibling of `Paywall` (same bottom-sheet layout, chip, safe-area padding). Two behavioral differences: (a) the Clerk redirect goes **back into playback** at `targetEpisodeId`, not to `/subscribe`; (b) on mount it stamps the funnel timestamp + fires `signup_wall_shown`.

```tsx
"use client";

import { useEffect } from "react";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT } from "@/lib/design";
import { useT } from "@/lib/i18n/client";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";
import { markSignupWallShown } from "@/app/watch/actions";

// End-of-free-tier prompt on episode-gated shows. The conversion path is:
//   free episodes end → "Create a free account" → Clerk sign-up modal
//   → BACK TO /watch/<slug>?ep=<first member episode> (playback resumes)
//
// Deliberately NOT /subscribe: the reward for signing up is the next
// episode, and the subscription paywall comes later (end of member tier).
// Signed-in users never see this wall (member tier unlocks for them), but
// the signed-in branch below covers a race (signed in mid-render).
export function SignupWall({
  showSlug,
  showId,
  showTitle,
  episodeLabel,
  targetEpisodeId,
  episodeNumber,
  memberCount,
}: {
  showSlug: string;
  showId: string;
  showTitle?: string;
  episodeLabel?: string;
  // The episode playback resumes at after sign-up — the locked episode the
  // viewer tried to reach (deep link / overlay tap) or the first member
  // episode (natural end of the free tier).
  targetEpisodeId: string;
  // 1-based position of the target episode, for the funnel event.
  episodeNumber: number;
  // How many member episodes an account unlocks — drives the body copy.
  memberCount: number;
}) {
  const t = useT();

  useEffect(() => {
    // Funnel stage 3, end-of-tier path (the deep-link path is stamped by
    // the token route's 403). Server-side write-once; safe to re-fire.
    void markSignupWallShown(showId);
    return onPostHogReady(() => {
      capturePostHog("signup_wall_shown", {
        show_slug: showSlug,
        episode_number: episodeNumber,
      });
    });
  }, [showId, showSlug, episodeNumber]);

  const watchHref = `/watch/${showSlug}?ep=${encodeURIComponent(targetEpisodeId)}`;

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: TONE_GRADIENT.a }}
      />
      <div
        className="absolute inset-0 opacity-55"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 60% 40%, rgba(255,255,255,0.18), transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,0,0,0.6), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 bg-black/55" />

      {/* "Free episodes watched" chip */}
      <div className="absolute left-1/2 top-[24%] -translate-x-1/2 rounded-full bg-[#ff3d3d]/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white backdrop-blur-md">
        {t.signupWall.freeComplete}
      </div>

      {/* Bottom sheet — safe-area padding mirrors Paywall */}
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-[#0f0f12]/95 pt-3 backdrop-blur-2xl pl-[max(env(safe-area-inset-left),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pt-4 sm:pl-[max(env(safe-area-inset-left),2rem)] sm:pr-[max(env(safe-area-inset-right),2rem)] sm:pb-[max(env(safe-area-inset-bottom),1.75rem)]">
        <div className="mx-auto max-w-2xl text-center">
          <div
            className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20"
            aria-hidden
          />

          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#ff3d3d]">
            {t.signupWall.kicker}
          </p>
          <h2 className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl">
            {showTitle ?? t.signupWall.headlineFallback}
            {episodeLabel ? (
              <span className="ml-2 text-white/55">· {episodeLabel}</span>
            ) : null}
          </h2>
          <p className="mt-2 text-sm font-medium text-white/65">
            {memberCount > 0
              ? t.signupWall.body(memberCount)
              : t.signupWall.bodyNoCount}
          </p>

          <div className="mt-5 flex justify-center">
            <Show when="signed-out">
              <SignUpButton
                mode="modal"
                forceRedirectUrl={watchHref}
                signInForceRedirectUrl={watchHref}
              >
                <button
                  type="button"
                  onClick={() =>
                    capturePostHog("signup_cta_clicked", {
                      auth: "signed_out",
                      wall: "signup",
                    })
                  }
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12] active:scale-[0.98]"
                >
                  <Icon name="play" size={14} color="#ffffff" />
                  <span>{t.signupWall.signUpCta}</span>
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              {/* Race only: a user who signed in in another tab. The member
                  tier is already theirs — send them straight back in. */}
              <a
                href={watchHref}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 active:scale-[0.98]"
              >
                <Icon name="play" size={14} color="#ffffff" />
                <span>{t.signupWall.signUpCta}</span>
              </a>
            </Show>
          </div>

          <Show when="signed-out">
            <p className="mt-3 text-[11px] text-white/55">
              {t.signupWall.alreadyMember}{" "}
              <SignInButton
                mode="modal"
                forceRedirectUrl={watchHref}
                signUpForceRedirectUrl={watchHref}
              >
                <button
                  type="button"
                  className="font-semibold text-white/85 underline underline-offset-2 transition-colors hover:text-white"
                >
                  {t.signupWall.signInLink}
                </button>
              </SignInButton>
            </p>
          </Show>

          <p className="mt-2 text-center text-[10px] text-white/40">
            {t.signupWall.noCardNeeded}
          </p>
        </div>
      </div>
    </div>
  );
}
```

Note the signed-in branch uses a plain `<a>` (full navigation) rather than `next/link` — the watch page must re-render server-side so mode flips from `free` to `member`.

- [ ] **Step 8.2: `Paywall` gains a tier variant**

In `components/watch/paywall.tsx`, add a `variant` prop and use it for the chip text, the body line, and the PostHog property. Signature:

```tsx
export function Paywall({
  showSlug,
  resumeSeconds,
  episodeLabel,
  showTitle,
  variant = "trial",
}: {
  showSlug: string;
  resumeSeconds?: number;
  episodeLabel?: string;
  showTitle?: string;
  // "trial" — legacy 60s preview ended (default; existing call sites
  // unchanged). "tier" — episode-gated show, member tier exhausted or a
  // subscriber-only episode was requested.
  variant?: "trial" | "tier";
}) {
```

The mount event gains the wall property:

```tsx
  useEffect(() => {
    return onPostHogReady(() => {
      capturePostHog("paywall_shown", {
        show_slug: showSlug,
        wall: variant === "tier" ? "subscription" : "trial_end",
      });
    });
  }, [showSlug, variant]);
```

The chip swaps text by variant:

```tsx
        {variant === "tier"
          ? t.paywall.allFreeWatched
          : t.paywall.previewComplete}
```

And the body line under the headline:

```tsx
          <p className="mt-2 text-sm font-medium text-white/65">
            {variant === "tier"
              ? t.paywall.subscribeBody
              : t.paywall.signUpToContinue}
          </p>
```

Everything else (CTA flows, signed-in/out branches, subscribe href) stays — the signed-out CTA still routes through Clerk sign-up to `/subscribe`, which is right for the tier variant too (an anonymous viewer deep-linking past the member tier needs an account before checkout anyway).

- [ ] **Step 8.3: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add components/watch/signup-wall.tsx components/watch/paywall.tsx
git commit -m "feat(watch): SignupWall overlay + tier-variant Paywall"
```

---

### Task 9: Tier-aware player + episodes overlay + watch page

One task because `PlayerEpisode` gains a **required** `tier` field — player, overlay, and the page that constructs the episodes must change together to keep `pnpm typecheck` green at the commit boundary.

**Files:**
- Modify: `components/watch/player.tsx`
- Modify: `components/watch/episodes-overlay.tsx`
- Modify: `app/watch/[showSlug]/page.tsx`

**Important:** `lib/episode-access.ts` is `server-only` — the player (client) CANNOT import it. The player defines its own structural `EpisodeTier` type; the page (server) computes tier values with the lib and passes them down as data.

- [ ] **Step 9.1: `player.tsx` — types, lock helper, new end-state**

Change the `Mode` type and add tier types + helper right above it:

```ts
// Tier of an episode on an episode-gated show, as computed server-side by
// lib/episode-access.ts (which is server-only and can't be imported here —
// this is the structural client-side mirror). Legacy shows pass "free" for
// every episode so nothing ever renders locked.
export type EpisodeTier = "free" | "member" | "subscriber";

type Mode = "subscriber" | "trial" | "free" | "member";

// Whether `mode` may play an episode of `tier`. Subscriber and legacy-trial
// modes never lock (trial gating is the 60s clock, not position).
export function isEpisodeLocked(tier: EpisodeTier, mode: Mode): boolean {
  if (mode === "subscriber" || mode === "trial") return false;
  if (mode === "member") return tier === "subscriber";
  return tier !== "free"; // mode === "free"
}
```

Add to `PlayerEpisode` (after `thumbnailUrl`):

```ts
  // Access tier on episode-gated shows; "free" everywhere on legacy shows.
  tier: EpisodeTier;
```

Extend `EndState` and replace the sync classifier with an async one that reads the 403 body's `reason`:

```ts
type EndState = "paywall" | "signupWall" | "rateLimited" | "unavailable";

// 403s on gated shows carry a reason ("signup_required" /
// "subscribe_required"); legacy trial 403s have none and keep mapping to
// the trial paywall. Body parse failures fall back the same way.
async function classifyTokenFailure(r: Response): Promise<EndState> {
  if (r.status === 429) return "rateLimited";
  if (r.status === 403) {
    try {
      const body = (await r.json()) as { reason?: unknown };
      if (body.reason === "signup_required") return "signupWall";
    } catch {
      // fall through
    }
    return "paywall";
  }
  return "unavailable";
}
```

Delete the old `classifyTokenStatus` function entirely (both call sites are replaced below).

Add the dynamic import for the wall next to the existing `Paywall` one:

```ts
const SignupWall = dynamic(
  () => import("./signup-wall").then((m) => m.SignupWall),
  { ssr: false },
);
```

- [ ] **Step 9.2: `player.tsx` — `EpisodePlayback` derived values + gates**

Inside `EpisodePlayback`, right after `const episodeLabel = ...`, add:

```ts
  // 1-based position of the current episode in the playable ordering —
  // matches the server's position semantics for funnel events.
  const currentPosition = episodes.findIndex((e) => e.id === current.id) + 1;
  // Whether the current episode is above this viewer's tier. All wall
  // triggers (deep link, episodes-overlay tap, auto-advance into a locked
  // episode) funnel through here: swapping to a locked episode remounts
  // this component, which renders the wall full-surface instead of
  // fetching a token.
  const currentLocked = isEpisodeLocked(current.tier, mode);
  const firstMemberEpisode = episodes.find((e) => e.tier === "member") ?? null;
  const memberCount = episodes.filter((e) => e.tier === "member").length;
  // free/member episode-start funnel events fire once per episode mount.
  const tierStartFiredRef = useRef(false);
```

Change the play-gate initializer — members behave like subscribers (no gate, no clock to protect):

```ts
  const [started, setStarted] = useState(
    mode === "subscriber" || mode === "member",
  );
```

- [ ] **Step 9.3: `player.tsx` — token fetch effect**

In the token-fetch effect: gate on the lock, classify failures via the new helper, and fire the tier start events. The effect's first lines become:

```ts
  useEffect(() => {
    if (!started || currentLocked) return;
```

Replace `setEndState(classifyTokenStatus(r.status));` with:

```ts
          setEndState(await classifyTokenFailure(r));
```

After the existing `if (data.mode === "trial") onTrialStart();` line add:

```ts
          if (
            (data.mode === "free" || data.mode === "member") &&
            !tierStartFiredRef.current
          ) {
            tierStartFiredRef.current = true;
            capturePostHog(
              data.mode === "free"
                ? "free_episode_started"
                : "member_episode_started",
              { show_slug: showSlug, episode_number: currentPosition },
            );
          }
```

Update the effect's dependency array to `[current.id, fetchKey, onTrialStart, started, currentLocked, showSlug, currentPosition]`.

In the refresh effect further down, replace `setEndState(classifyTokenStatus(r.status));` (inside the `if (r.status >= 400 && r.status < 500)` branch) with `setEndState(await classifyTokenFailure(r));`. The "short-lived token ⇒ trial" branch (`if (mode !== "trial") return;`) needs no change — free/member tokens are 1h and use the subscriber refresh path.

- [ ] **Step 9.4: `player.tsx` — progress saves route by mode**

In the save-progress effect's `flush()` and in `onEnded`, the trial path widens to free mode. Both occurrences of:

```ts
        if (mode === "trial") {
          void saveTrialPosition(current.id, t).catch(() => {});
        } else {
          void saveWatchProgress(current.id, t, false).catch(() => {});
        }
```

become (`completed` stays `true` in the `onEnded` copy):

```ts
        if (mode === "trial" || mode === "free") {
          void saveTrialPosition(current.id, t).catch(() => {});
        } else {
          void saveWatchProgress(current.id, t, false).catch(() => {});
        }
```

- [ ] **Step 9.5: `player.tsx` — `onEnded` advances into walls**

Replace the `onEnded` handler's tail (after the save block) with:

```ts
          if (next) {
            if (isEpisodeLocked(next.tier, mode)) {
              // Auto-advance into the locked episode: the swap remounts the
              // inner player which renders the right wall full-surface, and
              // ?ep=<locked id> lands in the URL so the post-signup redirect
              // resumes exactly there. No up-next countdown into a wall.
              onSwap(next.id);
            } else {
              onOverlayChange("upnext");
            }
          } else if (mode === "subscriber") {
            // (existing comment block stays)
            onOverlayChange("seriesEnd");
          } else if (mode === "member") {
            // End of the member tier and nothing beyond is published yet —
            // this IS the subscription paywall moment for members.
            setEndState("paywall");
          } else if (mode === "free") {
            // free_episodes covers every ready episode (member tier empty
            // until more publish) — still pitch the account.
            setEndState("signupWall");
          }
```

- [ ] **Step 9.6: `player.tsx` — render walls**

Replace the `endState === "paywall"` render branch with a version that also covers the lock-based renders. Put this block where the current `if (endState === "paywall")` sits:

```tsx
  // Wall renders. Lock-based (currentLocked) covers deep links, overlay
  // taps, and auto-advance; endState covers server 403s and natural
  // end-of-tier transitions. Both resolve to the same two surfaces.
  const signupWallTarget = currentLocked
    ? current
    : (firstMemberEpisode ?? current);
  if (
    endState === "signupWall" ||
    (currentLocked && mode === "free" && current.tier === "member")
  ) {
    return (
      <SignupWall
        showSlug={showSlug}
        showId={showId}
        showTitle={showTitle}
        episodeLabel={`S${signupWallTarget.seasonNumber}·E${signupWallTarget.number}`}
        targetEpisodeId={signupWallTarget.id}
        episodeNumber={
          episodes.findIndex((e) => e.id === signupWallTarget.id) + 1
        }
        memberCount={memberCount}
      />
    );
  }

  if (endState === "paywall" || currentLocked) {
    return (
      <Paywall
        showSlug={showSlug}
        resumeSeconds={lastSaved || undefined}
        showTitle={showTitle}
        episodeLabel={episodeLabel}
        variant={mode === "free" || mode === "member" ? "tier" : "trial"}
      />
    );
  }
```

(The `rateLimited` / `unavailable` branches below stay as they are.)

- [ ] **Step 9.7: `player.tsx` — play-gate label + autoplay for free mode**

In the `!started` poster gate, the label line becomes mode-aware:

```tsx
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/80">
            {mode === "free" ? t.player.playFreeEpisode : t.player.playPreview}
          </span>
```

And `<MuxVideo>`'s `autoPlay` widens (the token fetch is still a direct response to the play tap in both modes):

```tsx
        autoPlay={mode === "trial" || mode === "free"}
```

Finally, pass `mode` through to the episodes overlay render:

```tsx
        <EpisodesOverlay
          episodes={episodes}
          currentEpisodeId={current.id}
          showSlug={showSlug}
          mode={mode}
          onSelect={onSwap}
          onClose={() => onOverlayChange("none")}
        />
```

Export the `Mode` type so the overlay can type the prop: change `type Mode = ...` to `export type Mode = ...`.

- [ ] **Step 9.8: `episodes-overlay.tsx` — lock badges**

Update the import and props:

```ts
import { isEpisodeLocked, type Mode, type PlayerEpisode } from "./player";
```

Add `mode: Mode;` to the props type and destructure it. Inside the episode map, right after `const isCurrent = ...`, add:

```ts
                    const locked = isEpisodeLocked(ep.tier, mode);
```

Replace the duration `<span>` (the one rendering `t.episodesOverlay.minutes(minutes)`) with a lock-aware version:

```tsx
                              <span className="shrink-0 font-mono text-[11px] text-white/55">
                                {locked ? (
                                  <span
                                    aria-label={t.episodesOverlay.lockedAria}
                                    className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/70"
                                  >
                                    <Icon name="lock" size={10} />
                                    {ep.tier === "member"
                                      ? t.episodesOverlay.lockedSignup
                                      : t.episodesOverlay.lockedSubscribe}
                                  </span>
                                ) : minutes ? (
                                  t.episodesOverlay.minutes(minutes)
                                ) : (
                                  ""
                                )}
                              </span>
```

And swap the thumbnail's center icon for locked episodes (the `Icon name={isCurrent ? "pause" : "play"}` line):

```tsx
                                <Icon
                                  name={locked ? "lock" : isCurrent ? "pause" : "play"}
                                  size={12}
                                  color="#ffffff"
                                />
```

Tapping a locked row still calls `onSelect(ep.id)` — the swap remounts the inner player which renders the wall (Step 9.6). No extra handler needed.

- [ ] **Step 9.9: `app/watch/[showSlug]/page.tsx` — imports + tier computation**

Add imports:

```ts
import { CompleteRegistrationPixel } from "@/components/site/complete-registration-pixel";
import { getOrSyncCurrentUser } from "@/lib/admin";
import { readAttributionCookies } from "@/lib/attribution";
import { getShowGating, tierForPosition } from "@/lib/episode-access";
import { linkTrialSessionsToCurrentUser } from "@/lib/trial";
```

(`linkTrialSessionsToCurrentUser` joins the existing `TRIAL_COOKIE, findTrialSession, isTrialActive` import from `@/lib/trial`.)

After the `ordered` array is built (and before `playable`), compute gating + positions. Position is taken on `ordered` (all ready episodes, pre-playbackId-filter) so it matches `getOrderedReadyEpisodeIds` in the token route exactly:

```ts
  const gating = getShowGating(show);
  const positionById = new Map(ordered.map((e, i) => [e.id, i + 1]));
```

In the `playable` map's returned object, add the tier field (after `thumbnailUrl`):

```ts
        tier: gating.gated
          ? tierForPosition(positionById.get(e.id)!, gating)
          : ("free" as const),
```

- [ ] **Step 9.10: `app/watch/[showSlug]/page.tsx` — member resume reads**

The watch-progress resume block currently runs `if (userId && isSubscriber)`. Widen it so signed-in members on gated shows resume too:

```ts
  if (userId && (isSubscriber || gating.gated)) {
```

(Everything inside stays; `saveWatchProgress` was widened in Task 5, so member rows exist to read.)

- [ ] **Step 9.11: `app/watch/[showSlug]/page.tsx` — gated-show branches**

Directly after the existing `if (isSubscriber) { ... return ... }` block, insert the gated branch (the legacy trial code below it stays untouched and is now only reached by non-gated shows):

```tsx
  // Episode-gated show: positional tiers instead of the 60s clock. No
  // expired-trial redirect here — gated sessions never expire; the walls
  // are positional and rendered by the player.
  if (gating.gated) {
    if (userId) {
      // Members (signed-in non-subscribers). Freshly signed-up users land
      // here straight from the wall's redirect, so do what /subscribe does:
      // sync the Clerk mirror first (the user.created webhook may lag),
      // then link their anonymous session rows — funnel stage 4 depends on
      // this link existing.
      await getOrSyncCurrentUser();
      await linkTrialSessionsToCurrentUser();

      // Signup-completion events (Meta Lead/CompleteRegistration + PostHog
      // signup_completed) historically fired on /subscribe; this flow
      // returns users here instead. Same deduped component + same
      // localStorage flag → no double-fires for users who saw /subscribe.
      const { first: firstTouch } = await readAttributionCookies();
      const signupUtm: Record<string, string> = {};
      if (firstTouch.source) signupUtm.utm_source = firstTouch.source;
      if (firstTouch.medium) signupUtm.utm_medium = firstTouch.medium;
      if (firstTouch.campaign) signupUtm.utm_campaign = firstTouch.campaign;

      return (
        <WatchShell>
          <CompleteRegistrationPixel userId={userId} utm={signupUtm} />
          <Player
            mode="member"
            showId={show.id}
            showSlug={show.slug}
            showTitle={show.title}
            episodes={playable}
            initialEpisodeId={initial.id}
            resumeSeconds={queryResume ?? resumeFromProgress}
            userEmail={userEmail}
          />
        </WatchShell>
      );
    }

    // Anonymous viewer: free tier. Resume from the session row — last
    // episode watched (when no explicit ?ep= deep link) at its last
    // position.
    const freeSessionToken =
      (await cookies()).get(TRIAL_COOKIE)?.value ?? null;
    const freeSession = freeSessionToken
      ? await findTrialSession(freeSessionToken, show.id)
      : null;

    let freeInitial = initial;
    if (!epParam && freeSession?.lastEpisodeId) {
      const last = playable.find((e) => e.id === freeSession.lastEpisodeId);
      if (last) freeInitial = last;
    }
    const freeResume =
      freeSession &&
      freeSession.lastEpisodeId === freeInitial.id &&
      freeSession.lastPositionSeconds > 0
        ? freeSession.lastPositionSeconds
        : null;

    return (
      <WatchShell>
        <Player
          mode="free"
          showId={show.id}
          showSlug={show.slug}
          showTitle={show.title}
          episodes={playable}
          initialEpisodeId={freeInitial.id}
          resumeSeconds={queryResume ?? freeResume}
          userEmail={userEmail}
        />
      </WatchShell>
    );
  }
```

Note `queryResume` is declared just above the `isSubscriber` return in the current file — confirm it stays ABOVE this inserted block (it does if you insert directly after the subscriber `return`'s closing brace).

- [ ] **Step 9.12: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: pass. The likely failure is a missed `tier` on `PlayerEpisode` construction or the `Mode` export — fix in place.

- [ ] **Step 9.13: Manual smoke — legacy show regression**

Run `pnpm dev`. Visit `/watch/quedate-conmigo` in a private window: poster play-gate ("Ver 60 s gratis") → 60s preview → paywall, exactly as before. Gated behavior can't be exercised until the admin form (next task) sets One look to 10/2.

- [ ] **Step 9.14: Commit**

```bash
git add components/watch/player.tsx components/watch/episodes-overlay.tsx "app/watch/[showSlug]/page.tsx"
git commit -m "feat(watch): tier-aware player, lock badges, free/member modes"
```

---

### Task 10: Admin — gating fields on the show form

**Files:**
- Modify: `components/admin/show-form.tsx`
- Modify: `app/admin/actions.ts`
- Modify: `app/admin/shows/[id]/page.tsx`

- [ ] **Step 10.1: `show-form.tsx` — values type + panel**

Add to `ShowFormValues` (after `popularNow`):

```ts
  freeEpisodes: string;
  memberEpisodes: string;
```

Add to `EMPTY_SHOW_FORM`:

```ts
  freeEpisodes: "0",
  memberEpisodes: "0",
```

Insert a new `Panel` between the "Visibility" panel and `<SaveBar ...>`:

```tsx
      <Panel
        kicker="Free preview"
        title="Episode-gated free tier"
        hint="0 / 0 keeps the default 60-second preview. Setting Free episodes switches this show to episode gating: the first N episodes play in full for everyone, the next M need a (free) account, everything beyond needs a subscription."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Free episodes"
            htmlFor="freeEpisodes"
            hint="First N episodes — anyone can watch, no account."
          >
            <Input
              id="freeEpisodes"
              name="freeEpisodes"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={defaultValues.freeEpisodes}
            />
          </Field>
          <Field
            label="Member episodes"
            htmlFor="memberEpisodes"
            hint="Next M episodes — any signed-in user, no subscription."
          >
            <Input
              id="memberEpisodes"
              name="memberEpisodes"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={defaultValues.memberEpisodes}
            />
          </Field>
        </div>
      </Panel>
```

- [ ] **Step 10.2: `app/admin/actions.ts` — parse + persist**

Add a small parser next to the existing `num()` helper:

```ts
// Episode-gating counts: blank/invalid → 0; floats truncated; negatives
// rejected to 0. Admin-only surface, so friendly coercion over erroring.
function gatingCount(formData: FormData, key: string): number {
  const n = num(formData, key);
  if (n === null || n < 0) return 0;
  return Math.floor(n);
}
```

In `createShow`, add to the `values: NewShow` object:

```ts
    freeEpisodes: gatingCount(formData, "freeEpisodes"),
    memberEpisodes: gatingCount(formData, "memberEpisodes"),
```

In `updateShow`, add the same two lines to the `.set({ ... })` object.

- [ ] **Step 10.3: `app/admin/shows/[id]/page.tsx` — form defaults**

In the `defaultValues={{ ... }}` object passed to `<ShowForm>`, add:

```ts
          freeEpisodes: String(show.freeEpisodes),
          memberEpisodes: String(show.memberEpisodes),
```

- [ ] **Step 10.4: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add components/admin/show-form.tsx app/admin/actions.ts "app/admin/shows/[id]/page.tsx"
git commit -m "feat(admin): per-show episode-gating fields"
```

---

### Task 11: Admin analytics — "Episode funnel" section

**Files:**
- Modify: `lib/admin-analytics.ts`
- Modify: `app/admin/analytics/page.tsx`

- [ ] **Step 11.1: `lib/admin-analytics.ts` — add `loadEpisodeFunnels`**

Add `asc` and `inArray` to the existing `drizzle-orm` import. Then append at the end of the file:

```ts
// ---- episode-gated funnel (per gated show) ---------------------------------

export type EpisodeFunnel = {
  showSlug: string;
  showTitle: string;
  freeCount: number;
  memberCount: number;
  // Stages (counts of kind='episodes' sessions started in range, except
  // member stages which count linked users):
  started: number;        // 1. sessions that started a free episode
  wallHit: number;        // 2. signup_wall_at set OR furthest >= freeCount
  signedUp: number;       // 3. stage-2 sessions linked to a user
  memberWatchers: number; // 4. linked users with progress on any member ep
  paywallHit: number;     // 5. linked users who completed the last member ep
  subscribed: number;     // 6. sessions marked converted
  // Free-tier depth distribution: sessions whose furthest position reached
  // at least N, for N = 1..freeCount (cumulative, monotonically falling).
  depth: { label: string; n: number }[];
  // Per-member-episode reach among linked funnel users.
  memberEpisodes: { label: string; viewers: number; completed: number }[];
};

// One funnel per gated show (free_episodes + member_episodes > 0), scoped to
// the dashboard's date range via trial_sessions.started_at and respecting the
// show filter. Computed from our own tables — no consent blind spot (PostHog
// only sees consenting browsers; these rows exist for every viewer).
export async function loadEpisodeFunnels(
  f: AnalyticsFilters,
): Promise<EpisodeFunnel[]> {
  const gatedShows = await db
    .select({
      id: shows.id,
      slug: shows.slug,
      title: shows.title,
      freeEpisodes: shows.freeEpisodes,
      memberEpisodes: shows.memberEpisodes,
    })
    .from(shows)
    .where(
      and(
        isNull(shows.deletedAt),
        sql`${shows.freeEpisodes} + ${shows.memberEpisodes} > 0`,
      ),
    )
    .orderBy(shows.title);

  const scoped =
    f.show === "all"
      ? gatedShows
      : gatedShows.filter((s) => s.slug === f.show);
  if (scoped.length === 0) return [];

  const out: EpisodeFunnel[] = [];
  // Sequential per show is fine — gated shows are a handful at most, and
  // each iteration already parallelizes its own queries.
  for (const s of scoped) {
    const freeCount = Math.max(0, s.freeEpisodes);
    const memberCount = Math.max(0, s.memberEpisodes);

    const sessionConds: SQL[] = [
      eq(trialSessions.showId, s.id),
      eq(trialSessions.kind, "episodes"),
      gte(trialSessions.startedAt, f.from),
      lte(trialSessions.startedAt, f.to),
    ];
    // Users this funnel produced — sessions in range that got linked on
    // signup. Reused as a subquery by every member-tier stage.
    const linkedUsers = db
      .select({ userId: trialSessions.userId })
      .from(trialSessions)
      .where(and(...sessionConds, sql`${trialSessions.userId} IS NOT NULL`));

    // Ready ordering with display fields — positions must match
    // lib/episode-access.ts (season number, then episode number).
    const orderedEps = await db
      .select({
        id: episodes.id,
        title: episodes.title,
        number: episodes.number,
        seasonNumber: seasons.number,
      })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(and(eq(seasons.showId, s.id), eq(episodes.status, "ready")))
      .orderBy(asc(seasons.number), asc(episodes.number));
    const memberEps = orderedEps.slice(freeCount, freeCount + memberCount);
    const memberEpIds = memberEps.map((e) => e.id);
    const lastMemberEp = memberEps.length > 0 ? memberEps[memberEps.length - 1] : null;

    const [aggRows, depthRows, perEpisodeRows, memberWatchersRows, paywallRows] =
      await Promise.all([
        db
          .select({
            started: count(),
            wallHit: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.signupWallAt} IS NOT NULL OR ${trialSessions.furthestEpisodeNumber} >= ${freeCount})::int`,
            signedUp: sql<number>`COUNT(*) FILTER (WHERE (${trialSessions.signupWallAt} IS NOT NULL OR ${trialSessions.furthestEpisodeNumber} >= ${freeCount}) AND ${trialSessions.userId} IS NOT NULL)::int`,
            subscribed: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.converted})::int`,
          })
          .from(trialSessions)
          .where(and(...sessionConds)),
        db
          .select({
            furthest: trialSessions.furthestEpisodeNumber,
            n: count(),
          })
          .from(trialSessions)
          .where(and(...sessionConds))
          .groupBy(trialSessions.furthestEpisodeNumber),
        memberEpIds.length > 0
          ? db
              .select({
                episodeId: watchProgress.episodeId,
                viewers: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
                completed: sql<number>`COUNT(*) FILTER (WHERE ${watchProgress.completed})::int`,
              })
              .from(watchProgress)
              .where(
                and(
                  inArray(watchProgress.episodeId, memberEpIds),
                  inArray(watchProgress.userId, linkedUsers),
                ),
              )
              .groupBy(watchProgress.episodeId)
          : Promise.resolve([]),
        memberEpIds.length > 0
          ? db
              .select({
                n: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
              })
              .from(watchProgress)
              .where(
                and(
                  inArray(watchProgress.episodeId, memberEpIds),
                  inArray(watchProgress.userId, linkedUsers),
                ),
              )
          : Promise.resolve([{ n: 0 }]),
        lastMemberEp
          ? db
              .select({
                n: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
              })
              .from(watchProgress)
              .where(
                and(
                  eq(watchProgress.episodeId, lastMemberEp.id),
                  eq(watchProgress.completed, true),
                  inArray(watchProgress.userId, linkedUsers),
                ),
              )
          : Promise.resolve([{ n: 0 }]),
      ]);

    // Cumulative depth: sessions whose furthest position >= N.
    const depthCounts = depthRows.map((r) => ({
      furthest: Number(r.furthest),
      n: Number(r.n),
    }));
    const depth = Array.from({ length: freeCount }, (_, i) => {
      const pos = i + 1;
      const reached = depthCounts.reduce(
        (acc, r) => (r.furthest >= pos ? acc + r.n : acc),
        0,
      );
      return { label: `E${pos}`, n: reached };
    });

    const perEpisode = new Map(
      perEpisodeRows.map((r) => [r.episodeId, r]),
    );
    const memberEpisodes = memberEps.map((e) => {
      const r = perEpisode.get(e.id);
      return {
        label: `S${e.seasonNumber}·E${e.number} ${e.title}`,
        viewers: r ? Number(r.viewers) : 0,
        completed: r ? Number(r.completed) : 0,
      };
    });

    const agg = aggRows[0];
    out.push({
      showSlug: s.slug,
      showTitle: s.title,
      freeCount,
      memberCount,
      started: Number(agg.started),
      wallHit: Number(agg.wallHit),
      signedUp: Number(agg.signedUp),
      memberWatchers: Number(memberWatchersRows[0]?.n ?? 0),
      paywallHit: Number(paywallRows[0]?.n ?? 0),
      subscribed: Number(agg.subscribed),
      depth,
      memberEpisodes,
    });
  }
  return out;
}
```

- [ ] **Step 11.2: `app/admin/analytics/page.tsx` — render the section**

Add to the imports from `@/lib/admin-analytics`: `loadEpisodeFunnels` (and the `EpisodeFunnel` type if you extract a sub-component). Change the data load to run both in parallel:

```ts
  const [d, episodeFunnels] = await Promise.all([
    loadDashboard(filters),
    loadEpisodeFunnels(filters),
  ]);
```

(replacing `const d = await loadDashboard(filters);`). Then insert the section AFTER the "Acquisition funnel + status mix" grid and BEFORE the "Trend" section — it renders nothing when no show is gated:

```tsx
      {/* Episode-gated funnels (one card per gated show) */}
      {episodeFunnels.map((ef) => (
        <Section
          key={ef.showSlug}
          title={`Episode funnel · ${ef.showTitle}`}
          hint={`${ef.freeCount} free + ${ef.memberCount} member episodes · ${rangeLabel}`}
        >
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div>
              <FunnelChart
                steps={[
                  {
                    label: "Started watching free",
                    value: ef.started,
                    hint: "Anonymous sessions that played a free episode in range",
                  },
                  {
                    label: "Hit sign-up wall",
                    value: ef.wallHit,
                    hint: "Wall shown, or reached the end of the free tier",
                  },
                  {
                    label: "Signed up",
                    value: ef.signedUp,
                    hint: "Wall-stage sessions linked to a user account",
                  },
                  {
                    label: "Watched member episodes",
                    value: ef.memberWatchers,
                    hint: "Linked users with progress on any member episode",
                  },
                  {
                    label: "Hit subscription paywall",
                    value: ef.paywallHit,
                    hint: "Linked users who completed the last member episode",
                  },
                  {
                    label: "Subscribed",
                    value: ef.subscribed,
                    hint: "Funnel sessions marked converted by the Stripe webhook",
                  },
                ]}
              />
              {ef.memberEpisodes.length > 0 ? (
                <div className="mt-5">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-white/45">
                    Member episodes · linked users
                  </p>
                  <BarList
                    items={ef.memberEpisodes.map((m) => ({
                      label: m.label,
                      value: m.viewers,
                      sub: `${m.completed} completed`,
                    }))}
                    format={(n) =>
                      `${n.toLocaleString()} viewer${n === 1 ? "" : "s"}`
                    }
                    emptyLabel="No member-episode views yet."
                  />
                </div>
              ) : null}
            </div>
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-white/45">
                Free-tier depth · sessions reaching episode N
              </p>
              <Histogram bars={ef.depth} />
              <p className="mt-3 text-[10px] leading-relaxed text-white/35">
                Depth is the furthest episode position a session started
                (write-monotonic), not completion. Sign-up linking uses the
                trial cookie with an IP-bucket fallback, so &ldquo;signed
                up&rdquo; can slightly over-attribute on shared networks.
              </p>
            </div>
          </div>
        </Section>
      ))}
```

- [ ] **Step 11.3: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint` — expected: pass.

```bash
git add lib/admin-analytics.ts app/admin/analytics/page.tsx
git commit -m "feat(analytics): episode-gated funnel section on the admin dashboard"
```

---

### Task 12: Document the business rule

**Files:**
- Modify: `CLAUDE.md`

> **Caution:** `CLAUDE.md` (and `docs/*.md`) may carry pre-existing uncommitted edits from the user's earlier doc-sync work. Run `git diff CLAUDE.md` first; if unrelated hunks exist, stage only this feature's hunk (`git add -p CLAUDE.md`) or ask the user before committing.

- [ ] **Step 12.1: Add the business-rule bullet**

In `CLAUDE.md` under **Key business rules**, directly after the existing **Trial** bullet, add:

```markdown
- **Episode-gated free tier**: shows with `free_episodes > 0` (admin show form; One look = 10 free + 2 member) replace the 60s trial with positional gating — an episode's 1-based position in the ready ordering (season number, then episode number; `lib/episode-access.ts`) decides its tier: `free` (anyone, full episode, 1h auto-refreshing token), `member` (any signed-in user), `subscriber` (beyond). `/api/playback-token` enforces; gated 403s carry `reason: "signup_required" | "subscribe_required"` and the player routes them to `SignupWall` (Clerk sign-up redirecting BACK to `/watch/<slug>?ep=<locked ep>`) or the tier-variant `Paywall`. Anonymous tracking reuses `trial_sessions` with `kind='episodes'` (+ `furthest_episode_number`, `last_episode_id`, `signup_wall_at`) — same cookie, attribution snapshot, signup linking, and `converted` flag as the legacy trial; the per-(IP, show) rate limit only degrades tracking on gated shows, never playback. Signup-completion events (Meta Lead + PostHog) also mount on the watch page since the wall's redirect skips `/subscribe`. Admin analytics renders a per-show "Episode funnel" (`loadEpisodeFunnels`). Legacy 60s trial is untouched for shows at 0/0.
```

- [ ] **Step 12.2: Commit**

```bash
git diff CLAUDE.md   # review for unrelated pre-existing hunks first
git add CLAUDE.md
git commit -m "docs: episode-gated free tier business rule"
```

---

### Task 13: Full verification + rollout

- [ ] **Step 13.1: Static gates**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all pass. (Build needs the usual `.env.local`; if the pnpm store acts up with bad-package.json/MODULE_NOT_FOUND errors, run `pnpm install --force` — known shared-store issue on this machine.)

- [ ] **Step 13.2: Configure gating in the admin**

`pnpm dev` → `/admin/shows/<one-look id>` → set Free episodes = 10, Member episodes = 2 → Save. (Dev DB only; prod happens in 13.4.)

- [ ] **Step 13.3: Manual end-to-end recipes**

In a **private window** (anonymous):
1. `/watch/one-look` → poster gate says "Ver gratis" (not "Ver 60 s gratis") → play → episode 1 plays FULL length, no 60s paywall. DB: `trial_sessions` row with `kind='episodes'`, `furthest_episode_number=1`.
2. Episodes overlay → episodes 11–12 show "Crea una cuenta" lock chips; deep-link `?ep=<ep11 id>` → SignupWall renders, no token request fired (check Network tab), `signup_wall_at` stamped (token-route 403 path: hit `/api/playback-token?episode_id=<ep11 id>` directly → 403 `{"reason":"signup_required"}`).
3. Skip to near the end of ep 10 (seek) → let it end → SignupWall (not up-next). URL carries `?ep=<ep11 id>`.
4. Sign up from the wall → lands back on `/watch/one-look?ep=<ep11 id>` → ep 11 plays full. DB: session row `user_id` linked. `Lead`/`signup_completed` fire once (PostHog/Pixel debug — requires marketing consent accepted).
5. Finish ep 12 → tier-variant Paywall ("Episodios gratis completados", CTA → `/subscribe`). Deep-link past member tier (publish a 13th episode in dev, or temporarily set member=1 and hit ep 12) → 403 `{"reason":"subscribe_required"}` → Paywall.
6. Legacy regression: `/watch/quedate-conmigo` (fresh private window) → 60s preview → trial paywall; 4th preview attempt within the hour from one IP → RateLimitedNotice (429).
7. Subscriber regression: as the test subscriber account, every episode of both shows plays; no walls, no lock chips.
8. `/admin/analytics` → "Episode funnel · One look" card shows the session from steps 1–5 moving through stages; depth histogram has E1..E10 bars.

- [ ] **Step 13.4: Production rollout (in order)**

1. Migrate prod Neon: with the PROD `DATABASE_URL`, run `pnpm db:migrate` (columns are additive with defaults — old code keeps working; safe to migrate before deploy).
2. Deploy: `vercel --prod --yes` (GitHub auto-deploy is NOT wired). Then `git push origin main` for source backup.
3. In prod `/admin`, set One look to 10/2 — this is the feature flag; rollback = set 0/0.
4. PostHog (manual, no code): extend the "Ads funnel" dashboard with the new events (`free_episode_started` → `signup_wall_shown` → `signup_completed` → `member_episode_started` → `paywall_shown[wall=subscription]` → `subscribe_succeeded`), normalized-UTM breakdowns as in docs/posthog-funnel.md.

- [ ] **Step 13.5: Final commit (any stragglers) + report**

Report the verification results honestly — if any recipe step failed, say which and stop; do not claim success without having run the steps.





