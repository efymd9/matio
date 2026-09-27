import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdeasLanding } from "@/components/ideas/ideas-landing";
import { IdeasFaq, IdeasHowItWorks } from "@/components/ideas/ideas-sections";
import { en, es } from "@/lib/i18n/ideas-dictionaries";

// The /ideas route wrapper (#297): metadata, the ?show= preselect, the hero
// pick and what crosses to the client. Inspected as a JSX tree, not rendered
// — the form's behaviour is covered by components/ideas/ideas-landing.test.tsx
// and its stories.

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  locale: "en" as "en" | "es",
  shows: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => state.locale }));
vi.mock("@/lib/catalog", () => ({ getPublishedShows: async () => state.shows }));
// lib/hero-preview.ts is NOT mocked: the hero follows the home page's real
// pickFeaturedShow rule (its DB/Mux half is never called here).
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
  state.locale = "en";
  state.shows = [
    row("fallen", { heroImageUrl: null }),
    row("the-scarlet-oath", { featured: true }),
    row("morelli"),
  ];
});

describe("/ideas metadata", () => {
  it("English: own canonical, the hreflang cluster, indexed", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe(en.meta.title);
    expect(meta.description).toBe(en.meta.description);
    expect(meta.alternates?.canonical).toBe("https://matio.tv/ideas");
    expect(meta.alternates?.languages).toEqual({
      en: "https://matio.tv/ideas",
      es: "https://matio.tv/es/ideas",
      "x-default": "https://matio.tv/ideas",
    });
    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });

  it("Spanish: the /es twin is its own canonical", async () => {
    state.locale = "es";
    const meta = await generateMetadata();
    expect(meta.title).toBe(es.meta.title);
    expect(meta.alternates?.canonical).toBe("https://matio.tv/es/ideas");
    expect(
      (meta.alternates?.languages as Record<string, string>)["x-default"],
    ).toBe("https://matio.tv/ideas");
  });
});

describe("/ideas page", () => {
  it("?show=<published slug> preselects it and takes its hero", async () => {
    const props = await landing("morelli");
    expect(props.preselectedSlug).toBe("morelli");
    expect(props.heroImageUrl).toBe("/shows/morelli-hero.png");
  });

  it("a preselected show without a hero falls back to the featured show's", async () => {
    const props = await landing("fallen");
    expect(props.preselectedSlug).toBe("fallen");
    expect(props.heroImageUrl).toBe("/shows/the-scarlet-oath-hero.png");
  });

  it.each([
    ["an unknown slug", "nope"],
    ["a repeated ?show (array)", ["morelli", "fallen"]],
    ["no ?show at all", undefined],
  ])("%s preselects nothing and takes the featured hero", async (_, show) => {
    const props = await landing(show);
    expect(props.preselectedSlug).toBeNull();
    expect(props.heroImageUrl).toBe("/shows/the-scarlet-oath-hero.png");
  });

  it("no hero anywhere → none (the espresso + glow backdrop)", async () => {
    state.shows = [row("fallen", { heroImageUrl: null })];
    const props = await landing();
    expect(props.heroImageUrl).toBeNull();
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

  it("hands the form the server action, the locale and the server-rendered blocks", async () => {
    state.locale = "es";
    const props = await landing();
    expect(props.submitIdea).toBe(action.submitIdea);
    expect(props.locale).toBe("es");
    const children = props.children as ReactElement<{ t: unknown; locale?: string }>[];
    expect(children.every((c) => isValidElement(c))).toBe(true);
    expect(children.map((c) => c.type)).toEqual([IdeasHowItWorks, IdeasFaq]);
    expect(children[0].props.t).toBe(es);
    expect(children[1].props).toMatchObject({ t: es, locale: "es" });
  });
});
