import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  breadcrumbJsonLd,
  catalogItemListJsonLd,
  jsonLdScript,
  organizationJsonLd,
  personJsonLd,
  tvSeriesJsonLd,
  websiteJsonLd,
  ORG_ID,
  type TvSeriesInput,
} from "./structured-data";

// The Organization node is the entity graph search engines and AI crawlers read
// to answer "who is behind Matio". What is asserted here is that it names the
// COMPANY and lets that claim be verified — and never a person.

describe("organizationJsonLd", () => {
  const org = organizationJsonLd();

  it("identifies the operator as the company, verifiably", () => {
    expect(org.legalName).toBe("DEEP ORDINARY LTD");
    // Machine-readable registration, not just prose — the number a crawler can
    // check against the register.
    expect(org.identifier).toMatchObject({
      "@type": "PropertyValue",
      propertyID: "GB-COH",
      value: "17381666",
    });
    expect(org.foundingDate).toBe("2026-08-04");
  });

  it("lets the entity be confirmed against Companies House via sameAs", () => {
    const sameAs = org.sameAs as string[];
    expect(
      sameAs.some((u) =>
        u.includes("company-information.service.gov.uk/company/17381666"),
      ),
    ).toBe(true);
    // The social profiles are still there — CH is an addition, not a swap.
    expect(sameAs.length).toBeGreaterThan(1);
  });

  it("never carries a personal name", () => {
    // The whole point of #141: the graph must not re-attach the owner's name.
    const raw = JSON.stringify(org).toLowerCase();
    expect(raw).not.toContain("dobrovolski");
    expect(raw).not.toContain("matvei");
    // founder/creator/author would invite a person; the node has none.
    expect(org).not.toHaveProperty("founder");
    expect(org).not.toHaveProperty("creator");
  });
});

describe("websiteJsonLd", () => {
  it("credits the same Organization node as publisher", () => {
    const site = websiteJsonLd();
    expect(site.publisher).toEqual({ "@id": ORG_ID });
  });
});

describe("jsonLdScript", () => {
  it("cannot be broken out of by a title that closes the script tag", () => {
    const out = jsonLdScript({ name: "Bad </script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    // Still valid JSON that decodes back to the original title.
    expect(JSON.parse(out).name).toBe("Bad </script><script>alert(1)</script>");
  });

  it("drops empty optional properties but keeps meaningful false and 0", () => {
    const out = JSON.parse(
      jsonLdScript({
        description: undefined,
        image: null,
        actor: [],
        nested: { gone: undefined },
        list: [null, "kept", undefined],
        isAccessibleForFree: false,
        episodeNumber: 0,
      }),
    );
    expect(out).toEqual({
      list: ["kept"],
      isAccessibleForFree: false,
      episodeNumber: 0,
    });
  });
});

describe("catalogItemListJsonLd", () => {
  const list = catalogItemListJsonLd([
    {
      slug: "the-scarlet-oath",
      title: "The Scarlet Oath",
      description: "London, 1882.",
      image: "https://x.public.blob.vercel-storage.com/shows/poster.png",
    },
    { slug: "fallen", title: "Fallen", description: null, image: "/shows/fallen.png" },
  ]);
  const elements = list.itemListElement as {
    position: number;
    item: Record<string, unknown>;
  }[];

  it("lists the catalogue in order, 1-based, with its size", () => {
    expect(list.numberOfItems).toBe(2);
    expect(elements.map((e) => e.position)).toEqual([1, 2]);
  });

  it("points each entry at the same @id as the full node on its show page", () => {
    const series = tvSeriesJsonLd(seriesInput({ slug: "the-scarlet-oath" }));
    expect(elements[0].item["@id"]).toBe(series["@id"]);
    expect(elements[0].item.url).toBe("https://matio.tv/shows/the-scarlet-oath");
  });

  it("absolutizes legacy same-origin artwork and passes Blob URLs through", () => {
    expect(elements[0].item.image).toBe(
      "https://x.public.blob.vercel-storage.com/shows/poster.png",
    );
    expect(elements[1].item.image).toBe("https://matio.tv/shows/fallen.png");
    // A missing synopsis is omitted, never serialized as null.
    expect(JSON.parse(jsonLdScript(list)).itemListElement[1].item).not.toHaveProperty(
      "description",
    );
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the trail from 1 and keeps each crumb's URL", () => {
    const crumbs = breadcrumbJsonLd([
      { name: "Matio", url: "https://matio.tv" },
      { name: "Fallen", url: "https://matio.tv/shows/fallen" },
    ]);
    expect(crumbs.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Matio", item: "https://matio.tv" },
      {
        "@type": "ListItem",
        position: 2,
        name: "Fallen",
        item: "https://matio.tv/shows/fallen",
      },
    ]);
  });
});

function seriesInput(over: Partial<TvSeriesInput> = {}): TvSeriesInput {
  return {
    slug: "quedate-conmigo",
    title: "Quédate conmigo",
    description: "A story.",
    images: ["/shows/quedate.png", "https://x.public.blob.vercel-storage.com/hero.png"],
    genre: ["Romance"],
    seasons: [
      {
        number: 1,
        name: null,
        episodes: [
          { number: 1, name: "Uno", durationSeconds: 412, isAccessibleForFree: true },
          { number: 2, name: "Dos", durationSeconds: null, isAccessibleForFree: false },
        ],
      },
    ],
    numberOfSeasons: 1,
    numberOfEpisodes: 2,
    isAccessibleForFree: false,
    ...over,
  };
}

describe("tvSeriesJsonLd + personJsonLd", () => {
  it("links a credited actor to the same entity as its /actors page", () => {
    const person = personJsonLd({ slug: "lena-marsh", name: "Lena Marsh" });
    const series = tvSeriesJsonLd(
      seriesInput({ actors: [{ name: "Lena Marsh", url: person.url as string }] }),
    );
    const [actor] = series.actor as Record<string, unknown>[];
    expect(actor["@id"]).toBe(person["@id"]);
    expect(person.worksFor).toEqual({ "@id": ORG_ID });
    expect(series.productionCompany).toEqual({ "@id": ORG_ID });
  });

  it("marks up per-episode gating and runtime honestly", () => {
    const out = JSON.parse(jsonLdScript(tvSeriesJsonLd(seriesInput())));
    const [season] = out.containsSeason;
    expect(season.numberOfEpisodes).toBe(2);
    expect(season.episode[0]).toMatchObject({
      episodeNumber: 1,
      duration: "PT412S",
      isAccessibleForFree: true,
    });
    // A locked episode keeps its explicit false; an unknown runtime is omitted.
    expect(season.episode[1].isAccessibleForFree).toBe(false);
    expect(season.episode[1]).not.toHaveProperty("duration");
    expect(out.isAccessibleForFree).toBe(false);
  });

  it("absolutizes artwork and omits what a show does not have", () => {
    const out = JSON.parse(
      jsonLdScript(tvSeriesJsonLd(seriesInput({ numberOfEpisodes: 0, seasons: [] }))),
    );
    expect(out.image).toEqual([
      "https://matio.tv/shows/quedate.png",
      "https://x.public.blob.vercel-storage.com/hero.png",
    ]);
    // A cast-less show carries no actor property, and a zero count is omitted
    // rather than claimed.
    expect(out).not.toHaveProperty("actor");
    expect(out).not.toHaveProperty("numberOfEpisodes");
    expect(out).not.toHaveProperty("containsSeason");
  });
});
