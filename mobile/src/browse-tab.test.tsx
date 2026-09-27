/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, forwardRef, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowSummary } from "@/shared/api-types";

// #304 — the Browse tab, rendered for real in jsdom on react-native-web; the
// catalog, the router and native modules are faked.
//   item 8: the chips and the search field's «×» are ≥44pt targets, grown by
//           hitSlop alone — not one layout value moved — and only where
//           iOS actually delivers a touch: inside the parent's own box;
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
  texts: [] as Props[],
}));
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  const Text = forwardRef(function Text(props: Props, ref) {
    rec.texts.push(props);
    return createElement(rn.Text as never, { ...props, ref });
  });
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
  return { ...rn, Text, Pressable, ScrollView, FlatList };
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
  rec.texts.length = 0;
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

// The natural line height iOS gives a font with no lineHeight set:
// (hhea ascender − descender + lineGap) / unitsPerEm, read from the TTF the
// app bundles — so «≥44pt» below rests on the real font, not on a guess.
function lineHeightEm(fontFile: string): number {
  const ttf = readFileSync(fontFile);
  const tableCount = ttf.readUInt16BE(4);
  const offsetOf = (tag: string) => {
    for (let i = 0; i < tableCount; i += 1) {
      const at = 12 + 16 * i;
      if (ttf.toString("latin1", at, at + 4) === tag) return ttf.readUInt32BE(at + 8);
    }
    throw new Error(`no ${tag} table`);
  };
  const hhea = offsetOf("hhea");
  const unitsPerEm = ttf.readUInt16BE(offsetOf("head") + 18);
  const [ascender, descender, lineGap] = [4, 6, 8].map((o) => ttf.readInt16BE(hhea + o));
  return (ascender - descender + lineGap) / unitsPerEm;
}
// (A path, not `import.meta.url`: under jsdom that URL is not a file: one.)
const GEIST_SEMIBOLD = path.join(
  import.meta.dirname,
  "../node_modules/@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf",
);
// iOS's smallest Larger Text step (xSmall) against the default (Large): the
// body style's 14pt against 17pt.
const XSMALL_FONT_SCALE = 14 / 17;

describe("Browse — 44pt targets by hitSlop, no layout moved (#304 item 8)", () => {
  const flat = (style: unknown): ViewStyle & TextStyle =>
    StyleSheet.flatten(style as StyleProp<ViewStyle & TextStyle>);
  type Slop = { top: number; bottom: number; left: number; right: number };

  it("every chip reaches ≥44pt through slop that stays inside the row — and no layout value moved", () => {
    catalog.shows = [
      show("fallen", "Fallen", ["Drama"]),
      show("morelli", "Morelli", ["Sci-Fi"], true),
    ];
    renderBrowse();

    // The chips' Pressables: the ones carrying a selected state (All, Drama,
    // Sci-fi, Vertical).
    const chips = rec.pressables.filter((p) => p.accessibilityState !== undefined);
    expect(chips.length).toBeGreaterThanOrEqual(4);
    const row = flat(rec.scrollViews.at(-1)?.contentContainerStyle);
    const slop = chips[0].hitSlop as Slop;
    for (const chip of chips) {
      // Upward only: the gap above is empty; sideways would take a
      // neighbour's taps, and below is the grid.
      expect(chip.hitSlop).toEqual({ top: row.paddingTop, bottom: 0, left: 0, right: 0 });
      // The Pressable itself adds no size: no padding, margin or minimum.
      const style = flat((chip.style as (s: { pressed: boolean }) => unknown)({ pressed: false }));
      expect(Object.keys(style)).toEqual(["borderRadius"]);
    }

    // What a finger gets: the drawn chip — its padding around one line of
    // the label's font — plus the slop.
    const drawnBox = flat((chips.at(-1)?.children as ReactElement<{ style: unknown }>).props.style);
    const label = flat(rec.texts.filter((t) => t.children === "Drama").at(-1)?.style);
    expect(label.fontFamily).toBe("Geist_600SemiBold");
    const drawn = (scale: number) =>
      2 * (drawnBox.paddingVertical as number) +
      (label.fontSize as number) * scale * lineHeightEm(GEIST_SEMIBOLD);
    expect(drawn(1) + slop.top).toBeGreaterThanOrEqual(44);
    expect(drawn(XSMALL_FONT_SCALE) + slop.top).toBeGreaterThanOrEqual(44);

    // The slop lives in the row's own top PADDING — the gap under the search
    // field, as wide as it always was — because iOS hands a child a touch
    // only inside its parent's box. No margin left outside it.
    expect(row.marginTop).toBeUndefined();
    expect(row.paddingTop).toBe(space(3.5));
    expect(slop.top).toBeLessThanOrEqual(row.paddingTop as number);
    // And the grid starts where it did.
    expect(flat(rec.lists.at(-1)?.contentContainerStyle).paddingTop).toBe(space(4));
  });

  it("the search field's «×» reaches the 44pt pill's edges and stays out of the text field", () => {
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
    const slop = clear?.hitSlop as Slop;
    const glyph = flat(rec.texts.filter((t) => t.children === "×").at(-1)?.style);
    // 11 + the glyph's 22pt line + 11 = the pill's 44pt height, not beyond.
    expect(slop.top + (glyph.lineHeight as number) + slop.bottom).toBe(44);
    // 16 = the pill's right padding; to the left no further than the
    // space(2.5) gap before the text field.
    expect(slop.right).toBe(16);
    expect(slop.left).toBeLessThanOrEqual(space(2.5));
    expect(slop).toEqual({ top: 11, bottom: 11, left: 10, right: 16 });
  });
});
