import { getPublishedShows } from "@/lib/catalog";
import { paymentsEnabled } from "@/lib/free-mode";
import { SITE_URL } from "@/lib/seo";
import { ALL_SOCIAL_PROFILES } from "@/lib/social-links";

// /llms.txt — the emerging convention (llmstxt.org) for handing AI answer
// engines a curated, high-signal map of the site instead of making them
// scrape it. Everything listed here is already public on the indexed pages;
// the file just removes the scraping step. Plain text/markdown by design.
//
// force-dynamic for the same reason as the sitemap: the catalog read itself
// is cached (unstable_cache, tag 'catalog'), so admin publishes/unpublishes
// show up on the next fetch without a redeploy.
export const dynamic = "force-dynamic";

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export async function GET() {
  const shows = await getPublishedShows();
  const paymentsOn = paymentsEnabled();

  const lines = [
    "# Matio",
    "",
    `> Matio (${SITE_URL}) is a streaming platform for original short-form series produced by the Matio studio.${
      paymentsOn
        ? " Episodes stream with a paid membership; selected episodes and previews are free to watch."
        : " The full catalogue is currently free to watch — no account or payment required."
    }`,
    "",
    `- Site: ${SITE_URL}`,
    "- Operated by: Matvei Dobrovolskii, trading as Matio (United Kingdom)",
    "- Contact: contact@matio.tv",
    "- Site languages: English and Spanish, negotiated on one URL per page (no separate locale URLs)",
    "",
    "## Shows",
    "",
    ...shows.map((s) => {
      const genre = s.genre?.length ? ` (${s.genre.join(", ")})` : "";
      const synopsis = s.description ? ` — ${collapse(s.description)}` : "";
      return `- [${s.title}](${SITE_URL}/shows/${s.slug})${genre}${synopsis}`;
    }),
    "",
    "## Pages",
    "",
    `- [About](${SITE_URL}/about): what Matio is and who runs it`,
    `- [Terms of Service](${SITE_URL}/terms)`,
    `- [Privacy Policy](${SITE_URL}/privacy)`,
    `- [Cookie Policy](${SITE_URL}/cookies)`,
    "",
    "## Official profiles",
    "",
    ...ALL_SOCIAL_PROFILES.map((p) => `- ${p.label}: ${p.url}`),
    "",
    "## Notes for crawlers",
    "",
    `- The catalog is also machine-readable as JSON-LD (ItemList on ${SITE_URL}, TVSeries with full episode lists on each show page) and via ${SITE_URL}/sitemap.xml.`,
    "- Watch pages (/watch/*) are deliberately excluded from crawling in robots.txt; every show's synopsis and episode list lives on its /shows page.",
  ];

  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // CDN-cacheable for an hour — the content only changes when the
      // catalog does, and staleness here is harmless.
      "cache-control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
