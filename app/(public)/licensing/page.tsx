import type { Metadata } from "next";
import { ScreenerRequestForm } from "@/components/b2b/b2b-forms";
import { LicensingContent } from "@/components/b2b/licensing-content";
import { getPublishedShows } from "@/lib/catalog";
import { licensing as t } from "@/lib/i18n/b2b-dictionaries";
import { LICENSING_TITLES } from "@/lib/licensing";
import { canonicalUrl } from "@/lib/seo";
import { buildLicensingCards } from "@/lib/show-facts";
import { loadEpisodeStats } from "@/lib/show-facts-db";
import { requestScreener } from "./actions";

// /licensing — Content Licensing (#498): the titles the team has confirmed
// for licensing (lib/licensing.ts — independent of the viewer catalogue),
// with posters and facts from the live catalogue, and the screener request
// form (emailed to maksym@matio.tv). Indexed, English, no sign-in. The
// canonical never carries `?title=`.

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: { canonical: canonicalUrl("/licensing") },
    robots: { index: true, follow: true },
  };
}

export const dynamic = "force-dynamic";

export default async function LicensingPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string | string[] }>;
}) {
  const { title } = await searchParams;
  const listed = new Set(LICENSING_TITLES.map((x) => x.slug));
  const shows = (await getPublishedShows()).filter((s) => listed.has(s.slug));
  const stats = await loadEpisodeStats(shows.map((s) => s.id));
  const cards = buildLicensingCards(LICENSING_TITLES, shows, stats);
  // `?title=<slug>` preselects only a title on offer; an array preselects
  // nothing. The key remounts the form when a card link changes it.
  const preselected =
    typeof title === "string" && cards.some((c) => c.slug === title) ? title : null;

  return (
    <main className="bg-background">
      <LicensingContent
        t={t}
        cards={cards}
        form={
          <ScreenerRequestForm
            key={preselected ?? "none"}
            titles={cards.map((c) => ({ slug: c.slug, title: c.title }))}
            preselected={preselected}
            submit={requestScreener}
          />
        }
      />
    </main>
  );
}
