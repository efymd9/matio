import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only the Mux call matters here: what this asserts is the CONTRACT we hand to
// Mux when minting a direct-upload URL — the lifetime of that URL, and that a
// leaked URL cannot be driven from someone else's page.
const h = vi.hoisted(() => ({
  create: vi.fn(),
  episode: { id: "ep-1" } as { id: string } | undefined,
}));

vi.mock("@/lib/mux", () => ({
  getMux: () => ({ video: { uploads: { create: h.create } } }),
}));
vi.mock("@/lib/admin", () => ({ requireAdmin: async () => ({ id: "admin-1" }) }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (h.episode ? [h.episode] : []) }),
      }),
    }),
  },
}));

import { createMuxUpload } from "./actions";

beforeEach(() => {
  h.episode = { id: "ep-1" };
  h.create.mockReset().mockResolvedValue({
    id: "upload-1",
    url: "https://storage.example/session",
  });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://matio.tv");
});

describe("createMuxUpload", () => {
  it("gives the upload URL a full day to live, not Mux's default hour", async () => {
    // An hour does not cover a multi-gigabyte master on a slow uplink — the
    // Mux account is full of our own `timed_out` uploads from that default
    // (issue #130).
    await createMuxUpload("ep-1");

    const args = h.create.mock.calls[0][0];
    expect(args.timeout).toBe(86_400);
  });

  it("scopes the URL to our own origin so a leaked link is useless elsewhere", async () => {
    await createMuxUpload("ep-1");
    expect(h.create.mock.calls[0][0].cors_origin).toBe("https://matio.tv");
  });

  it("asks Mux for a signed asset tied to the episode", async () => {
    // Signed playback is what makes /api/playback-token the only way in;
    // passthrough is how the webhook finds the episode again.
    await createMuxUpload("ep-1");
    const settings = h.create.mock.calls[0][0].new_asset_settings;
    expect(settings.playback_policies).toEqual(["signed"]);
    expect(settings.passthrough).toBe("ep-1");
  });

  it("returns the URL and id the widget needs", async () => {
    const result = await createMuxUpload("ep-1");
    expect(result).toEqual({
      uploadUrl: "https://storage.example/session",
      uploadId: "upload-1",
    });
  });

  it("never mints an upload for an episode that does not exist", async () => {
    h.episode = undefined;
    await expect(createMuxUpload("ghost")).rejects.toThrow();
    expect(h.create).not.toHaveBeenCalled();
  });
});
