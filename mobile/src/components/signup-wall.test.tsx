/** @vitest-environment jsdom */
import { act, createElement, forwardRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/shared/api-types";

// #484 — the sign-up wall inside the safe area, and scrollable. The landscape
// player hands it a phone's Dynamic Island insets (59pt at either side) and
// a ~390pt-high screen; the column must keep clear of both and scroll when it
// does not fit. Rendered for real in jsdom on react-native-web; the insets
// and the config are faked. ScrollView is wrapped to record the props
// react-native-web drops (the iOS bounce).

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

const scrollViews = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  const ScrollView = forwardRef(function ScrollView(
    props: Record<string, unknown> & { children?: ReactNode },
    ref,
  ) {
    scrollViews.props.push(props);
    return createElement(rn.ScrollView as never, { ...props, ref });
  });
  return { ...rn, ScrollView };
});

const safeArea = vi.hoisted(() => ({ insets: { top: 0, bottom: 0, left: 0, right: 0 } }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => safeArea.insets,
}));
vi.mock("@/api/config-context", () => ({
  useConfig: (): Partial<AppConfig> => ({
    flags: { paymentsEnabled: true, downloadsEnabled: false, castEnabled: false },
    signupGate: { mode: "after_episodes", episodes: 1 },
  }),
}));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: ReactNode }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

import { SCREEN_PAD } from "@/theme";
import { SignupWall } from "./signup-wall";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// An iPhone with a Dynamic Island, on its side — the landscape player.
const LANDSCAPE = { top: 0, bottom: 21, left: 59, right: 59 };
// The same phone upright.
const PORTRAIT = { top: 59, bottom: 34, left: 0, right: 0 };

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => root.render(<SignupWall onSignIn={() => undefined} onBack={() => undefined} />));
}

// The wall's scroll view and the column inside it — react-native-web draws
// a ScrollView as a scrolling element around its content container.
function wall() {
  const scroller = container.querySelector<HTMLElement>('[data-testid="signup-wall"]');
  const column = scroller?.firstElementChild as HTMLElement | null | undefined;
  if (!scroller || !column) throw new Error("no sign-up wall");
  return { scroller, column };
}

function leaf(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  return node;
}

const px = (n: number) => `${n}px`;
const padding = (el: HTMLElement) => {
  const s = getComputedStyle(el);
  return { top: s.paddingTop, right: s.paddingRight, bottom: s.paddingBottom, left: s.paddingLeft };
};

beforeEach(() => {
  scrollViews.props.length = 0;
  safeArea.insets = { top: 0, bottom: 0, left: 0, right: 0 };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SignupWall — the safe area and a column that scrolls (#484)", () => {
  it("landscape on a Dynamic Island phone: clear of the island at either side, and every line inside a scrolling container", () => {
    safeArea.insets = LANDSCAPE;
    render();
    const { scroller, column } = wall();

    const { left, right, top, bottom } = padding(column);
    expect(parseFloat(left)).toBeGreaterThanOrEqual(59);
    expect(parseFloat(right)).toBeGreaterThanOrEqual(59);
    // Top and bottom alike — the larger inset — so the column stays centred.
    expect({ top, bottom }).toEqual({ top: px(21), bottom: px(21) });

    expect(getComputedStyle(scroller).overflowY).toMatch(/^(auto|scroll)$/);
    for (const line of [
      "Keep watching free",
      "Create your account",
      "Create free account",
      "Not now",
      "No card needed. Just an email.",
    ]) {
      expect(scroller.contains(leaf(line)), line).toBe(true);
    }
  });

  it("with no insets: SCREEN_PAD at the sides, as before — and off the top and bottom", () => {
    render();

    expect(padding(wall().column)).toEqual({
      top: px(SCREEN_PAD),
      right: px(SCREEN_PAD),
      bottom: px(SCREEN_PAD),
      left: px(SCREEN_PAD),
    });
  });

  it("portrait: the sides keep SCREEN_PAD, and top and bottom take the larger inset — centred where it always was", () => {
    safeArea.insets = PORTRAIT;
    render();

    expect(padding(wall().column)).toEqual({
      top: px(59),
      right: px(SCREEN_PAD),
      bottom: px(59),
      left: px(SCREEN_PAD),
    });
  });

  it("a column that fits does not bounce — in the vertical feed a swipe on the wall still pages the feed", () => {
    render();

    const wallScroll = scrollViews.props.find((p) => p.testID === "signup-wall");
    expect(wallScroll?.alwaysBounceVertical).toBe(false);
  });
});
