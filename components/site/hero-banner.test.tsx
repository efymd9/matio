/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// The Mux player is replaced by a probe that records every mount, unmount and
// the props each instance was born with. That is exactly what this suite is
// about: whether a consent flip MUTATES the live element or replaces it.
//
// Why it matters (issue #126): `disable-tracking` is the only prop that ever
// changes on a mounted <mux-player>, and @mux/mux-video reacts to it by tearing
// the stream down and restarting it — `unload(); …then(() => play())` with no
// `.catch` (dist/base.mjs, case DISABLE_TRACKING). A play() still pending when
// that lands is rejected by Chrome with "AbortError: The play() request was
// interrupted by a new load request" and escapes as an unhandled rejection.
const mux = vi.hoisted(() => ({
  mounts: [] as Record<string, unknown>[],
  unmounts: 0,
}));

vi.mock("@mux/mux-player-react", async () => {
  const { useEffect } = await import("react");
  // Named with a capital letter so it reads as the component it stands in for
  // (and so the hooks lint rule can see that it is one).
  function MuxPlayerProbe(props: Record<string, unknown>) {
    useEffect(() => {
      mux.mounts.push(props);
      return () => {
        mux.unmounts += 1;
      };
      // Mount-only on purpose: re-renders of the SAME instance must not count,
      // which is exactly the distinction this suite exists to make. `props` is
      // deliberately not a dependency — including it would log a "mount" on
      // every prop change and destroy that distinction.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="mux-player" />;
  }
  return { default: MuxPlayerProbe };
});

const consent = vi.hoisted(() => ({ marketing: false }));
vi.mock("@/lib/use-marketing-consent", () => ({
  useMarketingConsent: () => consent.marketing,
}));

// The hero reads copy through the locale provider; the English dictionary is
// enough here — this suite asserts player lifecycle, not strings.
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});

// Set inside vi.hoisted, not via vi.stubEnv: the component reads the key into
// a MODULE-level const, which is evaluated when the import below runs — and
// imports are hoisted above ordinary statements. Without this the suite would
// read whatever .env.local happens to hold locally, and an empty string in CI
// (where the key is unset), i.e. it would assert a different thing on each
// machine.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY = "env-key-test";
});

import { HeroBanner } from "./hero-banner";

const PROPS = {
  title: "The Scarlet Oath",
  description: "London, 1882.",
  genre: ["dark romance"],
  slug: "the-scarlet-oath",
  heroImageUrl: null,
  posterImageUrl: null,
  previewPlaybackId: "pb-hero",
  previewToken: "token-hero",
  episodeCount: 3,
  year: 2026,
  paymentsOn: false,
};

beforeEach(() => {
  mux.mounts = [];
  mux.unmounts = 0;
  consent.marketing = false;
});

afterEach(() => {
  cleanup();
});

