import type { Metadata } from "next";
import { IdeasLanding, type IdeasShow } from "@/components/ideas/ideas-landing";
import { IdeasFaq, IdeasHowItWorks } from "@/components/ideas/ideas-sections";
import { getPublishedShows } from "@/lib/catalog";
import { pickFeaturedShow } from "@/lib/hero-preview";
import { getLocale } from "@/lib/i18n/server";
import { ideasDictFor } from "@/lib/i18n/ideas-dictionaries";
import { localeAlternates } from "@/lib/seo";
import { submitIdea } from "./actions";

// /ideas (+ /es/ideas) — the landing where fans send Matio a story idea
// (#297, design variant A). Bilingual and indexed; the canonical never
// carries `?show=`. Copy comes from lib/i18n/ideas-dictionaries.ts (not the
// shared dictionaries.ts — see its header). The server action is handed to
// the client form as a prop, so the form never imports a server module.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = ideasDictFor(locale);
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: localeAlternates("/ideas", locale),
    robots: { index: true, follow: true },
  };
}

export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const [{ show }, locale, published] = await Promise.all([
    searchParams,
    getLocale(),
    getPublishedShows(),
  ]);
  const t = ideasDictFor(locale);

  // `?show=<slug>` preselects a series only when it names a published show;
  // a repeated `?show=a&show=b` arrives as an array and preselects nothing.
  const preselected =
    typeof show === "string" ? published.find((s) => s.slug === show) : undefined;

  // The hero still: the preselected show's hero → the featured show's hero
  // (the home page's rule) → none (espresso + floor glow). A poster is never
  // stretched into the hero on purpose — a 2:3 poster full-bleed looks wrong,
  // although the home hero falls back to one.
  const heroImageUrl =
    preselected?.heroImageUrl ?? pickFeaturedShow(published)?.heroImageUrl ?? null;

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
        locale={locale}
        shows={shows}
        preselectedSlug={preselected?.slug ?? null}
        heroImageUrl={heroImageUrl}
        submitIdea={submitIdea}
      >
        <IdeasHowItWorks t={t} />
        <IdeasFaq t={t} locale={locale} />
      </IdeasLanding>
    </main>
  );
}
