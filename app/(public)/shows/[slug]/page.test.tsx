/** @vitest-environment jsdom */
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { type ImageConfigComplete, imageConfigDefault } from "next/dist/shared/lib/image-config";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";
import nextConfig from "@/next.config";

// #306 — the show page draws two kinds of remote image, and only one of them
// may go through /_next/image. The episode stills are signed Mux thumbnails
// whose JWT is minted on every render: a new URL per view, so the optimizer
// re-transformed each one with nothing to cache — and image.mux.com is no
// longer a remote pattern at all, so an optimized still would be a 400. The
// hero is admin-uploaded artwork on our Blob store: a stable URL, which is
// exactly what the optimizer is for, and must stay optimized.

vi.mock("server-only", () => ({}));

// The render runs under OUR next.config.ts images block (Next hands it to
// next/image through this context), so its remotePatterns apply — including
// next/image's dev-time "hostname is not configured" throw for an optimized
// remote src they do not list.
const IMAGE_CONFIG = { ...imageConfigDefault, ...nextConfig.images } as ImageConfigComplete;

const HERO =
  "https://waoyoctqyyvecbhm.public.blob.vercel-storage.com/shows/hero-oath-Q1bvTjLsQqUGxKMBjpyzbH5WfRWHGL.png";
const still = (playbackId: string) =>
  `https://image.mux.com/${playbackId}/thumbnail.jpg?width=320&height=180&fit_mode=smartcrop&token=eyJ.dummy.sig`;

// The page's three reads, in order: seasons, cast, episodes. Each chain
// resolves to the next queued result, whichever builder methods it walks.
const rows = vi.hoisted(() => ({ queue: [] as unknown[][] }));
vi.mock("@/db", () => {
  const chain = (result: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "orderBy"]) c[m] = () => c;
    c.then = (ok: (v: unknown[]) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, ko);
    return c;
  };
  return { db: { select: () => chain(rows.queue.shift() ?? []) } };
});
vi.mock("@/lib/show-query", () => ({
  getShowBySlug: async () => ({
    id: "show-1",
    slug: "the-scarlet-oath",
    title: "The Scarlet Oath",
    description: "London, 1882.",
    genre: ["drama"],
    heroImageUrl: HERO,
    posterImageUrl: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
  }),
}));
vi.mock("@/lib/i18n/server", () => ({
  getDict: async () => ({ locale: "en", t: en }),
}));
vi.mock("@/lib/free-mode", () => ({
  paymentsEnabled: () => true,
  signupRequired: () => false,
}));
vi.mock("@/lib/mux-token", () => ({
  muxThumbnailUrl: (playbackId: string) => still(playbackId),
}));
// Client islands with nothing to do with images.
vi.mock("@/components/site/view-content-pixel", () => ({ ViewContentPixel: () => null }));
vi.mock("@/components/site/share-button", () => ({ ShareButton: () => null }));
vi.mock("@/components/site/actor-chip", () => ({ ActorChip: () => null }));
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

import ShowDetailPage from "./page";

async function renderPage() {
  rows.queue = [
    [{ id: "season-1", number: 1, title: null }],
    [],
    [1, 2].map((n) => ({
      id: `ep-${n}`,
      seasonId: "season-1",
      number: n,
      title: `Episode ${n}`,
      description: null,
      durationSeconds: 600,
      muxPlaybackId: `pb-${n}`,
      muxPlaybackPolicy: "signed",
      status: "ready",
      access: "free",
    })),
  ];
  const page = await ShowDetailPage({ params: Promise.resolve({ slug: "the-scarlet-oath" }) });
  const html = renderToStaticMarkup(
    <ImageConfigContext.Provider value={IMAGE_CONFIG}>{page}</ImageConfigContext.Provider>,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("img"));
}

describe("/shows/[slug] — which images go through /_next/image (#306)", () => {
  it("serves every episode still from Mux itself", async () => {
    const imgs = await renderPage();
    const stills = imgs.filter((img) => img.getAttribute("src")?.includes("image.mux.com"));
    expect(stills.map((img) => img.getAttribute("src"))).toEqual([still("pb-1"), still("pb-2")]);
    for (const img of stills) expect(img.getAttribute("srcset")).toBeNull();
    // Nothing Mux-hosted is routed through the optimizer.
    for (const img of imgs) {
      expect(decodeURIComponent(img.getAttribute("srcset") ?? "")).not.toContain("image.mux.com");
    }
  });

  it("still optimizes the Blob-hosted hero artwork", async () => {
    const imgs = await renderPage();
    const hero = imgs.find((img) => img.getAttribute("src")?.startsWith("/_next/image?"));
    expect(hero).toBeDefined();
    expect(new URLSearchParams(hero!.getAttribute("src")!.split("?")[1]).get("url")).toBe(HERO);
    expect(hero!.getAttribute("srcset")).toContain("/_next/image?url=");
  });
});
