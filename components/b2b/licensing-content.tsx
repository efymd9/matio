import Link from "next/link";
import type { ReactNode } from "react";
import { GUTTER } from "@/components/ideas/ideas-parts";
import { Poster } from "@/components/site/poster";
import { toneFor } from "@/lib/design";
import type { LicensingDict } from "@/lib/i18n/b2b-dictionaries";
import type { LicensingCard } from "@/lib/show-facts";
import { cn } from "@/lib/utils";
import { B2bHero, COLUMN, SectionLabel } from "./b2b-parts";

// The /licensing page body (#498): hero, the titles the team has confirmed
// for licensing (lib/licensing.ts) with their catalogue facts, and the
// screener request form. Presentational; the form arrives as a slot.
// A card's "Request a screener" is a plain link to `?title=<slug>#request`:
// it works before hydration, and the page preselects that title.

export const REQUEST_ANCHOR = "request";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-gold/80">{label}</dt>
      <dd className="text-sm leading-snug text-cream/80">{value}</dd>
    </div>
  );
}

export function LicensingContent({
  t,
  cards,
  form,
}: {
  t: LicensingDict;
  cards: readonly LicensingCard[];
  form: ReactNode;
}) {
  const c = t.catalogue;
  return (
    <>
      <B2bHero
        badge={t.hero.badge}
        title={t.hero.title}
        body={t.hero.body}
        cta={t.hero.cta}
        ctaHref={`#${REQUEST_ANCHOR}`}
        imageSrc="/about/still-vision.jpg"
        imageAlt=""
      />

      <section aria-labelledby="titles" className={cn(COLUMN, GUTTER, "pt-18 tablet:pt-22")}>
        <SectionLabel id="titles">{c.label}</SectionLabel>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-cream/65">{c.rights}</p>
        {cards.length === 0 ? (
          <p className="mt-7 max-w-2xl rounded-2xl border border-rust/30 bg-espresso-2 p-6 text-[15px] leading-relaxed text-cream/80 sm:p-7">
            {c.empty}
          </p>
        ) : (
          <ul className="mt-7 grid grid-cols-1 gap-5 tablet:grid-cols-2">
            {cards.map((card) => (
              <li
                key={card.slug}
                className="grid grid-cols-[7.5rem_1fr] gap-5 rounded-2xl border border-rust/30 bg-espresso-2 p-5 sm:grid-cols-[9rem_1fr] sm:p-6"
              >
                <Poster
                  imageUrl={card.posterImageUrl}
                  tone={toneFor(card.slug)}
                  title={card.title}
                  rounded="card"
                  className="aspect-[2/3] w-full shadow-poster"
                />
                <div className="flex min-w-0 flex-col gap-3">
                  <h3 className="font-display text-2xl uppercase leading-[1.05] text-cream">
                    <Link href={`/shows/${card.slug}`} className="hover:text-gold">
                      {card.title}
                    </Link>
                  </h3>
                  {card.logline ? (
                    <p className="line-clamp-4 text-sm leading-relaxed text-cream/70">{card.logline}</p>
                  ) : null}
                  <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {card.genres.length > 0 ? <Fact label={c.genre} value={card.genres.join(", ")} /> : null}
                    {card.episodes ? <Fact label={c.episodes} value={card.episodes} /> : null}
                    {card.languages.length > 0 ? <Fact label={c.languages} value={card.languages.join(", ")} /> : null}
                    {card.format ? <Fact label={c.format} value={card.format} /> : null}
                  </dl>
                  <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
                    <a
                      href={`?title=${encodeURIComponent(card.slug)}#${REQUEST_ANCHOR}`}
                      className="inline-flex h-11 items-center rounded-full bg-gold-cta px-5 text-sm font-extrabold text-gold-deep shadow-cta"
                    >
                      {c.request}
                    </a>
                    {card.trailerUrl ? (
                      <a
                        href={card.trailerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-gold underline underline-offset-[3px]"
                      >
                        {c.trailer}
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        id={REQUEST_ANCHOR}
        aria-labelledby="request-title"
        className={cn(COLUMN, GUTTER, "scroll-mt-24 py-18 tablet:py-22")}
      >
        <div className="grid grid-cols-1 gap-8 tablet:grid-cols-[1fr_1.4fr] tablet:gap-14">
          <div className="flex flex-col gap-4">
            <SectionLabel kicker>{t.form.label}</SectionLabel>
            <h2 id="request-title" className="font-display text-4xl uppercase leading-[1.0] text-cream sm:text-5xl">
              {t.form.title}
            </h2>
            <p className="max-w-md text-[15px] leading-relaxed text-cream/70">{t.form.intro}</p>
          </div>
          {form}
        </div>
      </section>
    </>
  );
}
