import type { Metadata } from "next";
import { IdeasLanding, type IdeasShow } from "@/components/ideas/ideas-landing";
import { IdeasFaq, IdeasHowItWorks } from "@/components/ideas/ideas-sections";
import { getPublishedShows } from "@/lib/catalog";
import { en as t } from "@/lib/i18n/ideas-dictionaries";
import { canonicalUrl } from "@/lib/seo";
import { submitIdea } from "./actions";

// The landing's own background (#370, the owner's photo): a static file, not
// a show's artwork — the show heroes also dress the home page. 1672×941 JPG,
// sRGB; its framing is written into the hero's "landing" focus.
const LANDING_HERO_URL = "/ideas/hero.jpg";

// /ideas — the landing where fans send Matio a story idea (#297, design
// variant A). Indexed, English only since #445 (/es/ideas 308s here); the
// canonical never carries `?show=`. Copy comes from
// lib/i18n/ideas-dictionaries.ts (not the shared dictionaries.ts — see its
// header). The server action is handed to the client form as a prop, so the
// form never imports a server module.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: { canonical: canonicalUrl("/ideas") },
    robots: { index: true, follow: true },
  };
}

export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const [{ show }, published] = await Promise.all([
    searchParams,
    getPublishedShows(),
  ]);

  // `?show=<slug>` preselects a series only when it names a published show;
  // a repeated `?show=a&show=b` arrives as an array and preselects nothing.
  const preselected =
    typeof show === "string" ? published.find((s) => s.slug === show) : undefined;

  // The hero still (#370): an ad for one series (`?show=`) lands on that
  // series' own hero; everything else — no `?show`, an unknown slug, a show
  // without a hero — gets the landing's own photo. A poster is never
  // stretched into the hero on purpose — a 2:3 poster full-bleed looks wrong,
  // although the home hero falls back to one.
  const showHero = preselected?.heroImageUrl ?? null;
  const heroImageUrl = showHero ?? LANDING_HERO_URL;

  // Only what the select and the rail need crosses to the client, in catalog
  // order — a newly published show appears here by itself.
  const shows: IdeasShow[] = published.map(({ slug, title, posterImageUrl }) => ({
    slug,
    title,
    posterImageUrl,
  }));

  return (
    <main>
      <IdeasLanding
        shows={shows}
        preselectedSlug={preselected?.slug ?? null}
        heroImageUrl={heroImageUrl}
        heroFocus={showHero ? "show" : "landing"}
        submitIdea={submitIdea}
      >
        <IdeasHowItWorks t={t} />
        <IdeasFaq t={t} />
      </IdeasLanding>
    </main>
  );
}
