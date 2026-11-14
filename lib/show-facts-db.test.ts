import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ calls: 0, rows: [] as unknown[] }));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "innerJoin", "where"]) chain[m] = () => chain;
  chain.groupBy = async () => {
    h.calls++;
    return h.rows;
  };
  return { db: chain };
});

import { loadEpisodeStats } from "./show-facts-db";

describe("loadEpisodeStats", () => {
  it("asks nothing for no shows", async () => {
    expect(await loadEpisodeStats([])).toEqual(new Map());
    expect(h.calls).toBe(0);
  });

  it("maps the grouped rows by show id, the count as a number", async () => {
    h.rows = [{ showId: "s1", count: "9", minSeconds: 559, maxSeconds: 1420 }];
    expect(await loadEpisodeStats(["s1", "s2"])).toEqual(
      new Map([["s1", { count: 9, minSeconds: 559, maxSeconds: 1420 }]]),
    );
  });
});
