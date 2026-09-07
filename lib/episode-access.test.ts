import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The positional ordering every funnel depth, signup-gate position and
// anonymous progress write keys on. A filter is only proven by reading the
// WHERE clause the helper issues, so the query builder is faked to a
// recording chain (the same idiom as lib/continue-watching.test.ts).
const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string }>,
  where: [] as unknown[],
}));

vi.mock("@/db", () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: (clause: unknown) => {
          h.where.push(clause);
          return chain;
        },
        orderBy: async () => h.rows,
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
    access: "episodes.access",
    number: "episodes.number",
    seasonId: "episodes.season_id",
    branchOfEpisodeId: "episodes.branch_of_episode_id",
  },
  seasons: { id: "seasons.id", showId: "seasons.show_id", number: "seasons.number" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  asc: () => undefined,
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  isNull: (column: unknown) => ({ isNull: column }),
  ne: (column: unknown, value: unknown) => ({ ne: [column, value] }),
}));

import { episodes, seasons } from "@/db/schema";
import { getOrderedReadyEpisodeIds, showHasTierGating } from "./episode-access";

beforeEach(() => {
  h.rows = [];
  h.where = [];
});

describe("getOrderedReadyEpisodeIds", () => {
  it("returns the ready ids in the order the query yields them", async () => {
    h.rows = [{ id: "ep-1" }, { id: "ep-2" }];
    expect(await getOrderedReadyEpisodeIds("show-1")).toEqual(["ep-1", "ep-2"]);
  });

  it("scopes to the show's READY episodes and leaves branches out", async () => {
    // A branch is reachable only through a fork choice, never by position —
    // counting it would shift every depth metric and gate position after
    // the fork (#143).
    await getOrderedReadyEpisodeIds("show-1");
    const [clause] = h.where as unknown[][];
    expect(clause).toContainEqual({ eq: [seasons.showId, "show-1"] });
    expect(clause).toContainEqual({ eq: [episodes.status, "ready"] });
    expect(clause).toContainEqual({ isNull: episodes.branchOfEpisodeId });
  });
});

describe("showHasTierGating", () => {
  it("is true iff a ready LISTED episode sits below the subscriber tier", async () => {
    h.rows = [{ id: "ep-1" }];
    expect(await showHasTierGating("show-1")).toBe(true);
    const [clause] = h.where as unknown[][];
    expect(clause).toContainEqual({ ne: [episodes.access, "subscriber"] });
    expect(clause).toContainEqual({ eq: [episodes.status, "ready"] });
    // A hidden branch with a free/member tier must not flip an
    // all-subscriber show into the per-episode walls (#143).
    expect(clause).toContainEqual({ isNull: episodes.branchOfEpisodeId });

    h.rows = [];
    expect(await showHasTierGating("show-1")).toBe(false);
  });
});
