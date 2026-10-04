/** @vitest-environment jsdom */
import { act, createElement, forwardRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelEpisode } from "@/components/episodes-panel";
import { LocaleProvider } from "@/i18n/locale";
import type { Storyboard } from "@/watch/storyboard";

// The landscape player's glass chrome (#375, board E «Стекло») on its own,
// rendered for real on react-native-web: capsules, taps, the auto-hide, the
// double tap, the scrub bar and its preview, «Skip intro», the end card, the
// episodes panel, and what VoiceOver gets. The feed's wiring of it (the
// <Video> it drives) is pinned in watch/episode-feed.test.tsx.

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

const h = vi.hoisted(() => ({
  screenReader: false,
  // The chrome's screenReaderChanged listener, for a case that turns
  // VoiceOver off mid-episode; and what it announced.
  screenReaderListener: null as null | ((enabled: boolean) => void),
  announced: [] as string[],
  // Views that carry accessibility actions — react-native-web drops the
  // props, so the wrapper below records them for the adjustable scrub bar.
  actionable: [] as Array<{
    label?: string;
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => void;
    onAccessibilityTap?: () => void;
  }>,
  images: [] as Array<{ source: { uri: string }; style: Record<string, number | string> }>,
}));

vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  type AnyProps = Record<string, unknown> & { children?: ReactNode };
  const View = forwardRef(function View(props: AnyProps, ref) {
    if (props.accessibilityActions) {
      h.actionable.push({
        label: props.accessibilityLabel as string | undefined,
        onAccessibilityAction: props.onAccessibilityAction as never,
        onAccessibilityTap: props.onAccessibilityTap as never,
      });
    }
    return createElement(rn.View as never, { ...props, ref });
  });
  return {
    ...rn,
    View,
    AccessibilityInfo: {
      ...rn.AccessibilityInfo,
      isScreenReaderEnabled: async () => h.screenReader,
      addEventListener: (_event: string, listener: (enabled: boolean) => void) => {
        h.screenReaderListener = listener;
        return { remove: () => undefined };
      },
      announceForAccessibility: (message: string) => {
        h.announced.push(message);
      },
    },
  };
});
vi.mock("react-native-safe-area-context", () => ({
  // An iPhone with a Dynamic Island, in landscape.
  useSafeAreaInsets: () => ({ top: 0, bottom: 21, left: 59, right: 59 }),
}));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: ReactNode }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-image", () => ({
  Image: (props: { source: { uri: string }; style: Record<string, number | string> }) => {
    h.images.push(props);
    return null;
  },
}));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
// The locale module's own reach (the language choice in the keychain).
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));

import {
  AUTO_HIDE_MS,
  DOUBLE_TAP_MS,
  END_CARD_SECONDS,
  LandscapeChrome,
  type UpNext,
} from "./landscape-chrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const handlers = {
  onTogglePlay: vi.fn(),
  onSeek: vi.fn(),
  onBack: vi.fn(),
  onPip: vi.fn(),
  onNext: vi.fn(),
  onDismissEnd: vi.fn(),
  onSelectEpisode: vi.fn(),
};

const UP_NEXT: UpNext = {
  number: 3,
  title: "Sealed in Blood",
  durationSeconds: 780,
  thumbnailUrl: null,
  toneKey: "show-ep3",
};

const EPISODES: PanelEpisode[] = [
  {
    id: "ep1",
    number: 1,
    title: "Into the Dark",
    durationSeconds: 540,
    thumbnailUrl: null,
    toneKey: "a",
    locked: false,
    fraction: 1,
    current: false,
  },
  {
    id: "ep2",
    number: 2,
    title: "Echoes of Days Gone By",
    durationSeconds: 960,
    thumbnailUrl: null,
    toneKey: "b",
    locked: false,
    fraction: 0.4,
    current: true,
  },
  {
    id: "ep3",
    number: 3,
    title: "Sealed in Blood",
    durationSeconds: 780,
    thumbnailUrl: null,
    toneKey: "c",
    locked: "signup_required",
    fraction: 0,
    current: false,
  },
  {
    id: "ep4",
    number: 4,
    title: "The Oath",
    durationSeconds: 600,
    thumbnailUrl: null,
    toneKey: "d",
    locked: "subscribe_required",
    fraction: 0,
    current: false,
  },
];

