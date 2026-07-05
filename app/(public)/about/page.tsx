import type { Metadata } from "next";
import Link from "next/link";
import { paymentsEnabled } from "@/lib/free-mode";
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
  // Payments off → describe the service as free (this page is indexed).
  const paymentsOn = paymentsEnabled();
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
      <h1 className="font-display text-4xl uppercase leading-[1.02] tracking-[0.01em] text-gold sm:text-5xl">
        {t.about.heading}
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-cream/80">
        {paymentsOn ? t.about.lead : t.about.leadFree}
      </p>
      <p className="mt-5 text-sm leading-relaxed text-cream/72">
        {paymentsOn ? t.about.bodyStudio : t.about.bodyStudioFree}
      </p>
      <p className="mt-5 text-sm leading-relaxed text-cream/72">
        {t.about.bodyWho}
      </p>

      <h2 className="mt-12 font-display text-xl uppercase tracking-[0.08em] text-gold">
        {t.about.contactHeading}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-cream/72">
        {t.about.contactBody}
      </p>

      <div className="mt-10">
        <Link
          href="/"
          className="inline-flex h-[52px] items-center justify-center rounded-full bg-gold-cta px-8 text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform active:scale-[0.98]"
        >
          {t.about.browseCta}
        </Link>
      </div>
    </main>
  );
}
