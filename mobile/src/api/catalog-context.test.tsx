/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppState } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogResponse, ShowSummary } from "@/shared/api-types";

// #288 item 11 — the catalog while the app stays in memory. Home and Browse
// read ONE load (they used to fetch separately and could disagree); a return
// to the foreground refreshes a catalog older than five minutes SILENTLY —
// the screen never drops back to a spinner, and a failed refresh keeps what
// is shown. A launch that met an empty catalog (or none) recovers the same way.

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

const calls = vi.hoisted(() => ({ answers: [] as Array<() => Promise<CatalogResponse>>, count: 0 }));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      catalog: () => {
        calls.count += 1;
        const next = calls.answers.shift();
        if (!next) throw new Error("unexpected catalog request");
        return next();
      },
    },
  };
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));

import { ApiError } from "@/api/client";
import { CATALOG_STALE_MS, CatalogProvider, useCatalog } from "./catalog-context";

function catalogOf(...slugs: string[]): CatalogResponse {
  return {
    shows: slugs.map(
      (slug): ShowSummary => ({
        id: slug,
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
      }),
    ),
  };
}

// Every state a screen renders, in order: "status:slug,slug".
const seen: Record<string, string[]> = { home: [], browse: [] };
function Screen({ name }: { name: "home" | "browse" }) {
  const catalog = useCatalog();
  const shows = catalog.status === "ready" ? catalog.data.shows.map((s) => s.slug).join(",") : "";
  seen[name].push(`${catalog.status}:${shows}`);
  return null;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let onAppState: ((state: string) => void) | null = null;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount() {
  act(() =>
    root.render(
      <CatalogProvider>
        <Screen name="home" />
        <Screen name="browse" />
      </CatalogProvider>,
    ),
  );
  await settle();
}

async function foregroundAfter(ms: number) {
  vi.setSystemTime(Date.now() + ms);
  act(() => onAppState?.("active"));
  await settle();
}

const last = (name: "home" | "browse") => seen[name][seen[name].length - 1];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  calls.answers = [];
  calls.count = 0;
  seen.home = [];
  seen.browse = [];
  vi.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    onAppState = handler as (state: string) => void;
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CatalogProvider (#288 item 11)", () => {
  it("Home and Browse read one load — one request, one answer", async () => {
    calls.answers.push(async () => catalogOf("fallen", "morelli"));
    await mount();

    expect(calls.count).toBe(1);
    expect(last("home")).toBe("ready:fallen,morelli");
    expect(last("browse")).toBe("ready:fallen,morelli");
  });

  it("a return after five minutes swaps the new catalog in without a spinner", async () => {
    calls.answers.push(async () => catalogOf("fallen"));
    await mount();
    const before = seen.home.length;

    calls.answers.push(async () => catalogOf("fallen", "new-show"));
    await foregroundAfter(CATALOG_STALE_MS);

    expect(calls.count).toBe(2);
    expect(last("home")).toBe("ready:fallen,new-show");
    expect(last("browse")).toBe("ready:fallen,new-show");
    expect(seen.home.slice(before).some((s) => s.startsWith("loading"))).toBe(false);
  });

  it("a launch that met an empty catalog does not stay empty for good", async () => {
    calls.answers.push(async () => catalogOf());
    await mount();
    expect(last("home")).toBe("ready:");

    calls.answers.push(async () => catalogOf("fallen"));
    await foregroundAfter(CATALOG_STALE_MS + 1);

    expect(last("home")).toBe("ready:fallen");
  });

  it("a quick return does not refetch", async () => {
    calls.answers.push(async () => catalogOf("fallen"));
    await mount();

    await foregroundAfter(CATALOG_STALE_MS - 1_000);
    act(() => onAppState?.("background"));

    expect(calls.count).toBe(1);
  });

  it("a failed refresh keeps what the viewer is looking at", async () => {
    calls.answers.push(async () => catalogOf("fallen"));
    await mount();

    calls.answers.push(async () => {
      throw new ApiError("network", "Couldn't reach Matio.", 0);
    });
    await foregroundAfter(CATALOG_STALE_MS);

    expect(calls.count).toBe(2);
    expect(last("home")).toBe("ready:fallen");
    expect(seen.home.some((s) => s.startsWith("error"))).toBe(false);
  });

  it("a launch that failed recovers on the next return to the app", async () => {
    calls.answers.push(async () => {
      throw new ApiError("network", "Couldn't reach Matio.", 0);
    });
    await mount();
    expect(last("home")).toBe("error:");

    calls.answers.push(async () => catalogOf("fallen"));
    await foregroundAfter(1_000);

    expect(last("home")).toBe("ready:fallen");
  });
});
