import type { Metadata } from "next";
import { StudioBriefForm } from "@/components/b2b/b2b-forms";
import { StudioContent, type StudioCase } from "@/components/b2b/studio-content";
import { getPublishedShows } from "@/lib/catalog";
import { studio as t } from "@/lib/i18n/b2b-dictionaries";
import { canonicalUrl } from "@/lib/seo";
import { formatEpisodeStats } from "@/lib/show-facts";
import { loadEpisodeStats } from "@/lib/show-facts-db";
import { BEFORE_AFTER, SHOWCASE_SLUG } from "@/lib/studio";
import { submitStudioBrief } from "./actions";

// /studio — Production & VFX (#498): the studio's services and the brief
// form, whose submissions are emailed to contact@matio.tv. Indexed, English,
// no sign-in.

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: { canonical: canonicalUrl("/studio") },
    robots: { index: true, follow: true },
  };
}

// Per request: the catalogue read is cached (lib/catalog.ts), the episode
// facts are one grouped query.
export const dynamic = "force-dynamic";

async function loadShowcase(): Promise<StudioCase | null> {
  const show = (await getPublishedShows()).find((s) => s.slug === SHOWCASE_SLUG);
  if (!show) return null;
  const stats = (await loadEpisodeStats([show.id])).get(show.id);
  return {
    slug: show.slug,
    title: show.title,
    genres: show.genre,
    episodes: stats ? formatEpisodeStats(stats) : null,
    posterImageUrl: show.posterImageUrl ?? show.heroImageUrl,
  };
}

export default async function StudioPage() {
  const showcase = await loadShowcase();
  return (
    <main className="bg-background">
      <StudioContent
        t={t}
        showcase={showcase}
        beforeAfter={BEFORE_AFTER}
        form={<StudioBriefForm submit={submitStudioBrief} />}
      />
    </main>
  );
}