describe("HeroBanner — Mux Data consent", () => {
  it("replaces the player instead of mutating it when consent arrives mid-playback", async () => {
    const view = render(<HeroBanner {...PROPS} />);
    // next/dynamic(ssr:false) resolves in a microtask — wait for the first
    // instance, or this asserts on an empty array whenever it runs first.
    await screen.findByTestId("mux-player");
    expect(mux.mounts).toHaveLength(1);

    consent.marketing = true;
    view.rerender(<HeroBanner {...PROPS} />);

    // A second instance, and the first one torn down: no live attribute
    // mutation, so the library's catch-less unload→play() path never runs.
    expect(mux.mounts).toHaveLength(2);
    expect(mux.unmounts).toBe(1);
  });

  it("turns tracking on for the new instance — consent stays LIVE", async () => {
    const view = render(<HeroBanner {...PROPS} />);
    await screen.findByTestId("mux-player");
    expect(mux.mounts[0]).toMatchObject({
      disableTracking: true,
      disableCookies: true,
      envKey: undefined,
    });

    consent.marketing = true;
    view.rerender(<HeroBanner {...PROPS} />);

    expect(mux.mounts[1]).toMatchObject({
      disableTracking: false,
      disableCookies: false,
      envKey: "env-key-test",
    });
  });

  it("turns tracking back off the moment consent is withdrawn", async () => {
    consent.marketing = true;
    const view = render(<HeroBanner {...PROPS} />);
    await screen.findByTestId("mux-player");
    expect(mux.mounts[0]).toMatchObject({ disableTracking: false });

    // Withdrawal must take effect without a reload — freezing consent in a
    // mount-time snapshot would reintroduce the AUDIT.md H2 pre-consent leak.
    consent.marketing = false;
    view.rerender(<HeroBanner {...PROPS} />);

    expect(mux.mounts).toHaveLength(2);
    expect(mux.mounts[1]).toMatchObject({
      disableTracking: true,
      disableCookies: true,
      envKey: undefined,
    });
  });

  it("does NOT remount on unrelated re-renders", async () => {
    const view = render(<HeroBanner {...PROPS} />);
    await screen.findByTestId("mux-player");
    // A key that changes every render would restart the teaser forever.
    view.rerender(<HeroBanner {...PROPS} title="The Scarlet Oath" />);
    view.rerender(<HeroBanner {...PROPS} episodeCount={4} />);
    expect(mux.mounts).toHaveLength(1);
    expect(mux.unmounts).toBe(0);
  });

  it("brings the backdrop back while the replacement instance loads", async () => {
    const view = render(<HeroBanner {...PROPS} heroImageUrl="/hero.jpg" />);
    await screen.findByTestId("mux-player");
    const backdrop = () => screen.getByRole("presentation", { hidden: true });

    // First frame of the original instance: the still fades out.
    act(() => {
      (mux.mounts[0].onPlaying as () => void)();
    });
    expect(backdrop().className).toContain("opacity-0");

    consent.marketing = true;
    view.rerender(<HeroBanner {...PROPS} heroImageUrl="/hero.jpg" />);

    // The new instance has no frames yet — without this reset the hero would
    // show empty background until it starts.
    expect(backdrop().className).toContain("opacity-100");
  });

  it("mounts no player at all when there is no preview to play", async () => {
    render(<HeroBanner {...PROPS} previewPlaybackId={null} />);
    // Give the dynamic import the same chance to resolve as everywhere else,
    // so "nothing mounted" means the guard held, not that we asserted early.
    await act(async () => {});
    expect(screen.queryByTestId("mux-player")).toBeNull();
    expect(mux.mounts).toHaveLength(0);
  });
});

