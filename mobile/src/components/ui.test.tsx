/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #292 — the shared pieces behind four of the visible polish items, rendered
// for real in jsdom on react-native-web:
//   1. an error state has a visible «Back» next to (or instead of) «Try
//      again», and it does what it says;
//   5. the vertical player shows a quiet spinner while the stream stalls;
//   6. the gold CTA carries ▶ only when asked to — Try again, Send code and
//      the rest are not «play»;
//  10. artwork is fetched through the site's image optimizer at the width it
//      is drawn, not as the 2–15 MB original.

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

// expo-image, reduced to the source it is handed.
const images = vi.hoisted(() => ({ sources: [] as unknown[] }));
vi.mock("expo-image", () => ({
  Image: (props: { source: unknown }) => {
    images.sources.push(props.source);
    return null;
  },
}));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { Artwork, ErrorState, GoldButton, PosterCard } from "@/components/ui";
import { VerticalChrome } from "@/components/vertical-chrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const text = () => container.textContent ?? "";
const glyphs = () => container.querySelectorAll('[data-testid="play-glyph"]').length;
const spinning = () => container.querySelector('[role="progressbar"]') !== null;

function render(element: ReactNode) {
  act(() => root.render(element));
}

function press(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// react-native-web's PixelRatio reads the window's scale, which Dimensions
// re-reads on resize.
function setPixelRatio(ratio: number) {
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: ratio });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  images.sources.length = 0;
  setPixelRatio(1);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ErrorState — the way out of a dead end (#292 item 1)", () => {
  it("«Back» sits next to «Try again», and each does its own thing", () => {
    const onRetry = vi.fn();
    const onBack = vi.fn();
    render(<ErrorState message="Couldn't load this show" onRetry={onRetry} onBack={onBack} />);

    press("Back");
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();

    press("Try again");
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a state nothing can retry offers only «Back»", () => {
    const onBack = vi.fn();
    render(<ErrorState message="Show not found" onBack={onBack} />);

    expect(text()).not.toContain("Try again");
    press("Back");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a state with no way back offers none", () => {
    render(<ErrorState message="Couldn't reach Matio" onRetry={() => undefined} />);
    expect(text()).not.toContain("Back");
  });
});

describe("GoldButton — ▶ only on play buttons (#292 item 6)", () => {
  it("draws no ▶ unless told it starts playback", () => {
    render(<GoldButton label="Send code" />);
    expect(glyphs()).toBe(0);

    render(<GoldButton label="Play · Ep. 1" glyph="play" />);
    expect(glyphs()).toBe(1);
  });

  it("«Try again» is not a play button", () => {
    render(<ErrorState message="Playback unavailable" onRetry={() => undefined} />);
    expect(text()).toContain("Try again");
    expect(glyphs()).toBe(0);
  });
});

const BLOB = "https://waoyoctqyyvecbhm.public.blob.vercel-storage.com/shows/poster-scarlet.png";

describe("Artwork — resized through the site's image optimizer (#292 item 10)", () => {
  const lastUri = () => (images.sources.at(-1) as { uri: string } | undefined)?.uri;
  const params = (uri: string | undefined) => new URL(uri ?? "").searchParams;

  it("asks for the drawn width × the pixel ratio, snapped up to a width the optimizer allows", () => {
    setPixelRatio(3);
    render(<Artwork uri={BLOB} toneKey="the-scarlet-oath" displayWidth={262} />);

    const uri = lastUri();
    expect(uri?.startsWith("https://matio.tv/_next/image?")).toBe(true);
    expect(params(uri).get("url")).toBe(BLOB);
    // 262pt × 3 = 786px → 828, the next allowed width.
    expect(params(uri).get("w")).toBe("828");
    expect(params(uri).get("q")).toBe("75");
  });

  it("a poster card asks for less on a 2x screen than on a 3x one", () => {
    setPixelRatio(2);
    render(<PosterCard title="Fallen" posterUrl={BLOB} slug="fallen" />);
    expect(params(lastUri()).get("w")).toBe("384");

    setPixelRatio(3);
    render(<PosterCard title="Fallen" posterUrl={BLOB} slug="fallen" width={149} />);
    expect(params(lastUri()).get("w")).toBe("640");
  });

  it("an old same-origin poster goes to the optimizer as its path", () => {
    render(
      <Artwork
        uri="https://matio.tv/shows/cartero-mundo-poster.png"
        toneKey="cartero-mundo"
        displayWidth={358}
      />,
    );
    expect(params(lastUri()).get("url")).toBe("/shows/cartero-mundo-poster.png");
  });

  // The optimizer answers WebP only to an Accept that names it; expo-image's
  // own (SDWebImage: `image/*,*/*;q=0.8`) does not, and would get the PNG
  // back, resized.
  it("asks the optimizer for WebP with the request's Accept header", () => {
    render(<Artwork uri={BLOB} toneKey="the-scarlet-oath" displayWidth={262} />);

    expect(images.sources.at(-1)).toEqual({
      uri: lastUri(),
      headers: { Accept: "image/webp,image/*;q=0.8" },
    });
  });

  it("a signed Mux thumbnail, and art with no drawn width given, load as they are — no extra header", () => {
    const mux = "https://image.mux.com/pb/thumbnail.jpg?token=eyJ.dummy.sig";
    render(<Artwork uri={mux} toneKey="ep" displayWidth={128} />);
    expect(images.sources.at(-1)).toEqual({ uri: mux });

    render(<Artwork uri={BLOB} toneKey="the-scarlet-oath" />);
    expect(images.sources.at(-1)).toEqual({ uri: BLOB });
  });

  it("no artwork is the tone fallback — nothing is fetched", () => {
    render(<Artwork uri={null} toneKey="the-scarlet-oath" displayWidth={262} />);
    expect(images.sources).toEqual([]);
  });
});

describe("VerticalChrome — a stall is visible (#292 item 5)", () => {
  const chrome = (over: { paused?: boolean; buffering?: boolean }) => (
    <VerticalChrome
      showTitle="The Scarlet Oath"
      episodeTitle="Episode 1"
      episodeNumber={1}
      positionSeconds={30}
      durationSeconds={600}
      paused={false}
      muted={false}
      onTogglePlay={() => undefined}
      onToggleMute={() => undefined}
      onBack={() => undefined}
      {...over}
    />
  );

  it("shows the spinner while the player buffers, and nothing over the picture otherwise", () => {
    render(chrome({ buffering: true }));
    expect(spinning()).toBe(true);

    render(chrome({ buffering: false }));
    expect(spinning()).toBe(false);
  });

  it("a paused page shows its play disc, not a spinner, even mid-buffer", () => {
    render(chrome({ paused: true, buffering: true }));
    expect(spinning()).toBe(false);
  });
});
