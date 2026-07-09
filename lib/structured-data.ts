import "server-only";

import { SITE_NAME, SITE_URL, canonicalUrl } from "./seo";

// JSON-LD structured data builders. The Next.js Metadata API has no JSON-LD
// field, so these produce plain schema.org objects that callers embed via a
// server-rendered <script type="application/ld+json">. See app/layout.tsx
// (Organization + WebSite, site-wide) and app/(public)/shows/[slug]/page.tsx
// (BreadcrumbList + TVSeries).
//
// Deliberate omissions, each grounded in current Google guidance:
//   - No SearchAction / Sitelinks Search Box — retired by Google Nov 2024.
//   - No VideoObject — Google requires it on a page where the user can watch
//     the video (the /shows page has no player; the player lives on the
//     robots-disallowed /watch), and paywalled-content markup isn't defined
//     for VideoObject. Subscription gating is expressed honestly via
//     isAccessibleForFree on the TVSeries / TVEpisode CreativeWork entities.
//   - No aggregateRating / review / director — the data model has none;
//     inventing them to chase a richer card is structured-data spam.
//     (actor IS emitted since 2026-07-09: the cast of virtual actors is real
//     admin-entered data, marked up as Person nodes pointing at /actors/*.)

type JsonLd = Record<string, unknown>;

// Stable @id anchors so cross-references resolve even across separate <script>
// blocks on the same page (publisher / productionCompany point here).
export const ORG_ID = `${SITE_URL}/#org`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

// Recursively drop undefined/null values and empty arrays/objects so optional
// schema.org properties vanish cleanly instead of serializing as null. Keeps
// `false` (isAccessibleForFree: false is meaningful) and `0`.
function prune<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((v) => prune(v))
      .filter((v) => v !== undefined && v !== null) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pv = prune(v);
      if (pv === undefined || pv === null) continue;
      if (Array.isArray(pv) && pv.length === 0) continue;
      if (
        typeof pv === "object" &&
        !Array.isArray(pv) &&
        Object.keys(pv as object).length === 0
      ) {
        continue;
      }
      out[k] = pv;
    }
    return out as unknown as T;
  }
  return value;
}

// Serialize a node for embedding in <script type="application/ld+json">.
// Escapes `<` to < so a DB-sourced title containing "</script>" can't
// break out of the tag — the exact escape Next.js's JSON-LD guide recommends.
export function jsonLdScript(node: JsonLd): string {
  return JSON.stringify(prune(node)).replace(/</g, "\\u003c");
}

export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    legalName: "Matvei Dobrovolskii",
    url: SITE_URL,
    // Raster logo (Google's Organization-logo guidance prefers a crawlable
    // PNG ≥112×112). Absolute so it's fetchable from any origin.
    logo: `${SITE_URL}/icon-512.png`,
    email: "hello@matio.tv",
    contactPoint: {
      "@type": "ContactPoint",
      email: "hello@matio.tv",
      contactType: "customer support",
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: "221 Derby Road",
      addressLocality: "Nottingham",
      addressCountry: "GB",
    },
    // sameAs intentionally omitted — no confirmed official profiles yet; never
    // ship placeholder/dead links.
  };
}

export function websiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    inLanguage: ["en", "es"],
    publisher: { "@id": ORG_ID },
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

// Virtual-actor profile (/actors/[slug]). Person is the schema.org type the
// TVSeries `actor` references resolve to; the @id matches the URL emitted
// there so the two nodes link up.
export function personJsonLd(input: {
  slug: string;
  name: string;
  description?: string | null;
  image?: string | null;
}): JsonLd {
  const url = `${SITE_URL}/actors/${input.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${url}#person`,
    url,
    name: input.name,
    description: input.description ?? undefined,
    image: input.image ?? undefined,
    worksFor: { "@id": ORG_ID },
  };
}

export type SeriesEpisodeInput = {
  number: number;
  name: string;
  description?: string | null;
  durationSeconds?: number | null;
  isAccessibleForFree: boolean;
};

export type SeriesSeasonInput = {
  number: number;
  name?: string | null;
  episodes: SeriesEpisodeInput[];
};

export type TvSeriesInput = {
  slug: string;
  title: string;
  description?: string | null;
  images: string[];
  genre: string[];
  seasons: SeriesSeasonInput[];
  numberOfSeasons: number;
  numberOfEpisodes: number;
  // false when ≥1 ready episode requires a subscription/sign-in; true only
  // when every ready episode is the free tier (don't lie about gating).
  isAccessibleForFree: boolean;
  // Virtual actors credited on the show, in display order. Optional — prune()
  // drops the property entirely for cast-less shows.
  actors?: { name: string; url: string }[];
};

export function tvSeriesJsonLd(input: TvSeriesInput): JsonLd {
  const url = `${SITE_URL}/shows/${input.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "TVSeries",
    "@id": `${url}#series`,
    url,
    name: input.title,
    description: input.description ?? undefined,
    // JSON-LD has no metadataBase resolution (unlike Next's OG/next-image
    // fields), so a relative legacy /shows/*.png value would be dropped by
    // Google. Absolutize every image here so the invariant holds for any
    // caller; absolute Blob URLs pass through untouched.
    image: input.images.map((u) => (/^https?:\/\//i.test(u) ? u : canonicalUrl(u))),
    genre: input.genre,
    isAccessibleForFree: input.isAccessibleForFree,
    actor: input.actors?.map((a) => ({
      "@type": "Person",
      name: a.name,
      url: a.url,
    })),
    productionCompany: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    numberOfSeasons: input.numberOfSeasons || undefined,
    numberOfEpisodes: input.numberOfEpisodes || undefined,
    containsSeason: input.seasons.map((s) => ({
      "@type": "TVSeason",
      seasonNumber: s.number,
      name: s.name ?? undefined,
      numberOfEpisodes: s.episodes.length || undefined,
      episode: s.episodes.map((e) => ({
        "@type": "TVEpisode",
        episodeNumber: e.number,
        name: e.name,
        description: e.description ?? undefined,
        // ISO-8601 runtime. `duration` is the canonical property — defined on
        // Episode and inherited by TVEpisode (not MediaObject-only); it's the
        // runtime signal Google recognizes, vs timeRequired's "effort time".
        duration: e.durationSeconds ? `PT${e.durationSeconds}S` : undefined,
        isAccessibleForFree: e.isAccessibleForFree,
      })),
    })),
  };
}