type Props = Parameters<typeof LandscapeChrome>[0];

// Renders, then lets the screen-reader query settle.
async function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    showTitle: "The Scarlet Oath",
    episodeTitle: "Echoes of Days Gone By",
    episodeNumber: 2,
    positionSeconds: 372,
    durationSeconds: 960,
    paused: false,
    buffering: false,
    intro: null,
    upNext: UP_NEXT,
    autoplay: true,
    endDismissed: false,
    storyboard: null,
    episodes: EPISODES,
    seasonNumber: 1,
    ...handlers,
    ...overrides,
  };
  act(() => root.render(<LandscapeChrome {...props} />));
  await flush();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const byLabel = (label: string) =>
  container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const text = () => container.textContent ?? "";

function click(el: Element | null) {
  if (!el) throw new Error("nothing to click");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function leaf(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  return node;
}

beforeEach(() => {
  h.screenReader = false;
  h.screenReaderListener = null;
  h.announced.length = 0;
  h.actionable.length = 0;
  h.images.length = 0;
  for (const fn of Object.values(handlers)) fn.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const controlsShown = () => byTestId("landscape-controls") !== null;
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

// A storyboard of two 256×144 tiles side by side in one sprite.
const SPRITE = "https://image.mux.com/pb/storyboard.jpg?token=sb";
const BOARD: Storyboard = {
  tiles: [
    { start: 0, end: 480, url: SPRITE, x: 0, y: 0, width: 256, height: 144 },
    { start: 480, end: 960, url: SPRITE, x: 256, y: 0, width: 256, height: 144 },
  ],
  sprites: { [SPRITE]: { width: 512, height: 144 } },
};

// A drag along the scrub bar, through react-native-web's responder system:
// the rail is laid out 400pt wide, and jsdom measures every box at 0,0 —
// so a press at clientX = n lands n points into the rail.
function scrub(fromX: number, toX: number, { release = true } = {}) {
  const bar = byTestId("scrub-bar");
  if (!bar) throw new Error("no scrub bar");
  const layout = (bar as unknown as { __reactLayoutHandler: (e: unknown) => void })
    .__reactLayoutHandler;
  act(() => layout({ nativeEvent: { layout: { x: 200, y: 0, width: 400, height: 44 } } }));
  const mouse = (type: string, x: number) =>
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, button: 0 });
  act(() => {
    bar.dispatchEvent(mouse("mousedown", fromX));
  });
  act(() => {
    document.dispatchEvent(mouse("mousemove", toX));
  });
  if (release) {
    act(() => {
      document.dispatchEvent(mouse("mouseup", toX));
    });
  }
}

describe("LandscapeChrome — three glass capsules (#375)", () => {
  it("the title capsule, the picture-in-picture capsule and the bar — and no AirPlay button", async () => {
    await render();

    expect(byTestId("capsule-title")).not.toBeNull();
    expect(byTestId("capsule-pip")).not.toBeNull();
    expect(byTestId("capsule-bar")).not.toBeNull();
    expect(text()).toContain("The Scarlet Oath");
    expect(text()).toContain("Ep. 2 · Echoes of Days Gone By");
    // Elapsed and remaining, either side of the bar.
    expect(text()).toContain("6:12");
    expect(text()).toContain("−9:48");
    // AirPlay needs a native route picker — a new dependency (registry).
    expect(container.innerHTML).not.toMatch(/airplay/i);
  });

  it("they keep 6pt inside the notch strip and 12pt off the top; the bar floats 8pt over the home indicator", async () => {
    await render();

    const title = getComputedStyle(byTestId("capsule-title")!);
    expect({ top: title.top, left: title.left }).toEqual({ top: "12px", left: "65px" });
    expect(getComputedStyle(byTestId("capsule-pip")!).right).toBe("65px");
    const bar = getComputedStyle(byTestId("capsule-bar")!);
    expect({ left: bar.left, right: bar.right, bottom: bar.bottom }).toEqual({
      left: "65px",
      right: "65px",
      bottom: "29px",
    });
  });

  it("every control tells VoiceOver what it does; the bar is one adjustable element valued in time", async () => {
    await render();

    for (const label of [
      "Back to show",
      "Play/Pause",
      "Back 10 seconds",
      "Forward 10 seconds",
      "Episodes",
      "Next episode",
      "Picture in Picture",
    ]) {
      expect(byLabel(label), label).not.toBeNull();
    }
    expect(byLabel("Play/Pause")?.getAttribute("aria-valuetext")).toBe("Playing");
    const bar = byLabel("Playback position");
    expect(bar?.getAttribute("role")).toBe("slider");
    expect(bar?.getAttribute("aria-valuetext")).toBe("6:12 of 16:00");
  });

  it("speaks the app's language: in Spanish the pill, the bar's value and the PiP button too", async () => {
    act(() =>
      root.render(
        <LocaleProvider initial="es">
          <LandscapeChrome
            showTitle="The Scarlet Oath"
            episodeTitle="Ecos"
            episodeNumber={2}
            positionSeconds={372}
            durationSeconds={960}
            paused={false}
            buffering={false}
            intro={null}
            upNext={UP_NEXT}
            autoplay
            endDismissed={false}
            storyboard={null}
            episodes={EPISODES}
            seasonNumber={1}
            {...handlers}
          />
        </LocaleProvider>,
      ),
    );
    await flush();

    expect(leaf("Pausa")).toBeTruthy();
    expect(byLabel("Posición de reproducción")?.getAttribute("aria-valuetext")).toBe(
      "6:12 de 16:00",
    );
    expect(byLabel("Imagen en imagen")).not.toBeNull();
    expect(byLabel("Reproducir / Pausar")?.getAttribute("aria-valuetext")).toBe("Reproduciendo");
  });

  it("«‹» goes back; the picture-in-picture button asks for the window", async () => {
    await render();

    click(byLabel("Back to show"));
    click(byLabel("Picture in Picture"));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onPip).toHaveBeenCalledTimes(1);
  });
});

