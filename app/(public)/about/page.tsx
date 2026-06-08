import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { canonicalUrl } from "@/lib/seo";

// Bilingual entity/E-E-A-T page. Restates the studio's name + business
// address + contact, consistent with the legal pages and the Stripe public
// details, giving Google a stable surface to attribute the Matio brand
// (alongside the Organization JSON-LD already in the root layout).
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.about.metaTitle,
    description: t.about.metaDescription,
    alternates: { canonical: canonicalUrl("/about") },
    robots: { index: true, follow: true },
  };
}

export default async function AboutPage() {
  const { t } = await getDict();
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
      <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
        {t.about.heading}
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-white/80">{t.about.lead}</p>
      <p className="mt-5 text-sm leading-relaxed text-white/70">
        {t.about.bodyStudio}
      </p>
      <p className="mt-5 text-sm leading-relaxed text-white/70">
        {t.about.bodyWho}
      </p>

      <h2 className="mt-12 text-lg font-bold text-white">
        {t.about.contactHeading}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-white/70">
        {t.about.contactBody}
      </p>

      <div className="mt-10">
        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-md bg-white px-6 text-sm font-bold text-black transition-colors hover:bg-white/90"
        >
          {t.about.browseCta}
        </Link>
      </div>
    </main>
  );
}
