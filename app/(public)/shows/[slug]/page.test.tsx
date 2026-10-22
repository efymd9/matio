/** @vitest-environment jsdom */
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { type ImageConfigComplete, imageConfigDefault } from "next/dist/shared/lib/image-config";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const SHOW = {
  id: "show-1",
  slug: "the-scarlet-oath",
  title: "The Scarlet Oath",
  description: "London, 1882.",
  genre: ["drama"],
  heroImageUrl: HERO,
  posterImageUrl: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

// The page's three reads, in order: seasons, cast, episodes. Each chain
// resolves to the next queued result, whichever builder methods it walks.
const rows = vi.hoisted(() => ({ queue: [] as unknown[][] }));
// #469 — the show lookup (the show by default, null for a slug that is not
// one), the cached catalog the prefix redirect reads on a miss, and the two
// next/navigation exits, which throw like the real ones.
const h = vi.hoisted(() => ({
  getShowBySlug: vi.fn<(slug: string) => Promise<unknown>>(),
  catalog: [] as string[],
  getPublishedShows: vi.fn(async () => h.catalog.map((slug) => ({ slug }))),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  permanentRedirect: vi.fn((to: string) => {
    throw new Error(`permanentRedirect:${to}`);
  }),
}));
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
vi.mock("@/lib/show-query", () => ({ getShowBySlug: h.getShowBySlug }));
vi.mock("@/lib/catalog", () => ({ getPublishedShows: h.getPublishedShows }));
vi.mock("next/navigation", () => ({
  notFound: h.notFound,
  permanentRedirect: h.permanentRedirect,
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

import ShowDetailPage, { generateMetadata } from "./page";

beforeEach(() => {
  h.getShowBySlug.mockReset().mockResolvedValue(SHOW);
  h.catalog = ["the-scarlet-oath", "the-heather-oath-two-blades", "fallen"];
  h.getPublishedShows.mockClear();
  h.notFound.mockClear();
  h.permanentRedirect.mockClear();
});

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
  const page = await ShowDetailPage({
    params: Promise.resolve({ slug: "the-scarlet-oath" }),
    searchParams: Promise.resolve({}),
  });
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

// #445 — English only: the show page is its own canonical, with no hreflang
// cluster pointing at an /es twin.
describe("/shows/[slug] — metadata", () => {
  it("names the bare canonical and no other language", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: "the-scarlet-oath" }),
    });
    expect(meta.alternates).toEqual({
      canonical: "https://matio.tv/shows/the-scarlet-oath",
    });
    expect(meta.openGraph).toMatchObject({
      url: "https://matio.tv/shows/the-scarlet-oath",
    });
  });
});

// #469 — a truncated show link (`/shows/the-scarlet-oa..`, the YouTube
// description) is a 308 to the one published slug it is a prefix of, with the
// query kept; anything else that is not a show stays a 404. The rule itself is
// the real one (lib/slug-prefix.ts); the page is run as the function it is and
// its exit — the redirect or notFound(), both thrown — is read back.
type Query = Record<string, string | string[] | undefined>;

async function openMissing(slug: string, query: Query = {}): Promise<string> {
  h.getShowBySlug.mockResolvedValueOnce(null);
  try {
    await ShowDetailPage({
      params: Promise.resolve({ slug }),
      searchParams: Promise.resolve(query),
    });
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("the page rendered a show that does not exist");
}

describe("/shows/[slug] — a truncated slug is a 308 to the real show (#469)", () => {
  it("`the-scarlet-oa..?utm_source=youtube&fbclid=…` → 308 /shows/the-scarlet-oath with the query kept", async () => {
    const outcome = await openMissing("the-scarlet-oa..", {
      utm_source: "youtube",
      fbclid: "IwAR0abc",
    });

    expect(outcome).toBe(
      "permanentRedirect:/shows/the-scarlet-oath?utm_source=youtube&fbclid=IwAR0abc",
    );
    expect(h.permanentRedirect).toHaveBeenCalledTimes(1);
    expect(h.permanentRedirect).toHaveBeenCalledWith(
      "/shows/the-scarlet-oath?utm_source=youtube&fbclid=IwAR0abc",
    );
    // The redirect throws before notFound() is reached.
    expect(h.notFound).not.toHaveBeenCalled();
    // The slug list is the cached catalog read, asked exactly once.
    expect(h.getPublishedShows).toHaveBeenCalledTimes(1);
  });

  it("the other two shapes of the link, no query → the bare path, no trailing `?`", async () => {
    expect(await openMissing("the-scarlet-oa.")).toBe(
      "permanentRedirect:/shows/the-scarlet-oath",
    );
    expect(await openMissing("the-scarlet-oa")).toBe(
      "permanentRedirect:/shows/the-scarlet-oath",
    );
  });

  it("an unknown slug is still a 404", async () => {
    expect(await openMissing("nonexistent-show", { utm_source: "youtube" })).toBe(
      "notFound",
    );
    expect(h.permanentRedirect).not.toHaveBeenCalled();
    expect(h.notFound).toHaveBeenCalledTimes(1);
  });

  it("a prefix two published shows share is a 404 — never a guess", async () => {
    h.catalog = ["the-scarlet-oath", "the-scarlet-oath-season-2"];
    expect(await openMissing("the-scarlet-oa..")).toBe("notFound");
    expect(h.permanentRedirect).not.toHaveBeenCalled();
  });

  it("a prefix shorter than 6 characters is a 404", async () => {
    expect(await openMissing("the-s")).toBe("notFound");
    expect(await openMissing("the-s..")).toBe("notFound");
    expect(h.permanentRedirect).not.toHaveBeenCalled();
  });

  it("a show that exists never consults the catalog", async () => {
    await renderPage();
    expect(h.getPublishedShows).not.toHaveBeenCalled();
    expect(h.permanentRedirect).not.toHaveBeenCalled();
  });

  it("generateMetadata for a missing slug is unchanged — the not-found title, no redirect from there", async () => {
    h.getShowBySlug.mockResolvedValueOnce(null);
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: "the-scarlet-oa.." }),
    });
    expect(meta).toEqual({ title: en.showDetail.notFound });
    expect(h.permanentRedirect).not.toHaveBeenCalled();
    expect(h.getPublishedShows).not.toHaveBeenCalled();
  });
});