describe("LandscapeChrome — showing and hiding", () => {
  it("a tap on the picture hides the chrome, the next brings it back", async () => {
    await render();
    expect(controlsShown()).toBe(true);

    click(byTestId("tap-centre"));
    expect(controlsShown()).toBe(false);
    // Hidden means gone from the tree: nothing invisible for VoiceOver to land on.
    expect(byLabel("Back to show")).toBeNull();

    click(byTestId("tap-centre"));
    expect(controlsShown()).toBe(true);
  });

  it("hides itself 4 s into playback — not while paused", async () => {
    vi.useFakeTimers();
    await render();
    advance(AUTO_HIDE_MS - 1);
    expect(controlsShown()).toBe(true);
    advance(1);
    expect(controlsShown()).toBe(false);

    await render({ paused: true });
    expect(controlsShown()).toBe(true);
    advance(AUTO_HIDE_MS * 3);
    expect(controlsShown()).toBe(true);
  });

  it("every press starts the 4 s over", async () => {
    vi.useFakeTimers();
    await render();
    advance(3_000);
    click(byLabel("Forward 10 seconds"));
    advance(3_000);
    expect(controlsShown()).toBe(true);
    advance(1_000);
    expect(controlsShown()).toBe(false);
  });

  it("a pause brings it back, with the play disc in the middle", async () => {
    vi.useFakeTimers();
    await render();
    advance(AUTO_HIDE_MS);
    expect(controlsShown()).toBe(false);

    // The lock screen's pause, a call, the end of the episode.
    await render({ paused: true });

    expect(controlsShown()).toBe(true);
    click(byLabel("Play"));
    expect(handlers.onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("stays up while a screen reader runs — no auto-hide, and a tap cannot hide it", async () => {
    vi.useFakeTimers();
    h.screenReader = true;
    await render();

    advance(AUTO_HIDE_MS * 3);
    expect(controlsShown()).toBe(true);
    click(byTestId("tap-centre"));
    expect(controlsShown()).toBe(true);
    // Nothing to reveal, so the picture is no VoiceOver element.
    expect(byTestId("tap-centre")?.getAttribute("role")).toBeNull();

    // VoiceOver turned off mid-episode: the auto-hide is back.
    act(() => h.screenReaderListener?.(false));
    advance(AUTO_HIDE_MS);
    expect(controlsShown()).toBe(false);
  });

  it("once hidden, it leaves one element behind — «Show player controls» — for Switch Control / Full Keyboard Access / Voice Control", async () => {
    await render();
    // While the chrome is up the picture is no accessibility element.
    expect(byTestId("tap-centre")?.getAttribute("role")).toBeNull();
    expect(byTestId("tap-centre")?.getAttribute("aria-label")).toBeNull();

    click(byTestId("tap-centre"));
    expect(controlsShown()).toBe(false);
    const reveal = byLabel("Show player controls");
    expect(reveal).toBe(byTestId("tap-centre"));
    expect(reveal?.getAttribute("role")).toBe("button");
    // The sides stay out of reach: one button, not three.
    expect(byTestId("tap-left")?.getAttribute("role")).toBeNull();

    click(reveal);
    expect(controlsShown()).toBe(true);
    expect(byLabel("Show player controls")).toBeNull();
  });

  it("a stall shows the spinner disc, the pill spins too, and the chrome waits", async () => {
    vi.useFakeTimers();
    await render({ buffering: true });
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(2);

    advance(AUTO_HIDE_MS * 2);
    expect(controlsShown()).toBe(true);
  });
});

describe("LandscapeChrome — play, pause and seek", () => {
  it("the gold pill plays and pauses, and says which it will do", async () => {
    await render();
    expect(leaf("Pause")).toBeTruthy();

    click(byLabel("Play/Pause"));
    expect(handlers.onTogglePlay).toHaveBeenCalledTimes(1);

    await render({ paused: true });
    expect(leaf("Play")).toBeTruthy();
    expect(byLabel("Play/Pause")?.getAttribute("aria-valuetext")).toBe("Paused");
  });

  it("−10 / +10 seek from the playhead, never past either end", async () => {
    await render();
    click(byLabel("Forward 10 seconds"));
    click(byLabel("Back 10 seconds"));
    expect(handlers.onSeek.mock.calls).toEqual([[382], [362]]);

    handlers.onSeek.mockClear();
    await render({ positionSeconds: 4 });
    click(byLabel("Back 10 seconds"));
    // The last episode: no end card over the bar this close to the end.
    await render({ positionSeconds: 955, upNext: null });
    click(byLabel("Forward 10 seconds"));
    // A tap is never the episode's end: the last second at most.
    expect(handlers.onSeek.mock.calls).toEqual([[0], [959]]);
  });

  it("a double tap on a side is −10 / +10, with a mark that fades, and the chrome as it was", async () => {
    vi.useFakeTimers();
    await render();

    click(byTestId("tap-left"));
    click(byTestId("tap-left"));
    expect(handlers.onSeek).toHaveBeenLastCalledWith(362);
    expect(text()).toContain("10 sec");
    advance(DOUBLE_TAP_MS);
    expect(controlsShown()).toBe(true);
    advance(750);
    expect(text()).not.toContain("10 sec");

    click(byTestId("tap-right"));
    click(byTestId("tap-right"));
    expect(handlers.onSeek).toHaveBeenLastCalledWith(382);
  });

  it("one tap on a side waits for a possible second before it toggles", async () => {
    vi.useFakeTimers();
    await render();

    click(byTestId("tap-right"));
    expect(controlsShown()).toBe(true);
    advance(DOUBLE_TAP_MS);

    expect(controlsShown()).toBe(false);
    expect(handlers.onSeek).not.toHaveBeenCalled();
  });

  it("the scrub bar previews the storyboard frame over the knob and seeks once, on release", async () => {
    await render({ storyboard: BOARD });

    scrub(100, 200, { release: false });
    // Half-way along the rail: 8:00 of 16:00, the sprite's second tile.
    expect(byTestId("scrub-preview")?.textContent).toBe("8:00");
    expect(byTestId("storyboard-frame")).not.toBeNull();
    const sprite = h.images.at(-1);
    expect(sprite?.source.uri).toBe(SPRITE);
    // 170×96 out of 256×144 tiles: the sprite shifted one tile to the left.
    expect(sprite?.style.left).toBeCloseTo(-170);
    expect(sprite?.style.width).toBeCloseTo(340);
    expect(handlers.onSeek).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200, button: 0 }));
    });
    expect(handlers.onSeek).toHaveBeenCalledWith(480);
    expect(byTestId("scrub-preview")).toBeNull();
  });

  it("without a storyboard the preview is the time alone", async () => {
    await render({ storyboard: null });

    scrub(100, 300, { release: false });

    expect(byTestId("scrub-preview")?.textContent).toBe("12:00");
    expect(byTestId("storyboard-frame")).toBeNull();
  });

  it("VoiceOver's swipe up / down on the bar is +10 / −10 s", async () => {
    await render();
    const bar = h.actionable.findLast((v) => v.label === "Playback position");
    if (!bar) throw new Error("the scrub bar carries no accessibility actions");

    act(() => bar.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    act(() => bar.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } }));

    expect(handlers.onSeek.mock.calls).toEqual([[382], [362]]);
  });

  it("a VoiceOver double tap on the bar is handled as nothing — no synthetic touch, no jump to the middle", async () => {
    await render();
    const bar = h.actionable.findLast((v) => v.label === "Playback position");

    // iOS sends a touch at the element's centre only when activation is NOT
    // handled; a handler makes accessibilityActivate answer YES.
    expect(typeof bar?.onAccessibilityTap).toBe("function");
    act(() => bar?.onAccessibilityTap?.());
    expect(handlers.onSeek).not.toHaveBeenCalled();
  });
});

