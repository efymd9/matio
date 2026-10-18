import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #462 — what the watch page hands the player, per viewer. The player locks
// episodes CLIENT-SIDE from the `tier` prop and picks its wall by `mode`, so
// these two props ARE the access decision on the web (the token route is the
// belt-and-braces behind them). The rule itself is the real one
// (lib/episode-access.ts) and so is the kill-switch (lib/free-mode.ts, read
// from the env); everything else the page reaches for is faked, and the
// <Player> element it returns is read instead of rendered.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  userId: null as string | null,
  subscriber: false,
  // The page's reads, in order: the show, its seasons, the ready episodes
  // (then, signed in only: the email, the watch progress). Each chain
  // resolves to the next queued result, whichever builder methods it walks.
  queue: [] as unknown[][],
  findTrialSession: vi.fn(),
  applyUserAttribution: vi.fn(async () => undefined),
}));

vi.mock("@/db", () => {
  const chain = (result: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) c[m] = () => c;
    c.then = (ok: (v: unknown[]) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, ko);
    return c;
  };
  return { db: { select: () => chain(h.queue.shift() ?? []) } };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: h.userId }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "user-agent": "Mozilla/5.0 Safari" }),
}));
vi.mock("next/server", () => ({ userAgent: () => ({ isBot: false }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/watch/player", () => ({ Player: () => null }));
vi.mock("@/components/watch/watch-shell", () => ({
  WatchShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/site/complete-registration-pixel", () => ({
  CompleteRegistrationPixel: () => null,
}));
vi.mock("@/components/site/purchase-beacon", () => ({ PurchaseBeacon: () => null }));
vi.mock("@/components/site/icon", () => ({ Icon: () => null }));
vi.mock("@/lib/checkout-return-verify", () => ({ verifyCheckoutReturn: async () => null }));
vi.mock("@/lib/mux-token", () => ({ muxThumbnailUrl: () => null }));
vi.mock("@/lib/i18n/server", () => ({ getDict: async () => ({ t: {} }) }));
vi.mock("@/lib/admin", () => ({ getOrSyncCurrentUser: async () => null }));
vi.mock("@/lib/attribution", () => ({
  applyUserAttribution: h.applyUserAttribution,
  readAttributionCookies: async () => ({ first: {}, last: {} }),
}));
vi.mock("@/lib/checkout-session", () => ({ getPublishableKey: () => null }));
vi.mock("@/lib/wallet-checkout", () => ({ walletCheckoutEnabled: () => false }));
vi.mock("@/lib/subscription-access", () => ({
  hasActiveSubscription: async () => h.subscriber,
}));
vi.mock("@/lib/trial", () => ({
  TRIAL_COOKIE: "trial_session",
  findTrialSession: h.findTrialSession,
  linkTrialSessionsToCurrentUser: async () => undefined,
}));
vi.mock("@/lib/visitor", () => ({ linkVisitorToUser: async () => undefined }));

import { Player } from "@/components/watch/player";
import WatchPage from "./page";

type Access = "free" | "member" | "subscriber";

function episodeRow(n: number, access: Access) {
  return {
    id: `ep-${n}`,
    seasonId: "season-1",
    number: n,
    title: `Episode ${n}`,
    description: null,
    durationSeconds: 600,
    muxPlaybackId: `pb-${n}`,
    muxPlaybackPolicy: "signed",
    status: "ready",
    access,
    introStartSeconds: null,
    introEndSeconds: null,
    branchOfEpisodeId: null,
    forkPromptEn: null,
    forkPromptEs: null,
    forkWindowSeconds: 10,
  };
}

type PlayerProps = {
  mode: string;
  autoplay: boolean;
  episodes: Array<{ id: string; tier: Access; accountTier?: Access }>;
  accountUnlocks?: number;
  signupGate?: boolean;
  freeMode?: boolean;
};

function findPlayer(node: ReactNode): PlayerProps | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findPlayer(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === Player) return el.props as unknown as PlayerProps;
  return findPlayer(el.props.children);
}

async function render(access: Access[]): Promise<PlayerProps> {
  h.queue = [
    [{ id: "show-1", slug: "the-scarlet-oath", title: "The Scarlet Oath", orientation: "horizontal" }],
    [{ id: "season-1", number: 1, title: null }],
    access.map((a, i) => episodeRow(i + 1, a)),
    // Signed in only: the reminder form's email, then the resume point.
    [{ email: "viewer@example.invalid" }],
    [],
  ];
  const page = await WatchPage({
    params: Promise.resolve({ showSlug: "the-scarlet-oath" }),
    searchParams: Promise.resolve({}),
  });
  const player = findPlayer(page);
  if (!player) throw new Error("the page rendered no <Player>");
  return player;
}

const tiers = (p: PlayerProps) => p.episodes.map((e) => e.tier);
const accountTiers = (p: PlayerProps) => p.episodes.map((e) => e.accountTier);

beforeEach(() => {
  h.userId = null;
  h.subscriber = false;
  h.findTrialSession.mockReset().mockResolvedValue(null);
  h.applyUserAttribution.mockClear();
  vi.stubEnv("PAYMENTS_ENABLED", "1");
  vi.stubEnv("REQUIRE_SIGNUP", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/watch — paid mode: registration first, then the paywall (#462)", () => {
  it("an anonymous viewer on an all-subscriber show gets the sign-up wall — not the 60s preview", async () => {
    const player = await render(["subscriber", "subscriber", "subscriber"]);

    // mode="free" + tier "member" = the SignupWall, prop-driven, no token
    // fetch. Before #462 this show rendered mode="trial": the 60s preview.
    expect(player.mode).toBe("free");
    expect(tiers(player)).toEqual(["member", "member", "member"]);
    // A walled start skips the autoplay probe it could never use.
    expect(player.autoplay).toBe(false);
    // An account opens none of these episodes — the wall must not promise any.
    expect(player.accountUnlocks).toBe(0);
    expect(player.freeMode).toBe(false);
    // …and what they ask once signed in: the paywall. The wall's "the
    // membership comes next" copy and the «Subscribe» rows read this.
    expect(accountTiers(player)).toEqual(["subscriber", "subscriber", "subscriber"]);
    expect(h.applyUserAttribution).not.toHaveBeenCalled();
  });

  it("a free first episode still plays anonymously; the rest asks for an account", async () => {
    const player = await render(["free", "member", "subscriber"]);

    expect(player.mode).toBe("free");
    expect(tiers(player)).toEqual(["free", "member", "member"]);
    expect(player.autoplay).toBe(true);
    // Only the member episode is what an account really opens.
    expect(player.accountUnlocks).toBe(1);
    expect(accountTiers(player)).toEqual(["free", "member", "subscriber"]);
  });

  it("a signed-in non-subscriber meets the same episodes as the paywall", async () => {
    h.userId = "user_1";
    const player = await render(["subscriber", "subscriber"]);

    // mode="member" + tier "subscriber" = the Paywall.
    expect(player.mode).toBe("member");
    expect(tiers(player)).toEqual(["subscriber", "subscriber"]);
    expect(accountTiers(player)).toEqual(["subscriber", "subscriber"]);
    // The paywall here sends them straight to /checkout, past /subscribe —
    // so the account's attribution is stamped on this page, in paid mode too.
    expect(h.applyUserAttribution).toHaveBeenCalledWith("user_1");
  });

  it("a subscriber plays", async () => {
    h.userId = "user_1";
    h.subscriber = true;
    const player = await render(["subscriber", "subscriber"]);

    expect(player.mode).toBe("subscriber");
  });
});

describe("/watch — free mode is unchanged by #462", () => {
  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "");
  });

  it("signup gate, anonymous: free plays, everything above it is the sign-up wall", async () => {
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    const player = await render(["free", "member", "subscriber"]);

    expect(player.mode).toBe("free");
    expect(tiers(player)).toEqual(["free", "member", "member"]);
    expect(player.signupGate).toBe(true);
    // With payments off an account opens both — the wall's count as before.
    expect(player.accountUnlocks).toBe(2);
  });

  it("signup gate, signed in: member mode, where nothing is locked", async () => {
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    h.userId = "user_1";
    const player = await render(["free", "member", "subscriber"]);

    expect(player.mode).toBe("member");
    expect(tiers(player)).toEqual(["free", "member", "member"]);
    expect(h.applyUserAttribution).toHaveBeenCalledWith("user_1");
  });

  it("open free mode: everything is free for an anonymous viewer", async () => {
    const player = await render(["free", "member", "subscriber"]);

    expect(player.mode).toBe("free");
    expect(tiers(player)).toEqual(["free", "free", "free"]);
    expect(player.accountUnlocks).toBe(0);
  });
});
