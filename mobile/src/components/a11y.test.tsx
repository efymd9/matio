/** @vitest-environment jsdom */
import { act, createElement, forwardRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, ShowDetail, ShowSummary } from "@/shared/api-types";

// #288 items 8 and 13 — VoiceOver and Larger Text, with nothing changing on
// screen. Roles, labels and states are asserted through the DOM
// react-native-web renders (role / aria-*). Two props have no DOM form and
// are dropped by react-native-web — `maxFontSizeMultiplier` (the iOS Larger
// Text cap) and `accessibilityActions` (the VoiceOver rotor) — so Text,
// TextInput and Pressable are wrapped to record what each one was handed,
// and still render the real react-native-web component.

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

type Recorded = { text: string; cap: number | undefined };
const rec = vi.hoisted(() => ({
  texts: [] as Recorded[],
  inputs: [] as Array<{ placeholder?: string; cap: number | undefined }>,
  actionable: [] as Array<{
    label?: string;
    actions: Array<{ name: string; label?: string }>;
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => void;
  }>,
  pressables: [] as Array<Record<string, unknown>>,
}));

function flatten(children: ReactNode): string {
  if (children === null || children === undefined || typeof children === "boolean") return "";
  if (Array.isArray(children)) return children.map(flatten).join("");
  if (typeof children === "object") return "";
  return String(children);
}

vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  type AnyProps = Record<string, unknown> & { children?: ReactNode };
  const Text = forwardRef(function Text(props: AnyProps, ref) {
    rec.texts.push({ text: flatten(props.children), cap: props.maxFontSizeMultiplier as number | undefined });
    return createElement(rn.Text as never, { ...props, ref });
  });
  const TextInput = forwardRef(function TextInput(props: AnyProps, ref) {
    rec.inputs.push({
      placeholder: props.placeholder as string | undefined,
      cap: props.maxFontSizeMultiplier as number | undefined,
    });
    return createElement(rn.TextInput as never, { ...props, ref });
  });
  const Pressable = forwardRef(function Pressable(props: AnyProps, ref) {
    rec.pressables.push(props);
    if (props.accessibilityActions) {
      rec.actionable.push({
        label: props.accessibilityLabel as string | undefined,
        actions: props.accessibilityActions as Array<{ name: string; label?: string }>,
        onAccessibilityAction: props.onAccessibilityAction as never,
      });
    }
    return createElement(rn.Pressable as never, { ...props, ref });
  });
  return { ...rn, Text, TextInput, Pressable };
});

const router = { push: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: () => true };
vi.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ slug: "the-scarlet-oath" }),
}));

