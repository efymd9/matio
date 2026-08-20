import { describe, expect, it } from "vitest";

import { isEpisodeLockedForApp } from "./types";

// The CLIENT half of the playback gate — the app locks episodes from this,
// prop-driven, with no token fetch. It must agree with what
// /api/v1/playback-token enforces on every input: the free-pivot lesson was
// that coercing only one side leaves the client playing what the server would
// refuse, or a wall the server would have opened.

const base = {
  gate: { mode: "none" } as const,
  signedIn: false,
  hasSubscription: false,
  position: 1,
  access: "free" as const,
};

describe("isEpisodeLockedForApp — paid mode (tiers)", () => {
  const gate = { mode: "tiers" } as const;

  it("opens a free-tier episode to anyone", () => {
    expect(isEpisodeLockedForApp({ ...base, gate, access: "free" })).toBe(false);
  });

  it("asks a member-tier episode for an account, and only an account", () => {
    expect(isEpisodeLockedForApp({ ...base, gate, access: "member" })).toBe(
      "signup_required",
    );
    expect(
      isEpisodeLockedForApp({ ...base, gate, access: "member", signedIn: true }),
    ).toBe(false);
  });

  it("asks a subscriber-tier episode for a subscription", () => {
    expect(isEpisodeLockedForApp({ ...base, gate, access: "subscriber" })).toBe(
      "subscribe_required",
    );
    // Signed in is not enough — the paywall is the subscription, not the account.
    expect(
      isEpisodeLockedForApp({
        ...base,
        gate,
        access: "subscriber",
        signedIn: true,
      }),
    ).toBe("subscribe_required");
    expect(
      isEpisodeLockedForApp({
        ...base,
        gate,
        access: "subscriber",
        signedIn: true,
        hasSubscription: true,
      }),
    ).toBe(false);
  });
});

describe("isEpisodeLockedForApp — free mode", () => {
  it("locks nothing when there is no gate", () => {
    for (const access of ["free", "member", "subscriber"] as const) {
      expect(isEpisodeLockedForApp({ ...base, access })).toBe(false);
    }
  });

  it("opens the first N episodes to an anonymous viewer and walls the rest", () => {
    const gate = { mode: "after_episodes", episodes: 1 } as const;
    expect(isEpisodeLockedForApp({ ...base, gate, position: 1 })).toBe(false);
    expect(isEpisodeLockedForApp({ ...base, gate, position: 2 })).toBe(
      "signup_required",
    );
  });

  it("respects a deeper gate", () => {
    const gate = { mode: "after_episodes", episodes: 3 } as const;
    expect(isEpisodeLockedForApp({ ...base, gate, position: 3 })).toBe(false);
    expect(isEpisodeLockedForApp({ ...base, gate, position: 4 })).toBe(
      "signup_required",
    );
  });

  it("ignores the episode's own tier once the positional gate is in play", () => {
    // Free mode coerces tiers away on the server too; a subscriber-tier row on
    // a free-mode show must not show a subscription paywall in the app.
    const gate = { mode: "after_episodes", episodes: 1 } as const;
    expect(
      isEpisodeLockedForApp({ ...base, gate, position: 1, access: "subscriber" }),
    ).toBe(false);
    expect(
      isEpisodeLockedForApp({ ...base, gate, position: 9, access: "subscriber" }),
    ).toBe("signup_required");
  });

  it("plays everything for a signed-in viewer, however deep", () => {
    const gate = { mode: "after_episodes", episodes: 1 } as const;
    expect(
      isEpisodeLockedForApp({
        ...base,
        gate,
        position: 99,
        access: "subscriber",
        signedIn: true,
      }),
    ).toBe(false);
  });
});
