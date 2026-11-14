import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The /studio and /licensing route wrappers (#498): metadata (own title,
// description, canonical; indexed), what the pages hand their bodies, and
// that the main text and links are in the server HTML.

vi.mock("server-only", () => ({}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
const h = vi.hoisted(() => ({
  shows: [] as Record<string, unknown>[],
  stats: new Map<string, { count: number; minSeconds: number; maxSeconds: number }>(),
  titles: [] as { slug: string; languages: string[]; format: string }[],
}));
vi.mock("@/lib/catalog", () => ({ getPublishedShows: async () => h.shows }));
vi.mock("@/lib/show-facts-db", () => ({ loadEpisodeStats: async () => h.stats }));
vi.mock("@/lib/licensing", () => ({
  get LICENSING_TITLES() {
    return h.titles;
  },
  LICENSING_SLUGS: [],
}));
vi.mock("./actions", () => ({ submitStudioBrief: vi.fn() }));
vi.mock("../licensing/actions", () => ({ requestScreener: vi.fn() }));

import { AboutContent } from "@/components/about/about-content";
import { PressContent } from "@/components/about/press-content";
import { ScreenerRequestForm } from "@/components/b2b/b2b-forms";
import { en } from "@/lib/i18n/dictionaries";
import { licensing, studio } from "@/lib/i18n/b2b-dictionaries";
import LicensingPage, { generateMetadata as licensingMeta } from "../licensing/page";
import StudioPage, { generateMetadata as studioMeta } from "./page";

const SCARLET = {
  id: "s1",
  slug: "the-scarlet-oath",
  title: "THE SCARLET OATH",
  description: "A vow sealed in blood.",
  genre: ["dark Romance", "gothic"],
  posterImageUrl: "/shows/scarlet.jpg",
  heroImageUrl: null,
};

beforeEach(() => {
  h.shows = [SCARLET, { ...SCARLET, id: "f1", slug: "fallen", title: "Fallen" }];
  h.stats = new Map([["s1", { count: 8, minSeconds: 559, maxSeconds: 1183 }]]);
  h.titles = [];
});

describe("metadata", () => {
  it("each page has its own title, description and canonical, and is indexed", async () => {
    const s = await studioMeta();
    expect(s.title).toBe("Production & VFX");
    expect(s.description).toBe(studio.meta.description);
    expect(s.alternates).toEqual({ canonical: "https://matio.tv/studio" });
    expect(s.robots).toMatchObject({ index: true, follow: true });

    const l = await licensingMeta();
    expect(l.title).toBe("Content Licensing");
    expect(l.description).toBe(licensing.meta.description);
    expect(l.alternates).toEqual({ canonical: "https://matio.tv/licensing" });
    expect(l.robots).toMatchObject({ index: true, follow: true });
  });
});

describe("/studio", () => {
  it("renders the hero, the three services, the case study with live facts and the brief form into HTML", async () => {
    const html = renderToStaticMarkup(await StudioPage());
    expect(html).toContain("Film, series &amp; VFX production");
    for (const s of studio.services.items) expect(html).toContain(s.title.replace("&", "&amp;"));
    expect(html).toContain('href="/shows/the-scarlet-oath"');
    expect(html).toContain("8 episodes · 9–20 min");
    expect(html).toContain('href="#brief"');
    expect(html).toContain('aria-label="Project brief"');
    expect(html).toContain('href="/privacy"');
    // The Before / After block waits for a public pair on Matio's own footage.
    expect(html).not.toContain("Before / After");
  });

  it("drops the case study rather than link to a show that is not published", async () => {
    h.shows = [];
    const html = renderToStaticMarkup(await StudioPage());
    expect(html).not.toContain("/shows/the-scarlet-oath");
    expect(html).toContain("Discuss a project");
  });
});

describe("/licensing", () => {
  const page = (title?: string | string[]) =>
    LicensingPage({ searchParams: Promise.resolve(title === undefined ? {} : { title }) });

  it("with no confirmed title says so and still takes a catalogue enquiry", async () => {
    const html = renderToStaticMarkup(await page());
    expect(html).toContain("License Matio originals");
    expect(html).toContain("confirming the first titles for licensing");
    expect(html).toContain('aria-label="Screener request"');
    // The viewer catalogue has two published shows — neither is offered.
    expect(html).not.toContain("THE SCARLET OATH");
  });

  it("draws only the confirmed titles, with catalogue facts, and preselects ?title=", async () => {
    h.titles = [{ slug: "the-scarlet-oath", languages: ["English"], format: "Series · 16:9" }];
    const el = await page("the-scarlet-oath");
    const html = renderToStaticMarkup(el);
    expect(html).toContain("THE SCARLET OATH");
    expect(html).toContain("A vow sealed in blood.");
    expect(html).toContain("8 episodes · 9–20 min");
    expect(html).toContain("Series · 16:9");
    expect(html).toContain('href="?title=the-scarlet-oath#request"');
    expect(html).not.toContain(">Fallen<");

    const form = (el.props.children as ReactElement<{ form: ReactElement }>).props.form as ReactElement<
      Parameters<typeof ScreenerRequestForm>[0]
    >;
    expect(form.type).toBe(ScreenerRequestForm);
    expect(form.props.preselected).toBe("the-scarlet-oath");
    expect(form.props.titles).toEqual([{ slug: "the-scarlet-oath", title: "THE SCARLET OATH" }]);
  });

  it("an unknown or repeated ?title= preselects nothing", async () => {
    h.titles = [{ slug: "the-scarlet-oath", languages: [], format: "" }];
    for (const t of ["fallen", ["the-scarlet-oath", "x"]]) {
      const el = await page(t);
      const form = (el.props.children as ReactElement<{ form: ReactElement<{ preselected: unknown }> }>).props.form;
      expect(form.props.preselected).toBeNull();
    }
  });
});

// The forms are client components: every prop crosses the RSC boundary, where
// a function is refused at render (a 500) unless it is a server action. The
// action is the one function allowed — the copy (whose error summary is a
// function) is imported by the form itself.
function functionsIn(value: unknown, path = "props"): string[] {
  if (typeof value === "function") return [path];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => functionsIn(v, `${path}.${k}`));
}

describe("what crosses to the client forms", () => {
  it("is plain data plus the server action, on both pages", async () => {
    h.titles = [{ slug: "the-scarlet-oath", languages: ["English"], format: "Series" }];
    const studioForm = ((await StudioPage()).props.children as ReactElement<{ form: ReactElement }>).props.form;
    const licensingForm = (
      (await LicensingPage({ searchParams: Promise.resolve({}) })).props.children as ReactElement<{
        form: ReactElement;
      }>
    ).props.form;
    expect(functionsIn(studioForm.props)).toEqual(["props.submit"]);
    expect(functionsIn(licensingForm.props)).toEqual(["props.submit"]);
  });
});

describe("the cross-links on /about and /press", () => {
  it("both pages link to /studio and /licensing", () => {
    for (const html of [
      renderToStaticMarkup(<AboutContent t={en} paymentsOn />),
      renderToStaticMarkup(<PressContent t={en} paymentsOn />),
    ]) {
      expect(html).toContain('href="/studio"');
      expect(html).toContain('href="/licensing"');
      expect(html).toContain(en.footer.workWithHeading);
    }
  });
});