const SHOW: ShowDetail = {
  id: "show-1",
  slug: "the-scarlet-oath",
  title: "The Scarlet Oath",
  synopsis: null,
  genre: [],
  orientation: "horizontal",
  posterImageUrl: null,
  heroImageUrl: null,
  episodeCount: 2,
  featured: false,
  justReleased: false,
  popularNow: false,
  episodes: [1, 2].map((n) => ({
    id: `ep${n}`,
    seasonNumber: 1,
    number: n,
    title: `Episode ${n}`,
    description: null,
    durationSeconds: 600,
    access: n === 1 ? ("free" as const) : ("subscriber" as const),
    releasedAt: null,
    thumbnailUrl: null,
    introStartSeconds: null,
    introEndSeconds: null,
  })),
};

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, api: { show: async () => SHOW } };
});
vi.mock("@/api/config-context", () => ({
  useConfig: (): Partial<AppConfig> => ({ signupGate: { mode: "tiers" } }),
}));
vi.mock("@/api/catalog-context", () => ({
  useCatalog: () => ({
    status: "ready",
    data: { shows: [SHOW as ShowSummary] },
    error: null,
    retry: () => undefined,
    reload: () => undefined,
  }),
}));
vi.mock("@/auth/clerk", () => ({
  CLERK_PUBLISHABLE_KEY: "pk_test_dummy",
  useOptionalAuth: () => ({ isLoaded: true, isSignedIn: false, stalled: false, retry: () => undefined }),
}));
vi.mock("@clerk/expo", () => ({
  // Clerk still loading: the resources are not there yet.
  useSignIn: () => ({ signIn: undefined }),
  useSignUp: () => ({ signUp: undefined }),
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
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

import BrowseScreen from "@/app/(tabs)/browse";
import ShowScreen from "@/app/show/[slug]";
import { AuthStalled } from "@/components/auth-stalled";
import { GlassTabBar } from "@/components/glass-tab-bar";
import { HeroCard } from "@/components/home-feed";
import { SignInForm } from "@/components/sign-in-form";
import { SignupWall } from "@/components/signup-wall";
import { GoldButton, PosterCard, Row } from "@/components/ui";
import { VerticalChrome } from "@/components/vertical-chrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(element: ReactNode) {
  act(() => root.render(element));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The element VoiceOver focuses for a visible text: its nearest ancestor
// with a role.
function roleOf(label: string): string | null {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  return node?.closest("[role]")?.getAttribute("role") ?? null;
}

const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`);
const capOf = (text: string) => rec.texts.filter((r) => r.text === text).map((r) => r.cap);

beforeEach(() => {
  rec.texts.length = 0;
  rec.inputs.length = 0;
  rec.actionable.length = 0;
  rec.pressables.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Home hero card — one VoiceOver element with a Play action (#288 items 8, 13)", () => {
  const card = (overrides: Partial<Parameters<typeof HeroCard>[0]> = {}) => {
    const onPress = vi.fn();
    const onPlay = vi.fn();
    render(
      <HeroCard
        width={358}
        uri={null}
        toneKey="the-scarlet-oath"
        pill={{ label: "Resume", tone: "gold" }}
        title="The Scarlet Oath"
        meta={["Ep. 3", "Third oath", "10 min"]}
        fraction={0.4}
        playLabel="Play"
        onPress={onPress}
        onPlay={onPlay}
        {...overrides}
      />,
    );
    return { onPress, onPlay };
  };

  it("reads as pill, title and meta, with the resume progress as its value", () => {
    card();
    const el = byLabel("Resume, The Scarlet Oath, Ep. 3, Third oath, 10 min");

    expect(el).not.toBeNull();
    expect(el?.getAttribute("role")).toBe("button");
    expect(el?.getAttribute("aria-valuenow")).toBe("40");
    expect(el?.getAttribute("aria-valuemax")).toBe("100");
    // The disc is not a second, unreachable button inside the card.
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(1);
  });

  it("offers Play in the rotor, and activating the card still opens the show", () => {
    const { onPress, onPlay } = card();
    const [a11y] = rec.actionable.slice(-1);

    expect(a11y.actions).toEqual([{ name: "activate" }, { name: "play", label: "Play" }]);
    act(() => a11y.onAccessibilityAction({ nativeEvent: { actionName: "play" } }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();

    act(() => a11y.onAccessibilityAction({ nativeEvent: { actionName: "activate" } }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("a Play action while the previous one loads does nothing, like the disc", () => {
    const { onPlay } = card({ playDisabled: true });
    const [a11y] = rec.actionable.slice(-1);

    act(() => a11y.onAccessibilityAction({ nativeEvent: { actionName: "play" } }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("caps Larger Text on every line of the fixed-size card", () => {
    card({ fraction: null, synopsis: "A dark romance." });

    for (const text of ["Resume", "The Scarlet Oath", "Ep. 3", "Third oath", "10 min", "A dark romance."]) {
      expect(capOf(text), text).toEqual(expect.arrayContaining([1.3]));
      expect(capOf(text).every((cap) => cap === 1.3), text).toBe(true);
    }
  });
});

describe("buttons, links and radios say what they are (#288 item 8)", () => {
  // react-native-web's Pressable writes aria-disabled from its own `disabled`
  // prop only (which GoldButton deliberately leaves alone — the handler
  // guards the tap), so the dimmed/busy state is read from what the
  // Pressable was handed; React Native maps those props to accessibilityState.
  const goldButtonProps = () => rec.pressables.filter((p) => "aria-disabled" in p);

  it("GoldButton is a button, announced dimmed and busy when told so", () => {
    render(<GoldButton label="Send code" disabled busy />);
    const el = container.querySelector('[role="button"]');

    expect(el?.textContent).toBe("Send code");
    expect(goldButtonProps().at(-1)).toMatchObject({ "aria-disabled": true, "aria-busy": true });

    render(<GoldButton label="Send code" />);
    expect(goldButtonProps().at(-1)).toMatchObject({ "aria-disabled": false, "aria-busy": false });
  });

  it("a poster is a button", () => {
    render(<PosterCard title="Fallen" posterUrl={null} slug="fallen" onPress={() => undefined} />);
    expect(roleOf("Fallen")).toBe("button");
  });

  it("a language row is a radio announced checked, not «selected»", () => {
    render(
      <>
        <Row label="English" role="radio" selected onPress={() => undefined} />
        <Row label="Español" role="radio" selected={false} onPress={() => undefined} />
      </>,
    );
    const radios = container.querySelectorAll('[role="radio"]');

    expect(radios).toHaveLength(2);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].getAttribute("aria-checked")).toBe("false");
    expect(radios[0].hasAttribute("aria-selected")).toBe(false);
  });

  it("«Not now» and the sign-in form's text actions are links; its CTA is dimmed until Clerk is ready", () => {
    render(
      <>
        <SignupWall onSignIn={() => undefined} onBack={() => undefined} />
        <AuthStalled onRetry={() => undefined} onCancel={() => undefined} />
      </>,
    );
    const notNow = Array.from(container.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && el.textContent === "Not now",
    );
    expect(notNow).toHaveLength(2);
    for (const node of notNow) expect(node.closest("[role]")?.getAttribute("role")).toBe("link");

    render(
      <SignInForm
        kicker="Watch for free"
        headline="Create your account"
        bodyText="Create a free account."
        cta="Create free account"
        onDone={() => undefined}
        onCancel={() => undefined}
        signInHint
      />,
    );
    expect(roleOf("Not now")).toBe("link");
    expect(roleOf("Sign in")).toBe("link");
    expect(roleOf("Create free account")).toBe("button");
    expect(goldButtonProps().at(-1)).toMatchObject({ "aria-disabled": true, "aria-busy": false });
  });
});

describe("the show page reads its rows and its «‹» properly (#288 item 8)", () => {
  it("an episode row is a button read as «Ep. n, title, minutes, lock» — never «black circle»", async () => {
    render(<ShowScreen />);
    await settle();

    const locked = byLabel("Ep. 2, Episode 2, 10 min, Subscribe");
    expect(locked?.getAttribute("role")).toBe("button");
    expect(byLabel("Ep. 1, Episode 1, 10 min")?.getAttribute("role")).toBe("button");

    const glyph = Array.from(locked?.querySelectorAll("*") ?? []).find(
      (el) => el.children.length === 0 && el.textContent === "●",
    );
    expect(glyph).toBeDefined();
    expect(glyph?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("the «‹» over the show says «Back», not the player's «Back to show»", async () => {
    render(<ShowScreen />);
    await settle();

    expect(byLabel("Back")?.getAttribute("role")).toBe("button");
    expect(byLabel("Back to show")).toBeNull();
  });
});

describe("Browse's search field (#288 items 8, 13)", () => {
  it("its «×» says «Clear search», and the fixed-height field caps Larger Text", () => {
    render(<BrowseScreen />);
    const input = container.querySelector("input");
    if (!input) throw new Error("no search field");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(input, "oath");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(byLabel("Clear search")?.getAttribute("role")).toBe("button");
    expect(byLabel("Close")).toBeNull();
    const search = rec.inputs.filter((i) => i.placeholder === "Search");
    expect(search.length).toBeGreaterThan(0);
    expect(search.every((i) => i.cap === 1.3)).toBe(true);
  });
});

describe("fixed-height chrome caps Larger Text (#288 item 13)", () => {
  it("the active tab's label in the 64pt bar", () => {
    const routes = [
      { key: "index-1", name: "index" },
      { key: "browse-1", name: "browse" },
    ];
    render(
      <GlassTabBar
        {...({
          state: { index: 1, routes },
          descriptors: {
            "index-1": { options: { title: "Home" } },
            "browse-1": { options: { title: "Browse" } },
          },
          navigation: { emit: () => ({ defaultPrevented: false }), navigate: () => undefined },
        } as unknown as Parameters<typeof GlassTabBar>[0])}
      />,
    );

    expect(capOf("Browse")).toEqual([1.3]);
  });

  it("the vertical player's read-outs", () => {
    render(
      <VerticalChrome
        showTitle="The Scarlet Oath"
        episodeTitle="Third oath"
        episodeNumber={3}
        positionSeconds={65}
        durationSeconds={600}
        paused={false}
        muted={false}
        onTogglePlay={() => undefined}
        onToggleMute={() => undefined}
        onBack={() => undefined}
      />,
    );

    for (const text of ["Matio Original", "The Scarlet Oath", "Ep. 3 · Third oath · 10 min", "1:05", "10:00"]) {
      expect(capOf(text), text).toEqual([1.3]);
    }
  });
});