describe("LandscapeChrome — «Skip intro»", () => {
  it("only for an episode with intro marks, and only inside them", async () => {
    await render({ positionSeconds: 9, intro: null });
    expect(text()).not.toContain("Skip intro");

    await render({ positionSeconds: 9, intro: { start: 0, end: 38 } });
    click(leaf("Skip intro"));
    expect(handlers.onSeek).toHaveBeenCalledWith(38);

    await render({ positionSeconds: 40, intro: { start: 0, end: 38 } });
    expect(text()).not.toContain("Skip intro");
  });
});

describe("LandscapeChrome — the end of an episode", () => {
  const NEAR_END = 960 - 9;

  it("with autoplay: the next episode, a ring and the count to the advance — over the bar, which stays", async () => {
    vi.useFakeTimers();
    await render({ positionSeconds: NEAR_END });

    expect(byTestId("end-card")).not.toBeNull();
    expect(text()).toContain("Up next");
    expect(text()).toContain("Ep. 3 · Sealed in Blood");
    expect(text()).toContain("13 min");
    expect(text()).toContain("Watch now · 9");
    expect(byTestId("countdown-ring")).not.toBeNull();
    // Over the bar (21 + 8 + 64 + 12) while the bar shows…
    expect(controlsShown()).toBe(true);
    expect(getComputedStyle(byTestId("end-card")!).bottom).toBe("105px");
    // …and in its place once the bar has hidden itself.
    advance(AUTO_HIDE_MS);
    expect(controlsShown()).toBe(false);
    expect(getComputedStyle(byTestId("end-card")!).bottom).toBe("29px");

    click(leaf("Watch now · 9"));
    click(leaf("Cancel"));
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onDismissEnd).toHaveBeenCalledTimes(1);
  });

  it("VoiceOver hears the card arrive, once — and keeps «‹», Play/Pause and the bar while it shows", async () => {
    h.screenReader = true;
    await render({ positionSeconds: 900 });
    expect(h.announced).toEqual([]);

    await render({ positionSeconds: NEAR_END });
    await render({ positionSeconds: NEAR_END + 1 });

    expect(h.announced).toEqual(["Up next: Ep. 3 · Sealed in Blood"]);
    expect(byTestId("end-card")).not.toBeNull();
    for (const label of ["Back to show", "Play/Pause", "Playback position"]) {
      expect(byLabel(label), label).not.toBeNull();
    }
  });

  it("a pause inside the card's window keeps the way to play on and to leave", async () => {
    await render({ positionSeconds: NEAR_END, paused: true });

    expect(byTestId("end-card")).not.toBeNull();
    click(byLabel("Play"));
    expect(handlers.onTogglePlay).toHaveBeenCalledTimes(1);
    click(byLabel("Back to show"));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it("autoplay off: the card waits — no ring, no count", async () => {
    await render({ positionSeconds: NEAR_END, autoplay: false });

    expect(leaf("Watch now")).toBeTruthy();
    expect(text()).not.toContain("Watch now ·");
    expect(byTestId("countdown-ring")).toBeNull();
  });

  it("not before its window, not after Cancel, never after the last episode", async () => {
    await render({ positionSeconds: 960 - END_CARD_SECONDS - 1 });
    expect(byTestId("end-card")).toBeNull();

    await render({ positionSeconds: NEAR_END, endDismissed: true });
    expect(byTestId("end-card")).toBeNull();
    expect(controlsShown()).toBe(true);

    await render({ positionSeconds: 960, upNext: null, paused: true });
    expect(byTestId("end-card")).toBeNull();
    expect(byLabel("Next episode")?.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("LandscapeChrome — the episodes panel", () => {
  it("opens from the bar in place of the chrome: the season, the episodes, the current one in gold", async () => {
    await render();
    click(byLabel("Episodes"));

    expect(byTestId("episodes-panel")).not.toBeNull();
    expect(controlsShown()).toBe(false);
    expect(text()).toContain("Season 1");
    expect(text()).toContain("1. Into the Dark");
    expect(text()).toContain("9 min");
    expect(
      byLabel("2. Echoes of Days Gone By, 16 min, Now playing")?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("a locked episode carries a lock and says why — never a purchase word (3.1.1)", async () => {
    await render();
    click(byLabel("Episodes"));

    expect(byLabel("3. Sealed in Blood, Locked episode, Create account")).not.toBeNull();
    expect(byLabel("4. The Oath, Locked episode, Subscribers only")).not.toBeNull();
    expect(text()).not.toMatch(/\bSubscribe\b|\$/);
  });

  it("a row goes to its episode; «×» closes back to the chrome", async () => {
    await render();
    click(byLabel("Episodes"));
    click(byLabel("1. Into the Dark, 9 min"));

    expect(handlers.onSelectEpisode).toHaveBeenCalledWith(0);
    expect(byTestId("episodes-panel")).toBeNull();

    click(byLabel("Episodes"));
    click(byLabel("Close"));
    expect(byTestId("episodes-panel")).toBeNull();
    expect(controlsShown()).toBe(true);
  });

  it("a tap on the picture outside it closes it too", async () => {
    await render();
    click(byLabel("Episodes"));
    click(byTestId("tap-left"));

    expect(byTestId("episodes-panel")).toBeNull();
    expect(handlers.onSeek).not.toHaveBeenCalled();
  });
});

