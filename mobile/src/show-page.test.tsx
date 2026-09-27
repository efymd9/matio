/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, ShowDetail } from "@/shared/api-types";

// #311 — the show page, four display fixes from the 27.09 audit:
//   1. a subscriber-only row says «Subscribers only», never the purchase call
//      to action «Subscribe» / «Suscríbete» (App Store 3.1.1) — on screen and
//      to VoiceOver;
//   2. no generated synopsis («Watch it free online…») in place of a missing
//      one, and no About tab with nothing in it;
//   3. no hero image → the poster, as on Home and the web;
//   4. the genre chips go through Browse's rule: «Drama» + «drama» is one
//      chip, a blank entry is none.
// Rendered for real in jsdom on react-native-web; the router, the API and the
// native modules are faked. (Not under app/ — a test file there would become
// an expo-router route.)

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

// Every source expo-image is handed: the hero is the only Artwork with a URL
// in these fixtures (episode thumbnails are null), and the icons pass bundled
// assets, not `{ uri }`.
const images = vi.hoisted(() => ({ sources: [] as unknown[] }));
vi.mock("expo-image", () => ({
  Image: (props: { source?: unknown }) => {
    images.sources.push(props.source);
    return null;
  },
}));

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true };
vi.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ slug: "the-scarlet-oath" }),
}));

const current = vi.hoisted(() => ({ show: null as unknown }));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, api: { show: async () => current.show } };
});
vi.mock("@/api/config-context", () => ({
  useConfig: (): Partial<AppConfig> => ({ signupGate: { mode: "tiers" } }),
}));
vi.mock("@/auth/clerk", () => ({
  useOptionalAuth: () => ({ isLoaded: true, isSignedIn: false, stalled: false, retry: () => undefined }),
}));

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
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

import ShowScreen from "@/app/show/[slug]";
import { LocaleProvider } from "@/i18n/locale";
import type { Locale } from "@/shared/i18n";
import { AA_TEXT, contrastRatio, paintedBackground, parseColor } from "@/testing/contrast";
import { colors } from "@/theme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const POSTER = "https://store.public.blob.vercel-storage.com/shows/poster-scarlet.png";
const HERO = "https://store.public.blob.vercel-storage.com/shows/hero-scarlet.png";

