import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Mux webhook's signature gate, through the REAL SDK. route.test.ts mocks
// `getMux()` away to test what an event writes; this file keeps `lib/mux.ts`
// and `@mux/mux-node` real and signs bodies locally the way Mux does
// (`mux-signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`), so a
// major SDK bump that changes `webhooks.unwrap` — its header parsing, its
// comparison, its 5-minute tolerance — fails here instead of in production,
// where it would 400 every real Mux delivery (#157, SDK 14 → 15).
vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  episode: undefined as { id: string; muxAssetId: string | null } | undefined,
  reads: 0,
  writes: [] as Array<{ values: unknown }>,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => {
      h.reads += 1;
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: async () => (h.episode ? [h.episode] : []),
      };
      return chain;
    },
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          h.writes.push({ values });
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

import { POST } from "./route";

const SECRET = "whsec-dummy-signing-secret";
const EPISODE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function readyEvent(passthrough: string) {
  return JSON.stringify({
    type: "video.asset.ready",
    data: {
      id: "asset-1",
      passthrough,
      playback_ids: [{ id: "pb-1", policy: "signed" }],
      duration: 2.02,
      status: "ready",
    },
  });
}

function sign(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return `t=${at},v1=${v1}`;
}

function request(body: string, signature?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("mux-signature", signature);
  return new Request("https://matio.test/api/webhooks/mux", {
    method: "POST",
    headers,
    body,
  }) as unknown as Parameters<typeof POST>[0];
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("MUX_WEBHOOK_SIGNING_SECRET", SECRET);
  vi.stubEnv("MUX_TOKEN_ID", "dummy-token-id");
  vi.stubEnv("MUX_TOKEN_SECRET", "dummy-token-secret");
  globalThis.__muxClient = undefined;
  h.episode = { id: EPISODE_ID, muxAssetId: null };
  h.reads = 0;
  h.writes = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.__muxClient = undefined;
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("POST /api/webhooks/mux — signature verification (real SDK)", () => {
  it("accepts a body signed with our secret and acts on the parsed event", async () => {
    const body = readyEvent(EPISODE_ID);
    const res = await POST(request(body, sign(body)));

    expect(res.status).toBe(200);
    expect(h.writes[0]?.values).toMatchObject({
      muxAssetId: "asset-1",
      muxPlaybackId: "pb-1",
      muxPlaybackPolicy: "signed",
      durationSeconds: 2,
      status: "ready",
    });
  });

  it("rejects a body that was changed after signing", async () => {
    const signed = readyEvent(EPISODE_ID);
    const tampered = signed.replace('"asset-1"', '"asset-evil"');
    const res = await POST(request(tampered, sign(signed)));

    expect(res.status).toBe(400);
    expect(h.reads).toBe(0);
    expect(h.writes).toEqual([]);
  });

  it("rejects a body signed with someone else's secret", async () => {
    const body = readyEvent(EPISODE_ID);
    const res = await POST(request(body, sign(body, "whsec-dummy-other")));

    expect(res.status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("rejects a replay older than the SDK's five-minute tolerance", async () => {
    const body = readyEvent(EPISODE_ID);
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const res = await POST(request(body, sign(body, SECRET, tenMinutesAgo)));

    expect(res.status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("rejects a delivery with no mux-signature header at all", async () => {
    const res = await POST(request(readyEvent(EPISODE_ID)));

    expect(res.status).toBe(400);
    expect(h.reads).toBe(0);
  });

  it("answers 200 and touches no row for a genuine event whose passthrough is not an episode id", async () => {
    // The shape of the one live test upload made for the SDK bump: a marker
    // passthrough, not a UUID. Mux delivers its `video.asset.ready` to the
    // production endpoint like any other; the handler must acknowledge it
    // (no retry storm) without reading or writing the episodes table.
    const body = readyEvent("sdk15-test-1790000000000");
    const res = await POST(request(body, sign(body)));

    expect(res.status).toBe(200);
    expect(h.reads).toBe(0);
    expect(h.writes).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "video.asset.ready with invalid passthrough",
      expect.objectContaining({ assetId: "asset-1" }),
    );
  });
});
