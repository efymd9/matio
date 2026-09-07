import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The "continue watching" resolver behind the web home page AND the app's
// GET /api/v1/continue. The query builder is faked to a recording chain so
// the test can read the WHERE clause the helper issues — "published shows
// only" is a filter, and a filter is only proven by looking at it — and the
// rows it returns drive the collapse rules the rail depends on.
const h = vi.hoisted(() => ({
  userId: null as string | null,
  cookie: undefined as string | undefined,
  rows: [] as Record<string, unknown>[],
  // Rows of the second query — the silent continuations of branch rows
  // (episode_choices joined to the target episode).
  choiceRows: [] as Record<string, unknown>[],
  from: [] as unknown[],
  where: [] as unknown[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined) }),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => {
      // The continuation query ends at .where(); the candidate queries go
      // on to .orderBy().limit(). Dispatch on the table `from` names.
      const choiceChain = {
        innerJoin: () => choiceChain,
        where: async (clause: unknown) => {
          h.where.push(clause);
          return h.choiceRows;
        },
      };
      const chain = {
        from: (table: unknown) => {
          h.from.push(table);
          return (table as { table?: string }).table === "episode_choices"
            ? choiceChain
            : chain;
        },
        innerJoin: () => chain,
        where: (clause: unknown) => {
          h.where.push(clause);
          return chain;
        },
        orderBy: () => chain,
        limit: async () => h.rows,
      };
      return chain;
    },
  },
}));
vi.mock("@/db/schema", () => ({
  episodes: {
    id: "episodes.id",
    status: "episodes.status",
    seasonId: "episodes.season_id",
    number: "episodes.number",
    title: "episodes.title",
    durationSeconds: "episodes.duration_seconds",
    branchOfEpisodeId: "episodes.branch_of_episode_id",
  },
  episodeChoices: {
    table: "episode_choices",
    fromEpisodeId: "episode_choices.from_episode_id",
    toEpisodeId: "episode_choices.to_episode_id",
  },
  seasons: { id: "seasons.id", showId: "seasons.show_id" },
  shows: { id: "shows.id", status: "shows.status", deletedAt: "shows.deleted_at" },
  trialSessions: {
    table: "trial_sessions",
    sessionToken: "trial_sessions.session_token",
    lastEpisodeId: "trial_sessions.last_episode_id",
  },
  watchProgress: { table: "watch_progress", userId: "watch_progress.user_id" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: (column: unknown, values: unknown) => ({ inArray: [column, values] }),
  isNull: (column: unknown) => ({ isNull: column }),
  isNotNull: (column: unknown) => ({ isNotNull: column }),
  desc: () => undefined,
  sql: () => undefined,
}));
vi.mock("@/lib/trial", () => ({ TRIAL_COOKIE: "trial_session" }));

import {
  episodeChoices,
  episodes,
  shows,
  trialSessions,
  watchProgress,
} from "@/db/schema";
import { getContinueWatching } from "./continue-watching";

function row(overrides: Record<string, unknown> = {}) {
  return {
    slug: "the-scarlet-oath",
    title: "The Scarlet Oath",
    orientation: "vertical",
    heroImageUrl: "/shows/legacy-hero.png",
    posterImageUrl: null,
    episodeId: "ep-2",
    episodeNumber: 2,
    episodeTitle: "Second oath",
    positionSeconds: 120,
    durationSeconds: 600,
    completed: false,
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    branchOfEpisodeId: null,
    ...overrides,
  };
}

// A finished branch (#143) — the latest row of the show is episode 901,
// reachable only through the fork on episode 2.
function branchRow(overrides: Record<string, unknown> = {}) {
  return row({
    episodeId: "b-901",
    episodeNumber: 901,
    episodeTitle: "She hugs him",
    positionSeconds: 600,
    durationSeconds: 600,
    completed: true,
    branchOfEpisodeId: "ep-2",
    ...overrides,
  });
}

function continuation(overrides: Record<string, unknown> = {}) {
  return {
    fromEpisodeId: "b-901",
    episodeId: "ep-3",
    episodeNumber: 3,
    episodeTitle: "Third oath",
    durationSeconds: 720,
    ...overrides,
  };
}

beforeEach(() => {
  h.userId = "user_1";
  h.cookie = undefined;
  h.rows = [];
  h.choiceRows = [];
  h.from = [];
  h.where = [];
});

describe("getContinueWatching — signed in", () => {
  it("reads the user's own progress on published shows and ready episodes only", async () => {
    h.rows = [row()];
    await getContinueWatching();

    expect(h.from).toEqual([watchProgress]);
    const [clause] = h.where as unknown[][];
    expect(clause).toContainEqual({ eq: [watchProgress.userId, "user_1"] });
    expect(clause).toContainEqual({ eq: [shows.status, "published"] });
    expect(clause).toContainEqual({ isNull: shows.deletedAt });
    expect(clause).toContainEqual({ eq: [episodes.status, "ready"] });
  });

  it("carries the resume target, duration, episode title and orientation on the tile", async () => {
    h.rows = [row()];
    const [item] = await getContinueWatching();

    expect(item).toMatchObject({
      show: { slug: "the-scarlet-oath", title: "The Scarlet Oath", orientation: "vertical" },
      episodeId: "ep-2",
      episodeNumber: 2,
      episodeTitle: "Second oath",
      positionSeconds: 120,
      durationSeconds: 600,
      fraction: 0.2,
    });
    expect(item.updatedAt).toEqual(new Date("2026-09-01T10:00:00Z"));
  });

  it("keeps one tile per show — the most recently touched row", async () => {
    h.rows = [
      row({ episodeId: "ep-3", episodeNumber: 3, positionSeconds: 60 }),
      row({ episodeId: "ep-2", episodeNumber: 2, positionSeconds: 300 }),
      row({ slug: "other", title: "Other", episodeId: "o-1", episodeNumber: 1 }),
    ];
    const items = await getContinueWatching();

    expect(items.map((i) => i.episodeId)).toEqual(["ep-3", "o-1"]);
  });

  it("drops a finished show instead of resurfacing an older episode of it", async () => {
    h.rows = [
      row({ episodeId: "ep-3", completed: true }),
      row({ episodeId: "ep-2", completed: false, positionSeconds: 100 }),
    ];
    expect(await getContinueWatching()).toEqual([]);
  });

  it("treats ≥95% watched as finished even without the completed flag", async () => {
    h.rows = [row({ positionSeconds: 590, durationSeconds: 600 })];
    expect(await getContinueWatching()).toEqual([]);
  });

  it("shows nothing for an episode whose duration is still unknown", async () => {
    // Without a duration there is no fraction to draw, and a bare position
    // would be a progress bar with no end.
    h.rows = [row({ durationSeconds: null })];
    expect(await getContinueWatching()).toEqual([]);
  });

  it("clamps the fraction to [0, 1]", async () => {
    // A playhead past the end that is somehow under 95%: only reachable with
    // a bad duration, but the bar must still never overflow.
    h.rows = [row({ positionSeconds: 50, durationSeconds: 100 })];
    const [item] = await getContinueWatching();
    expect(item.fraction).toBe(0.5);
    expect(item.fraction).toBeLessThanOrEqual(1);
  });

  it("caps the rail at twelve shows", async () => {
    h.rows = Array.from({ length: 20 }, (_, i) =>
      row({ slug: `show-${i}`, episodeId: `ep-${i}` }),
    );
    expect(await getContinueWatching()).toHaveLength(12);
  });

  it("never reads the trial cookie for a signed-in user", async () => {
    h.cookie = "stale-trial-token";
    h.rows = [];
    await getContinueWatching();
    expect(h.from).toEqual([watchProgress]);
  });

  it("issues no continuation query when no row is a branch", async () => {
    h.rows = [row(), row({ slug: "other", episodeId: "o-1" })];
    await getContinueWatching();
    expect(h.from).toEqual([watchProgress]);
  });
});

describe("getContinueWatching — branching video", () => {
  it("leads a finished branch on to its silent continuation instead of dropping the show", async () => {
    h.rows = [branchRow()];
    h.choiceRows = [continuation()];
    const items = await getContinueWatching();

    // One extra query, scoped to the branch rows and to READY targets.
    expect(h.from).toEqual([watchProgress, episodeChoices]);
    const clause = h.where[1] as unknown[];
    expect(clause).toContainEqual({
      inArray: [episodeChoices.fromEpisodeId, ["b-901"]],
    });
    expect(clause).toContainEqual({ eq: [episodes.status, "ready"] });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      show: { slug: "the-scarlet-oath" },
      episodeId: "ep-3",
      episodeNumber: 3,
      episodeTitle: "Third oath",
      positionSeconds: 0,
      durationSeconds: 720,
      fraction: 0,
    });
    // Ordering keeps the branch's own recency — this IS the latest touch.
    expect(items[0].updatedAt).toEqual(new Date("2026-09-01T10:00:00Z"));
  });

  it("treats ≥95% of a branch as finished for the hop too", async () => {
    h.rows = [branchRow({ completed: false, positionSeconds: 590 })];
    h.choiceRows = [continuation()];
    const [item] = await getContinueWatching();
    expect(item.episodeId).toBe("ep-3");
  });

  it("gives a branch in progress no tile until the player can resume one (#144)", async () => {
    // Its ?ep= deep link falls back to episode 1 today — a tile promising
    // "resume 901" that lands elsewhere is worse than none. No fall-through
    // to an older row of the show either (same rule as a finished row).
    h.rows = [
      branchRow({ completed: false, positionSeconds: 100 }),
      row({ episodeId: "ep-2", positionSeconds: 300 }),
    ];
    h.choiceRows = [continuation()];
    expect(await getContinueWatching()).toEqual([]);
  });

  it("drops a finished branch that is an ending (no choices)", async () => {
    h.rows = [branchRow()];
    h.choiceRows = [];
    expect(await getContinueWatching()).toEqual([]);
  });

  it("drops a finished branch that ends in a fork — the viewer has to choose", async () => {
    h.rows = [branchRow()];
    h.choiceRows = [
      continuation({ episodeId: "b-911" }),
      continuation({ episodeId: "b-912" }),
    ];
    expect(await getContinueWatching()).toEqual([]);
  });

  it("drops the hop when the next episode's duration is unknown", async () => {
    h.rows = [branchRow()];
    h.choiceRows = [continuation({ durationSeconds: null })];
    expect(await getContinueWatching()).toEqual([]);
  });

  it("does the same for an anonymous trial row", async () => {
    h.userId = null;
    h.cookie = "trial-token";
    h.rows = [branchRow({ completed: false, positionSeconds: 600 })];
    h.choiceRows = [continuation()];
    const [item] = await getContinueWatching();
    expect(h.from).toEqual([trialSessions, episodeChoices]);
    expect(item.episodeId).toBe("ep-3");
  });
});

describe("getContinueWatching — anonymous", () => {
  beforeEach(() => {
    h.userId = null;
  });

  it("answers an empty rail without a query when there is no trial cookie", async () => {
    expect(await getContinueWatching()).toEqual([]);
    expect(h.from).toEqual([]);
  });

  it("resolves the cookie's trial sessions that point at a last episode", async () => {
    h.cookie = "trial-token";
    h.rows = [row({ orientation: "horizontal" })];
    const items = await getContinueWatching();

    expect(h.from).toEqual([trialSessions]);
    const [clause] = h.where as unknown[][];
    expect(clause).toContainEqual({ eq: [trialSessions.sessionToken, "trial-token"] });
    expect(clause).toContainEqual({ isNotNull: trialSessions.lastEpisodeId });
    expect(clause).toContainEqual({ eq: [shows.status, "published"] });
    expect(items).toHaveLength(1);
    expect(items[0].show.orientation).toBe("horizontal");
  });
});
