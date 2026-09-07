import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Mux asset webhook: what a `video.asset.ready` event WRITES. Two
// updates — the playback fields, then the write-if-null release stamp —
// and the stamp's WHERE is the subject: an episode landing ready on a
// published show is a release, a BRANCH landing ready is not (#143).
const h = vi.hoisted(() => ({
  event: null as unknown,
  episode: undefined as { id: string; muxAssetId: string | null } | undefined,
  writes: [] as Array<{ table: unknown; values: unknown; where: unknown }>,
}));

vi.mock("@/lib/mux", () => ({
  getMux: () => ({ webhooks: { unwrap: async () => h.event } }),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: async () => (h.episode ? [h.episode] : []),
      };
      return chain;
    },
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async (where: unknown) => {
          h.writes.push({ table, values, where });
        },
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({
  episodes: {
    id: "episodes.id",
    muxAssetId: "episodes.mux_asset_id",
    seasonId: "episodes.season_id",
    releasedAt: "episodes.released_at",
    branchOfEpisodeId: "episodes.branch_of_episode_id",
  },
  seasons: { id: "seasons.id", showId: "seasons.show_id" },
  shows: { id: "shows.id", status: "shows.status", deletedAt: "shows.deleted_at" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: (column: unknown, values: unknown) => ({ inArray: [column, values] }),
  isNull: (column: unknown) => ({ isNull: column }),
}));

import { episodes } from "@/db/schema";
import { POST } from "./route";

const EPISODE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function request() {
  return new Request("https://matio.test/api/webhooks/mux", {
    method: "POST",
    body: "{}",
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.stubEnv("MUX_WEBHOOK_SIGNING_SECRET", "whsec-dummy");
  h.episode = { id: EPISODE_ID, muxAssetId: null };
  h.writes = [];
  h.event = {
    type: "video.asset.ready",
    data: {
      id: "asset-1",
      passthrough: EPISODE_ID,
      playback_ids: [{ id: "pb-1", policy: "signed" }],
      duration: 612.4,
    },
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/webhooks/mux — video.asset.ready", () => {
  it("attaches the asset and stamps released_at on listed episodes only", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);

    expect(h.writes).toHaveLength(2);
    expect(h.writes[0]).toMatchObject({
      table: episodes,
      values: {
        muxAssetId: "asset-1",
        muxPlaybackId: "pb-1",
        muxPlaybackPolicy: "signed",
        durationSeconds: 612,
        status: "ready",
      },
    });

    const stamp = h.writes[1];
    expect((stamp.values as { releasedAt: unknown }).releasedAt).toBeInstanceOf(Date);
    // Write-if-null, on this episode, published shows only — and never a
    // branch: a hidden episode is not a release for the analytics pulse
    // and release-retention blocks.
    expect(stamp.where).toContainEqual({ eq: [episodes.id, EPISODE_ID] });
    expect(stamp.where).toContainEqual({ isNull: episodes.releasedAt });
    expect(stamp.where).toContainEqual({ isNull: episodes.branchOfEpisodeId });
  });

  it("writes nothing for a passthrough that matches no episode", async () => {
    h.episode = undefined;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(h.writes).toEqual([]);
    spy.mockRestore();
  });

  it("refuses to re-point an episode already attached to another asset", async () => {
    h.episode = { id: EPISODE_ID, muxAssetId: "asset-other" };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await POST(request());
    expect(h.writes).toEqual([]);
    spy.mockRestore();
  });
});
