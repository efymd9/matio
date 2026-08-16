import type { Metadata } from "next";
import { paymentsEnabled } from "@/lib/free-mode";
import { getDict } from "@/lib/i18n/server";
import { localeAlternates } from "@/lib/seo";
import { PressContent } from "@/components/about/press-content";

// Bilingual press room («About page v3» design, 2026-08-16): verbatim
// boilerplate, the press-kit ZIP (public/press/matio-press-kit.zip — static,
// committed) and the press contact. Indexed: journalists find it by search.
export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getDict();
  return {
    title: t.press.metaTitle,
    description: t.press.metaDescription,
    alternates: localeAlternates("/press", locale),
    robots: { index: true, follow: true },
  };
}

export default async function PressPage() {
  const { locale, t } = await getDict();
  const paymentsOn = paymentsEnabled();
  return (
    <main>
      <PressContent t={t} locale={locale} paymentsOn={paymentsOn} />
    </main>
  );
}
