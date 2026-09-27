/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";

// #306 — a signed Mux still reaches the browser as ITSELF, never as a
// /_next/image URL. The still's URL carries a thumbnail JWT minted on every
// render, so each page view handed the optimizer a source it had never
// seen: a paid transformation plus a cache write per image per view, with
// nothing ever read back. And since next.config.ts no longer lists
// image.mux.com at all, an optimized still would now be a 400 — a broken
// image, not only a slow one. One case per watch surface that draws a still.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/watch/the-scarlet-oath",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));
vi.mock("@clerk/nextjs", () => ({
  Show: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignUpButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});
vi.mock("@/lib/posthog-events", () => ({
  capturePostHog: vi.fn(),
  onPostHogReady: vi.fn(() => () => undefined),
}));
vi.mock("@/lib/meta-pixel-events", () => ({
  onPixelReady: vi.fn(() => () => undefined),
  trackPixel: vi.fn(),
}));
vi.mock("@/app/watch/actions", () => ({
  markSignupWallShown: vi.fn(async () => undefined),
  saveWatchProgress: vi.fn(async () => undefined),
  saveTrialPosition: vi.fn(async () => undefined),
  saveWatchSegments: vi.fn(async () => undefined),
}));

import { EpisodesOverlay } from "./episodes-overlay";
import { Player, type PlayerEpisode } from "./player";
import { SignupWall } from "./signup-wall";
import { UpNextOverlay } from "./up-next-overlay";

// The shape lib/mux-token.ts:muxThumbnailUrl builds for a signed asset.
const STILL =
  "https://image.mux.com/pb-1/thumbnail.jpg?width=320&height=180&fit_mode=smartcrop&token=eyJ.dummy.sig";

const EPISODE: PlayerEpisode = {
  id: "ep-1",
  number: 1,
  seasonNumber: 1,
  title: "Episode 1",
  description: null,
  durationSeconds: 600,
  playbackId: "pb-1",
  introStartSeconds: null,
  introEndSeconds: null,
  thumbnailUrl: STILL,
  tier: "free",
  branchOfEpisodeId: null,
  forkPrompt: null,
  forkWindowSeconds: 10,
  choices: null,
};

// Overlays portal to document.body, so the whole document is searched.
function stills() {
  return Array.from(document.querySelectorAll("img"));
}

function expectServedByMux() {
  const imgs = stills();
  expect(imgs).toHaveLength(1);
  // The URL itself — not `/_next/image?url=…&w=…` — and no srcset of
  // optimizer widths either.
  expect(imgs[0].getAttribute("src")).toBe(STILL);
  expect(imgs[0].getAttribute("srcset")).toBeNull();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("signed Mux stills bypass /_next/image (#306)", () => {
  it("the player's poster gate", () => {
    // autoplay={false} is the crawler / blocked-autoplay land: the poster
    // play-gate, drawn over the current episode's still.
    render(
      <Player
        episodes={[EPISODE]}
        initialEpisodeId="ep-1"
        mode="free"
        showId="show-1"
        showSlug="the-scarlet-oath"
        autoplay={false}
      />,
    );
    expect(document.querySelector("button")).not.toBeNull();
    expectServedByMux();
  });

  it("the player's loading splash", () => {
    // A background-tab land: the autoplay probe waits for visibility, so
    // the splash — the same still at 40% — is what stays on screen.
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(
      <Player
        episodes={[EPISODE]}
        initialEpisodeId="ep-1"
        mode="free"
        showId="show-1"
        showSlug="the-scarlet-oath"
      />,
    );
    expect(document.body.textContent).toContain(en.watch.loading);
    expectServedByMux();
  });

  it("the episodes overlay", () => {
    render(
      <EpisodesOverlay
        episodes={[EPISODE]}
        currentEpisodeId="ep-1"
        showSlug="the-scarlet-oath"
        mode="free"
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expectServedByMux();
  });

  it("the up-next card", () => {
    render(
      <UpNextOverlay
        next={EPISODE}
        showSlug="the-scarlet-oath"
        onPlayNow={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expectServedByMux();
  });

  it("the sign-up wall's backdrop", () => {
    render(
      <SignupWall
        showSlug="the-scarlet-oath"
        showId="show-1"
        targetEpisodeId="ep-1"
        episodeNumber={1}
        memberCount={2}
        backdropThumbnailUrl={STILL}
      />,
    );
    expectServedByMux();
  });
});
