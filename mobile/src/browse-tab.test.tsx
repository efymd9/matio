/** @vitest-environment jsdom */
import { act, createElement, forwardRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowSummary } from "@/shared/api-types";

// #304 — the Browse tab, rendered for real in jsdom on react-native-web; the
// catalog, the router and native modules are faked.
//   item 8: the chips and the search field's «×» are ≥44pt targets, and not
//           one pixel moved to make them so;
//   item 9: a chip a catalog refresh takes away (a genre renamed, the last
//           vertical show unpublished) gives the grid back to All — never an
//           empty «No shows match.» with nothing highlighted.
// (Not under app/ — a test file there would become an expo-router route.)

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

// What the screen hands its Pressables, ScrollViews and FlatLists: layout
// has no DOM form in jsdom, so geometry is read from the props. And
// react-native-web drops accessibilityState, so a Pressable's `selected` is
// written through as aria-selected — the DOM spelling of what VoiceOver hears.
type Props = Record<string, unknown> & { children?: ReactNode };
const rec = vi.hoisted(() => ({
  pressables: [] as Props[],
  scrollViews: [] as Props[],
  lists: [] as Props[],
}));
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  const Pressable = forwardRef(function Pressable(props: Props, ref) {
    rec.pressables.push(props);
    const selected = (props.accessibilityState as { selected?: boolean } | undefined)?.selected;
    return createElement(rn.Pressable as never, { ...props, "aria-selected": selected, ref });
  });
  const ScrollView = forwardRef(function ScrollView(props: Props, ref) {
    rec.scrollViews.push(props);
    return createElement(rn.ScrollView as never, { ...props, ref });
  });
  const FlatList = forwardRef(function FlatList(props: Props, ref) {
    rec.lists.push(props);
    return createElement(rn.FlatList as never, { ...props, ref });
  });
  return { ...rn, Pressable, ScrollView, FlatList };
});

// The catalog as the provider currently holds it; a case swaps it to play a
// background refresh.
const catalog = vi.hoisted(() => ({ shows: [] as ShowSummary[] }));
vi.mock("@/api/catalog-context", () => ({
  useCatalog: () => ({
    status: "ready",
    data: { shows: catalog.shows },
    error: null,
    retry: () => undefined,
    reload: async () => undefined,
  }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/glass-tab-bar", () => ({ useTabBarClearance: () => 0 }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
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

import BrowseScreen from "@/app/(tabs)/browse";
import { space } from "@/theme";

function show(slug: string, title: string, genre: string[], vertical = false): ShowSummary {
  return {
    id: slug,
    slug,
    title,
    synopsis: null,
    genre,
    orientation: vertical ? "vertical" : "horizontal",
    posterImageUrl: null,
    heroImageUrl: null,
    episodeCount: 3,
    featured: false,
    justReleased: false,
    popularNow: false,
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

function leaf(label: string): Element | undefined {
  return Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
}

function press(label: string) {
  const node = leaf(label);
  if (!node) throw new Error(`no element labelled ${label}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const selected = (label: string) =>
  leaf(label)?.closest("[aria-selected]")?.getAttribute("aria-selected") === "true";

// The same screen, re-rendered after the catalog provider's data changed.
function renderBrowse() {
  act(() => root.render(<BrowseScreen />));
}

beforeEach(() => {
  rec.pressables.length = 0;
  rec.scrollViews.length = 0;
  rec.lists.length = 0;
  catalog.shows = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Browse — a chip the catalog took away falls back to All (#304 item 9)", () => {
  it("a genre renamed under a selected chip gives the whole grid back, with All lit", () => {
    catalog.shows = [
      show("fallen", "Fallen", ["Drama"]),
      show("morelli", "Morelli", ["Sci-Fi"]),
    ];
    renderBrowse();
    press("Drama");
    expect(selected("Drama")).toBe(true);
    expect(text()).not.toContain("Morelli");

    // A background refresh: the admin renamed «Drama».
    catalog.shows = [
      show("fallen", "Fallen", ["Drama romántico"]),
      show("morelli", "Morelli", ["Sci-Fi"]),
    ];
    renderBrowse();

    expect(text()).not.toContain("No shows match.");
    expect(text()).toContain("Fallen");
    expect(text()).toContain("Morelli");
    expect(selected("All")).toBe(true);
  });

  it("the Vertical chip gives way to All once the last vertical show is unpublished", () => {
    catalog.shows = [
      show("fallen", "Fallen", ["Drama"]),
      show("morelli", "Morelli", ["Sci-Fi"], true),
    ];
    renderBrowse();
    press("Vertical");
    expect(text()).not.toContain("Fallen");

    catalog.shows = [show("fallen", "Fallen", ["Drama"])];
    renderBrowse();

    expect(text()).toContain("Fallen");
    expect(text()).not.toContain("No shows match.");
    expect(selected("All")).toBe(true);
  });

  it("the pick comes back to life if its chip does", () => {
    catalog.shows = [show("fallen", "Fallen", ["Drama"]), show("morelli", "Morelli", ["Sci-Fi"])];
    renderBrowse();
    press("Drama");

    catalog.shows = [show("morelli", "Morelli", ["Sci-Fi"])];
    renderBrowse();
    expect(selected("All")).toBe(true);

    catalog.shows = [show("fallen", "Fallen", ["Drama"]), show("morelli", "Morelli", ["Sci-Fi"])];
    renderBrowse();
    expect(selected("Drama")).toBe(true);
    expect(text()).not.toContain("Morelli");
  });
});

describe("Browse — 44pt targets, no pixel moved (#304 item 8)", () => {
  const flat = (style: unknown): ViewStyle => StyleSheet.flatten(style as StyleProp<ViewStyle>);
  // The chips' Pressables, as last rendered: the ones carrying a selected state.
  const chipTargets = () =>
    rec.pressables
      .filter((p) => p.accessibilityState !== undefined)
      .map((p) => flat((p.style as (s: { pressed: boolean }) => unknown)({ pressed: false })));

  it("every chip is at least 44pt to the finger, and gives its padding back to the row and the grid", () => {
    catalog.shows = [
      show("fallen", "Fallen", ["Drama"]),
      show("morelli", "Morelli", ["Sci-Fi"], true),
    ];
    renderBrowse();

    const targets = chipTargets();
    // All, Drama, Sci-fi, Vertical.
    expect(targets.length).toBeGreaterThanOrEqual(4);
    for (const style of targets) {
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.justifyContent).toBe("center");
    }
    const pad = targets[0].paddingVertical as number;
    expect(pad).toBeGreaterThan(0);
    expect(targets.every((s) => s.paddingVertical === pad)).toBe(true);

    // The visible chip still starts space(3.5) under the search field…
    const row = flat(rec.scrollViews.at(-1)?.contentContainerStyle);
    expect((row.marginTop as number) + pad).toBe(space(3.5));
    // …and the grid still starts space(4) under the visible chip.
    const grid = flat(rec.lists.at(-1)?.contentContainerStyle);
    expect((grid.paddingTop as number) + pad).toBe(space(4));
  });

  it("the search field's «×» reaches the 44pt pill's top and bottom edges", () => {
    catalog.shows = [show("fallen", "Fallen", ["Drama"])];
    renderBrowse();
    const input = container.querySelector("input");
    if (!input) throw new Error("no search field");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(input, "fal");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const clear = rec.pressables.filter((p) => p.accessibilityLabel === "Clear search").at(-1);
    // 11 + a 22pt line + 11 = the pill's 44; 16 = the pill's right padding.
    expect(clear?.hitSlop).toEqual({ top: 11, bottom: 11, left: 12, right: 16 });
  });
});