// Anonymous, tier mode (paid): ep 1 free, ep 2 member (sign-up wall), ep 3
// subscriber — the-scarlet-oath's live layout in miniature.
function makeShow(overrides: Partial<ShowDetail> = {}): ShowDetail {
  const access = ["free", "member", "subscriber"] as const;
  return {
    id: "show-1",
    slug: "the-scarlet-oath",
    title: "The Scarlet Oath",
    synopsis: null,
    genre: [],
    orientation: "horizontal",
    posterImageUrl: null,
    heroImageUrl: null,
    episodeCount: 3,
    featured: false,
    justReleased: false,
    popularNow: false,
    episodes: access.map((tier, i) => ({
      id: `ep${i + 1}`,
      seasonNumber: 1,
      number: i + 1,
      title: `Episode ${i + 1}`,
      description: null,
      durationSeconds: 600,
      access: tier,
      releasedAt: null,
      thumbnailUrl: null,
      introStartSeconds: null,
      introEndSeconds: null,
    })),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

async function renderShow(show: ShowDetail, locale: Locale = "en") {
  current.show = show;
  await act(async () => {
    root.render(
      <LocaleProvider initial={locale}>
        <ShowScreen />
      </LocaleProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const leaves = (label: string) =>
  Array.from(container.querySelectorAll("*")).filter(
    (el) => el.children.length === 0 && el.textContent === label,
  );

function press(label: string) {
  const [node] = leaves(label);
  if (!node) throw new Error(`no element labelled ${label}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const rowLabel = (episodeTitle: string) =>
  Array.from(container.querySelectorAll('[role="button"][aria-label]'))
    .map((el) => el.getAttribute("aria-label") ?? "")
    .find((label) => label.includes(episodeTitle));

const tabs = () =>
  Array.from(container.querySelectorAll('[role="tab"]')).map((el) => el.textContent);

const imageUris = () =>
  images.sources.flatMap((s) =>
    s && typeof s === "object" && typeof (s as { uri?: unknown }).uri === "string"
      ? [decodeURIComponent((s as { uri: string }).uri)]
      : [],
  );

beforeEach(() => {
  images.sources.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("a subscriber-only episode row names no purchase (#311 item 1)", () => {
  // «Subscribers only» contains the letters «Subscribe»; the call to action
  // is the WORD, hence the word boundary.
  const cases = [
    { locale: "en", neutral: "Subscribers only", signup: "Create account", cta: /\bsubscribe\b/i },
    { locale: "es", neutral: "Solo para suscriptores", signup: "Crea una cuenta", cta: /suscr[ií]bete/i },
  ] as const;

  for (const { locale, neutral, signup, cta } of cases) {
    it(`${locale}: reads «${neutral}» on screen and to VoiceOver, and «${cta.source}» nowhere`, async () => {
      await renderShow(makeShow(), locale);

      expect(rowLabel("Episode 3")).toBe(`Ep. 3, Episode 3, 10 min, ${neutral}`);
      expect(leaves(neutral)).toHaveLength(1);
      // The sign-up wall's row is untouched.
      expect(rowLabel("Episode 2")).toBe(`Ep. 2, Episode 2, 10 min, ${signup}`);

      const spoken = Array.from(container.querySelectorAll("[aria-label]")).map((el) =>
        el.getAttribute("aria-label"),
      );
      expect(text()).not.toMatch(cta);
      for (const label of spoken) expect(label).not.toMatch(cta);
    });
  }
});

describe("no generated synopsis (#311 item 2)", () => {
  it("a show without one prints no fallback line and offers no empty About tab", async () => {
    await renderShow(makeShow({ genre: ["Drama"] }));

    expect(text()).not.toContain("Watch it free online");
    expect(text()).not.toContain("an original Matio series");
    expect(tabs()).toEqual(["Episodes"]);
    // The episode list is still there under it.
    expect(rowLabel("Episode 1")).toBe("Ep. 1, Episode 1, 10 min");
  });

  it("nor in Spanish", async () => {
    await renderShow(makeShow({ genre: ["Drama"] }), "es");

    expect(text()).not.toContain("Míralo gratis");
    expect(text()).not.toContain("serie original de Matio");
    expect(tabs()).toEqual(["Episodios"]);
  });

  it("a show with one keeps both: two lines under Episodes, the full text under About", async () => {
    const synopsis = "A vow sworn in blood, and the house that breaks it.";
    await renderShow(makeShow({ synopsis }));

    expect(tabs()).toEqual(["Episodes", "About"]);
    expect(leaves(synopsis)).toHaveLength(1);

    press("About");
    expect(leaves(synopsis)).toHaveLength(1);
    expect(rowLabel("Episode 1")).toBeUndefined();
  });
});

describe("the hero falls back to the poster (#311 item 3)", () => {
  it("no hero image → the poster, not a bare gradient", async () => {
    await renderShow(makeShow({ posterImageUrl: POSTER }));

    expect(imageUris()).toHaveLength(1);
    expect(imageUris()[0]).toContain("/shows/poster-scarlet.png");
  });

  it("a hero image still wins over the poster", async () => {
    await renderShow(makeShow({ heroImageUrl: HERO, posterImageUrl: POSTER }));

    expect(imageUris()).toHaveLength(1);
    expect(imageUris()[0]).toContain("/shows/hero-scarlet.png");
  });

  it("neither → no image at all, the tone gradient shows", async () => {
    await renderShow(makeShow());

    expect(imageUris()).toEqual([]);
  });
});

describe("genre chips read like Browse's (#311 item 4)", () => {
  const chips = () =>
    Array.from(container.querySelectorAll('[data-testid="genre-chip"]')).map((el) => el.textContent);

  it("«Drama» + «drama» is one chip, blanks are none, labels are normalised", async () => {
    await renderShow(makeShow({ genre: ["Drama", "drama", "  ", "", "dark  Romance"] }));

    expect(chips()).toEqual(["Drama", "Dark romance"]);
    expect(leaves("Drama")).toHaveLength(1);
  });

  it("only blank entries → no chip", async () => {
    await renderShow(makeShow({ genre: [" ", ""] }));

    expect(chips()).toEqual([]);
  });
});

// #314 — the 11pt mono duration under each episode was rust: 3.0:1 on the
// episode card, under AA's 4.5. It is inkDim now, like the description above
// it.
describe("the episode duration reads at AA contrast (#314)", () => {
  it("is inkDim on the episode card it sits in, on every row", async () => {
    await renderShow(makeShow());

    const durations = leaves("10 min");
    expect(durations).toHaveLength(3);
    for (const duration of durations) {
      const { color } = getComputedStyle(duration);
      expect(parseColor(color)).toEqual(parseColor(colors.inkDim));
      const card = paintedBackground(duration);
      expect(card).not.toBeNull();
      expect(parseColor(card as string)).toEqual(parseColor(colors.card));
      expect(contrastRatio(color, card as string)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
