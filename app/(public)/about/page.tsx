import type { Metadata } from "next";
import { paymentsEnabled } from "@/lib/free-mode";
import { getDict } from "@/lib/i18n/server";
import { localeAlternates } from "@/lib/seo";
import { teamForLocale } from "@/lib/about-team";
import { AboutContent } from "@/components/about/about-content";

// Bilingual studio page («About page v3» design, 2026-08-16): full-bleed 4K
// hero, mission/vision, the one-principle manifest, values, the team slider
// and the press hand-off. Doubles as the entity/E-E-A-T surface — the
// press-contact band restates the studio name, entity line and contact,
// consistent with the legal pages and the Organization JSON-LD.
export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getDict();
  return {
    title: t.about.metaTitle,
    description: t.about.metaDescription,
    alternates: localeAlternates("/about", locale),
    robots: { index: true, follow: true },
  };
}

export default async function AboutPage() {
  const { locale, t } = await getDict();
  // Payments off → the free-to-watch claims render (this page is indexed, so
  // the copy must track the real access model).
  const paymentsOn = paymentsEnabled();
  return (
    <main>
      <AboutContent
        t={t}
        locale={locale}
        paymentsOn={paymentsOn}
        team={teamForLocale(locale)}
      />
    </main>
  );
}