// Compact JWT carrying only an `exp` claim — the hero reads nothing else and
// checks no signature (the token is the one the server handed it).
function jwtExpiring(atMs: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(atMs / 1000) }));
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.dummy-signature`;
}

// Fire `error` on the most recently mounted instance — after a remount the
// fresh instance is the one the hero listens to.
function fireError(event: Event) {
  act(() => {
    const latest = mux.mounts[mux.mounts.length - 1];
    (latest.onError as (e: Event) => void)(event);
  });
}

// The shape playback-core dispatches: `CustomEvent("error", { detail:
// MediaError })`, forwarded verbatim through the shadow roots.
const mediaError = (detail: Record<string, unknown>) =>
  new CustomEvent("error", { detail });

describe("HeroBanner — playback errors (#128)", () => {
  const fetchMock = vi.fn();
  const backdrop = () => screen.getByRole("presentation", { hidden: true });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores a non-fatal error: the preview stays, the backdrop stays hidden", async () => {
    render(<HeroBanner {...PROPS} heroImageUrl="/hero.jpg" />);
    await screen.findByTestId("mux-player");
    act(() => {
      (mux.mounts[0].onPlaying as () => void)();
    });

    // "Attempting to reconnect..." — what playback-core dispatches while
    // hls.js retries: MEDIA_ERR_NETWORK with fatal:false, muxCode
    // NETWORK_RECONNECTING. The old handler hid the player on exactly this.
    fireError(mediaError({ code: 2, fatal: false, muxCode: 2000003 }));

    expect(screen.getByTestId("mux-player")).toBeTruthy();
    expect(mux.unmounts).toBe(0);
    expect(backdrop().className).toContain("opacity-0");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a fatal error brings the backdrop back to full opacity and removes the player", async () => {
    render(<HeroBanner {...PROPS} heroImageUrl="/hero.jpg" />);
    await screen.findByTestId("mux-player");
    act(() => {
      (mux.mounts[0].onPlaying as () => void)();
    });
    expect(backdrop().className).toContain("opacity-0");

    // MEDIA_ERR_DECODE — nothing a fresh token could fix.
    fireError(mediaError({ code: 3, fatal: true }));

    expect(screen.queryByTestId("mux-player")).toBeNull();
    expect(backdrop().className).toContain("opacity-100");
    // The token is still valid, so there is nothing to refresh.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the error off the element when the event has no detail (native path)", async () => {
    render(<HeroBanner {...PROPS} />);
    await screen.findByTestId("mux-player");
    const nativeError = (code: number) =>
      ({
        detail: undefined,
        currentTarget: { media: { error: { code } } },
      }) as unknown as Event;

    // MEDIA_ERR_ABORTED: MediaError derives fatal:false from code 1.
    fireError(nativeError(1));
    expect(screen.getByTestId("mux-player")).toBeTruthy();

    // MEDIA_ERR_NETWORK: fatal by code.
    fireError(nativeError(2));
    expect(screen.queryByTestId("mux-player")).toBeNull();
  });

  it("recovers from an expired token: fetches a fresh one and remounts with it", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const expired = jwtExpiring(Date.now() - 1_000);
    const fresh = jwtExpiring(Date.now() + 60_000);
    render(
      <HeroBanner {...PROPS} previewToken={expired} heroImageUrl="/hero.jpg" />,
    );
    await screen.findByTestId("mux-player");
    expect(mux.mounts[0]).toMatchObject({ tokens: { playback: expired } });
    act(() => {
      (mux.mounts[0].onPlaying as () => void)();
    });

    // What hls.js + playback-core produce for a 403 on an expired JWT.
    fireError(mediaError({ code: 2, fatal: true, muxCode: 2403210 }));

    // Honest poster while the round-trip runs — the dead instance is gone.
    expect(screen.queryByTestId("mux-player")).toBeNull();
    expect(backdrop().className).toContain("opacity-100");
    expect(fetchMock).toHaveBeenCalledWith("/api/hero-preview-token", {
      cache: "no-store",
    });

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ playbackId: "pb-hero", token: fresh }),
      });
    });

    expect(mux.mounts).toHaveLength(2);
    expect(mux.unmounts).toBe(1);
    expect(mux.mounts[1]).toMatchObject({ tokens: { playback: fresh } });
  });

  it("asks for a token once per dead instance, however many errors it fires", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<HeroBanner {...PROPS} previewToken={jwtExpiring(0)} />);
    await screen.findByTestId("mux-player");

    fireError(mediaError({ code: 2, fatal: true }));
    fireError(mediaError({ code: 2, fatal: true }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the route is unreachable", () => Promise.reject(new Error("offline"))],
    [
      "the route has no preview",
      () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
    ],
    [
      "the featured show changed meanwhile",
      () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ playbackId: "pb-other", token: "t" }),
        }),
    ],
    [
      "the asset is public now (no token)",
      () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ playbackId: "pb-hero", token: null }),
        }),
    ],
  ])("stays on the backdrop when %s", async (_case, answer) => {
    fetchMock.mockImplementation(answer);
    render(<HeroBanner {...PROPS} previewToken={jwtExpiring(0)} />);
    await screen.findByTestId("mux-player");

    fireError(mediaError({ code: 2, fatal: true }));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mux-player")).toBeNull();
    expect(mux.mounts).toHaveLength(1);
  });

  it("stops refreshing after 20 cycles and rests on the backdrop", async () => {
    // Every fresh token is already expired, so each cycle ends the same way.
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ playbackId: "pb-hero", token: jwtExpiring(0) }),
    }));
    render(<HeroBanner {...PROPS} previewToken={jwtExpiring(0)} />);
    await screen.findByTestId("mux-player");

    for (let cycle = 1; cycle <= 20; cycle += 1) {
      fireError(mediaError({ code: 2, fatal: true }));
      await act(async () => {});
      expect(mux.mounts).toHaveLength(cycle + 1);
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);

    fireError(mediaError({ code: 2, fatal: true }));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(screen.queryByTestId("mux-player")).toBeNull();
  });

  it("treats a public preview (no token) as never expiring", async () => {
    render(<HeroBanner {...PROPS} previewToken={null} />);
    await screen.findByTestId("mux-player");

    fireError(mediaError({ code: 2, fatal: true }));
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mux-player")).toBeNull();
  });
});
