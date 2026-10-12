import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdeasLanding } from "@/components/ideas/ideas-landing";
import { IdeasFaq, IdeasHowItWorks } from "@/components/ideas/ideas-sections";
import { en } from "@/lib/i18n/ideas-dictionaries";

// The /ideas route wrapper (#297): metadata, the ?show= preselect, the hero
// pick and what crosses to the client. Inspected as a JSX tree, not rendered
// — the form's behaviour is covered by components/ideas/ideas-landing.test.tsx
// and its stories.

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  shows: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/catalog", () => ({ getPublishedShows: async () => state.shows }));
// The hero no longer reads the featured show (#370): the landing has its own
// photo, and only `?show=` swaps in a series' hero.
const action = vi.hoisted(() => ({ submitIdea: vi.fn() }));
vi.mock("./actions", () => action);

import IdeasPage, { generateMetadata } from "./page";

// A catalog row as getPublishedShows() returns it — far more than the form
// may see.
function row(slug: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${slug}`,
    slug,
    title: `Title ${slug}`,
    description: `Synopsis of ${slug}`,
    posterImageUrl: `/shows/${slug}-poster.png`,
    heroImageUrl: `/shows/${slug}-hero.png`,
    featured: false,
    status: "published",
    genre: ["drama"],
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...extra,
  };
}

type LandingProps = Parameters<typeof IdeasLanding>[0];

async function landing(show?: string | string[]) {
  const el = await IdeasPage({
    searchParams: Promise.resolve(show === undefined ? {} : { show }),
  });
  expect(el.type).toBe("main");
  const body = el.props.children as ReactElement<LandingProps>;
  expect(body.type).toBe(IdeasLanding);
  return body.props;
}

beforeEach(() => {
  state.shows = [
    row("fallen", { heroImageUrl: null }),
    row("the-scarlet-oath", { featured: true }),
    row("morelli"),
  ];
});

describe("/ideas metadata", () => {
  it("English, own canonical, no hreflang cluster (#445), indexed", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe(en.meta.title);
    expect(meta.description).toBe(en.meta.description);
    expect(meta.alternates).toEqual({ canonical: "https://matio.tv/ideas" });
    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });
});

describe("/ideas page", () => {
  it("?show=<published slug> preselects it and takes its hero, show focus", async () => {
    const props = await landing("morelli");
    expect(props.preselectedSlug).toBe("morelli");
    expect(props.heroImageUrl).toBe("/shows/morelli-hero.png");
    expect(props.heroFocus).toBe("show");
  });

  it("a preselected show without a hero gets the landing's own photo", async () => {
    const props = await landing("fallen");
    expect(props.preselectedSlug).toBe("fallen");
    expect(props.heroImageUrl).toBe("/ideas/hero.jpg");
    expect(props.heroFocus).toBe("landing");
  });

  it.each([
    ["an unknown slug", "nope"],
    ["a repeated ?show (array)", ["morelli", "fallen"]],
    ["no ?show at all", undefined],
  ])("%s preselects nothing and takes the landing's own photo", async (_, show) => {
    const props = await landing(show);
    expect(props.preselectedSlug).toBeNull();
    expect(props.heroImageUrl).toBe("/ideas/hero.jpg");
    expect(props.heroFocus).toBe("landing");
  });

  it("the featured show's hero is not the landing's background any more (#370)", async () => {
    // the-scarlet-oath is featured with a hero; without ?show it must not win.
    const props = await landing();
    expect(props.heroImageUrl).not.toBe("/shows/the-scarlet-oath-hero.png");
  });

  it("no show hero anywhere still leaves the landing photo", async () => {
    state.shows = [row("fallen", { heroImageUrl: null })];
    const props = await landing();
    expect(props.heroImageUrl).toBe("/ideas/hero.jpg");
  });

  it("only slug, title and poster cross to the client, in catalog order", async () => {
    const props = await landing();
    expect(props.shows).toEqual([
      { slug: "fallen", title: "Title fallen", posterImageUrl: "/shows/fallen-poster.png" },
      {
        slug: "the-scarlet-oath",
        title: "Title the-scarlet-oath",
        posterImageUrl: "/shows/the-scarlet-oath-poster.png",
      },
      { slug: "morelli", title: "Title morelli", posterImageUrl: "/shows/morelli-poster.png" },
    ]);
    for (const s of props.shows) {
      expect(Object.keys(s).sort()).toEqual(["posterImageUrl", "slug", "title"]);
    }
  });

  it("hands the form the server action and the server-rendered blocks, in English", async () => {
    const props = await landing();
    expect(props.submitIdea).toBe(action.submitIdea);
    expect(props).not.toHaveProperty("locale");
    const children = props.children as ReactElement<{ t: unknown }>[];
    expect(children.every((c) => isValidElement(c))).toBe(true);
    expect(children.map((c) => c.type)).toEqual([IdeasHowItWorks, IdeasFaq]);
    expect(children[0].props.t).toBe(en);
    expect(children[1].props).toEqual({ t: en });
  });
});
