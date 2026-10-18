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
}));

import { episodes, seasons } from "@/db/schema";
import {
  getOrderedReadyEpisodeIds,
  isFreeToWatch,
  resolveEffectiveTier,
  seriesIsFreeToWatch,
  resolveRequestTier,
} from "./episode-access";
import type { EpisodeTier } from "./episode-access";

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

// The rule the whole access surface reads from (#198, #462). Every
// combination of payments × signup gate × session × tier is written out —
// the three consumers (watch page, token route, watch actions) must never
// disagree, and the free pivot's lesson was exactly one of them drifting.
// Each row: [paymentsOn, signupGate, signedIn, free, member, subscriber].
type Row = [boolean, boolean, boolean, EpisodeTier, EpisodeTier, EpisodeTier];
const TIERS: EpisodeTier[] = ["free", "member", "subscriber"];

function cases(table: Row[]) {
  return table.flatMap(([paymentsOn, signupGate, signedIn, ...out]) =>
    TIERS.map((access, i) => ({
      paymentsOn,
      signupGate,
      signedIn,
      access,
      expected: out[i],
    })),
  );
}

describe("resolveEffectiveTier — what an episode presents to one viewer", () => {
  const TABLE: Row[] = [
    // Paid mode: registration first, then the paywall (#462). The gate is a
    // deliberate no-op once payments own the gating.
    [true, false, false, "free", "member", "member"],
    [true, true, false, "free", "member", "member"],
    [true, false, true, "free", "member", "subscriber"],
    [true, true, true, "free", "member", "subscriber"],
    // Free mode under the signup gate: subscriber asks for an account, not
    // for money — the session does not matter here (mode="member" unlocks
    // `member` for the signed-in).
    [false, true, false, "free", "member", "member"],
    [false, true, true, "free", "member", "member"],
    // The open free pivot: everything is free.
    [false, false, false, "free", "free", "free"],
    [false, false, true, "free", "free", "free"],
  ];

  it.each(cases(TABLE))(
    "payments=$paymentsOn gate=$signupGate signedIn=$signedIn: $access → $expected",
    ({ paymentsOn, signupGate, signedIn, access, expected }) => {
      expect(
        resolveEffectiveTier(access, { paymentsOn, signupGate, signedIn }),
      ).toBe(expected);
    },
  );

  it("paid mode asks an anonymous viewer for an account on a subscriber episode, and only then for money", () => {
    const paid = { paymentsOn: true, signupGate: false };
    // The member tier is what the player answers with the SignupWall in
    // mode="free" and what the token route turns into signup_required.
    expect(
      resolveEffectiveTier("subscriber", { ...paid, signedIn: false }),
    ).toBe("member");
    // Signed in, the same episode is the paywall again.
    expect(
      resolveEffectiveTier("subscriber", { ...paid, signedIn: true }),
    ).toBe("subscriber");
  });
});

// What the token route mints for one request. The dangerous mistakes are
// asymmetric: minting for an anonymous member request hands out walled
// content, refusing a signed-in one locks a viewer out of what they were
// promised. Both directions are pinned, for every combination.
describe("resolveRequestTier — what one request may mint", () => {
  const TABLE: Row[] = [
    // Paid mode: anonymous → the sign-up wall on member AND subscriber
    // (#462); signed in → a session buys nothing by itself, the route
    // checks the subscription separately.
    [true, false, false, "free", "member", "member"],
    [true, true, false, "free", "member", "member"],
    [true, false, true, "free", "member", "subscriber"],
    [true, true, true, "free", "member", "subscriber"],
    // Free mode: a signed-in viewer plays everything on the member path.
    [false, true, true, "member", "member", "member"],
    [false, false, true, "member", "member", "member"],
    // Free mode, anonymous: the gate walls everything above free; the open
    // pivot hands out the free path.
    [false, true, false, "free", "member", "member"],
    [false, false, false, "free", "free", "free"],
  ];

  it.each(cases(TABLE))(
    "payments=$paymentsOn gate=$signupGate signedIn=$signedIn: $access → $expected",
    ({ paymentsOn, signupGate, signedIn, access, expected }) => {
      expect(
        resolveRequestTier(access, { paymentsOn, signupGate, signedIn }),
      ).toBe(expected);
    },
  );

  it("never yields the subscriber tier with payments off — the paywall cannot open in free mode", () => {
    for (const signupGate of [false, true]) {
      for (const signedIn of [false, true]) {
        for (const access of TIERS) {
          expect(
            resolveRequestTier(access, {
              paymentsOn: false,
              signupGate,
              signedIn,
            }),
          ).not.toBe("subscriber");
        }
      }
    }
  });
});

describe("isFreeToWatch — what schema.org may claim", () => {
  it("is true only when nothing at all is asked of the viewer", () => {
    expect(isFreeToWatch("free", { paymentsOn: false, signupGate: true })).toBe(
      true,
    );
    expect(
      isFreeToWatch("member", { paymentsOn: false, signupGate: true }),
    ).toBe(false);
    expect(
      isFreeToWatch("subscriber", { paymentsOn: true, signupGate: false }),
    ).toBe(false);
    expect(isFreeToWatch("free", { paymentsOn: true, signupGate: false })).toBe(
      true,
    );
    // The open pivot really is free for everyone.
    expect(
      isFreeToWatch("subscriber", { paymentsOn: false, signupGate: false }),
    ).toBe(true);
  });
});

describe("seriesIsFreeToWatch — the claim about the whole series", () => {
  const GATE = { paymentsOn: false, signupGate: true };

  it("is false when only the first episode is free", () => {
    expect(seriesIsFreeToWatch(["free", "member", "subscriber"], GATE)).toBe(
      false,
    );
  });

  it("is false for an all-subscriber series in paid mode — the shape #462 sets up", () => {
    expect(
      seriesIsFreeToWatch(["subscriber", "subscriber"], {
        paymentsOn: true,
        signupGate: false,
      }),
    ).toBe(false);
  });

  it("is true when every ready episode really plays with no account", () => {
    expect(seriesIsFreeToWatch(["free", "free"], GATE)).toBe(true);
    expect(
      seriesIsFreeToWatch(["member", "subscriber"], {
        paymentsOn: false,
        signupGate: false,
      }),
    ).toBe(true);
  });

  it("is false for a series with nothing ready — there is no free video to claim", () => {
    expect(seriesIsFreeToWatch([], GATE)).toBe(false);
  });
});
