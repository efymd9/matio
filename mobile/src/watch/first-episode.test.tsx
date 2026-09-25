/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeAccessTier, ShowDetail, SignupGate } from "@/shared/api-types";

// #288 — Home's Play and the show page's «Play · Ep. 1» share this rule.
// Three things are pinned here: (1) only an episode that asks for an ACCOUNT
// leads to sign-in — a subscribers-only one opens the player, whose page says
// so, instead of sending a signed-in viewer to a sign-in form (or an
// anonymous one round a sign-up loop); (2) the sign-in route carries the
// episode, so signing in can land on it; (3) a slow answer never navigates
// over whatever the viewer moved on to.

const router = { push: vi.fn() };
const nav = vi.hoisted(() => {
  const listeners = new Set<(focused: boolean) => void>();
  return {
    focused: true,
    listeners,
    set(focused: boolean) {
      nav.focused = focused;
      listeners.forEach((listener) => listener(focused));
    },
  };
});

// Navigation focus as expo-router delivers it: the focus effect runs on
// focus, its cleanup on blur and unmount (the orientation suite's fake).
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    useRouter: () => router,
    useNavigation: () => ({ isFocused: () => nav.focused }),
    useFocusEffect(effect: () => undefined | (() => void)) {
      React.useEffect(() => {
        let cleanup: undefined | (() => void);
        if (nav.focused) cleanup = effect();
        const listener = (focused: boolean) => {
          if (focused) cleanup = effect();
          else {
            cleanup?.();
            cleanup = undefined;
          }
        };
        nav.listeners.add(listener);
        return () => {
          cleanup?.();
          nav.listeners.delete(listener);
        };
      }, [effect]);
    },
  };
});

let gate: SignupGate = { mode: "tiers" };
let signedIn = false;
vi.mock("@/api/config-context", () => ({ useConfig: () => ({ signupGate: gate }) }));
vi.mock("@/auth/clerk", () => ({ useOptionalAuth: () => ({ isSignedIn: signedIn }) }));

// api.show under the case's control: each call hands back a promise the case
// resolves (or rejects) when it chooses.
type Pending = { resolve: (show: ShowDetail) => void; reject: (e: unknown) => void };
const pending: Pending[] = [];
vi.mock("@/api/client", () => ({
  api: {
    show: vi.fn(
      () =>
        new Promise<ShowDetail>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    ),
  },
}));

import { episodeRoute, firstEpisodeLocked, usePlayFirstEpisode } from "./first-episode";

function show(slug: string, access: EpisodeAccessTier): ShowDetail {
  return {
    id: `show-${slug}`,
    slug,
    title: slug,
    synopsis: null,
    genre: [],
    orientation: "horizontal",
    posterImageUrl: null,
    heroImageUrl: null,
    episodeCount: 1,
    featured: false,
    justReleased: false,
    popularNow: false,
    episodes: [
      {
        id: `${slug}-ep1`,
        seasonNumber: 1,
        number: 1,
        title: "One",
        description: null,
        durationSeconds: 600,
        access,
        releasedAt: null,
        thumbnailUrl: null,
        introStartSeconds: null,
        introEndSeconds: null,
      },
    ],
  };
}

let hook: ReturnType<typeof usePlayFirstEpisode>;
function Harness() {
  hook = usePlayFirstEpisode();
  return null;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

describe("firstEpisodeLocked / episodeRoute", () => {
  it("returns WHY the first episode is locked, not just whether", () => {
    const tiers: SignupGate = { mode: "tiers" };
    expect(firstEpisodeLocked(show("a", "free"), tiers, false)).toBe(false);
    expect(firstEpisodeLocked(show("a", "member"), tiers, false)).toBe("signup_required");
    expect(firstEpisodeLocked(show("a", "member"), tiers, true)).toBe(false);
    // /v1 carries no subscription state: signed in or not, a subscriber
    // episode is subscribe_required — never a sign-up ask.
    expect(firstEpisodeLocked(show("a", "subscriber"), tiers, true)).toBe("subscribe_required");
    expect(firstEpisodeLocked(show("a", "subscriber"), tiers, false)).toBe("subscribe_required");
    expect(firstEpisodeLocked({ ...show("a", "member"), episodes: [] }, tiers, false)).toBe(false);
  });

  it("sends only an account ask to sign-in, carrying the episode; everything else to the player", () => {
    const params = { episodeId: "ep-1", showSlug: "fallen" };
    expect(episodeRoute("signup_required", "ep-1", "fallen")).toEqual({ pathname: "/sign-in", params });
    expect(episodeRoute("subscribe_required", "ep-1", "fallen")).toEqual({
      pathname: "/watch/[episodeId]",
      params,
    });
    expect(episodeRoute(false, "ep-1", "fallen")).toEqual({ pathname: "/watch/[episodeId]", params });
  });
});

describe("usePlayFirstEpisode — Home's Play (#288)", () => {
  beforeEach(() => {
    router.push.mockClear();
    pending.length = 0;
    nav.focused = true;
    nav.listeners.clear();
    gate = { mode: "tiers" };
    signedIn = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("a signed-in viewer on a subscribers-only show goes to the player, not to sign-in", async () => {
    signedIn = true;
    act(() => root.render(<Harness />));

    act(() => hook.play("fallen"));
    await settle(() => pending[0].resolve(show("fallen", "subscriber")));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/watch/[episodeId]",
      params: { episodeId: "fallen-ep1", showSlug: "fallen" },
    });
  });

  it("an anonymous viewer on a member episode goes to sign-in WITH the episode", async () => {
    act(() => hook.play("morelli"));
    await settle(() => pending[0].resolve(show("morelli", "member")));

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/sign-in",
      params: { episodeId: "morelli-ep1", showSlug: "morelli" },
    });
  });

  it("an answer that lands after the viewer left (another card, another tab) navigates nowhere", async () => {
    act(() => hook.play("morelli"));
    expect(hook.busy).toBe(true);

    act(() => nav.set(false));
    // The button is not left reading «please wait» for a request nobody wants.
    expect(hook.busy).toBe(false);
    await settle(() => pending[0].resolve(show("morelli", "free")));

    expect(router.push).not.toHaveBeenCalled();
  });

  it("a failure that lands after the viewer left does not open the show page over them", async () => {
    act(() => hook.play("morelli"));
    act(() => nav.set(false));
    await settle(() => pending[0].reject(new Error("offline")));

    expect(router.push).not.toHaveBeenCalled();
  });

  it("back on Home, a new Play wins over the stale one", async () => {
    act(() => hook.play("morelli"));
    act(() => nav.set(false));
    act(() => nav.set(true));

    act(() => hook.play("second-hand"));
    expect(hook.busy).toBe(true);
    // The stale answer arrives first: ignored, and it does not clear the
    // new request's busy state either.
    await settle(() => pending[0].resolve(show("morelli", "free")));
    expect(router.push).not.toHaveBeenCalled();
    expect(hook.busy).toBe(true);

    await settle(() => pending[1].resolve(show("second-hand", "free")));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/watch/[episodeId]",
      params: { episodeId: "second-hand-ep1", showSlug: "second-hand" },
    });
    expect(hook.busy).toBe(false);
  });

  it("a failed load while still on Home lands on the show page, which owns the error", async () => {
    act(() => hook.play("morelli"));
    await settle(() => pending[0].reject(new Error("offline")));

    expect(router.push).toHaveBeenCalledWith({ pathname: "/show/[slug]", params: { slug: "morelli" } });
  });
});
