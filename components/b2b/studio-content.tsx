import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { GUTTER } from "@/components/ideas/ideas-parts";
import { Poster } from "@/components/site/poster";
import { toneFor } from "@/lib/design";
import type { StudioDict } from "@/lib/i18n/b2b-dictionaries";
import { cn } from "@/lib/utils";
import { B2bHero, COLUMN, SectionLabel } from "./b2b-parts";

// The /studio page body (#498): hero, the three services, Selected Work
// (a Matio original — never a client project, never anything under NDA),
// the Before / After slot and the brief form. Presentational: the route
// resolves the case study and hands the form in as a slot, so the Lab
// renders this exactly as production does.

export type StudioCase = {
  slug: string;
  title: string;
  genres: string[];
  episodes: string | null;
  posterImageUrl: string | null;
};

// A public before/after pair on Matio's OWN footage. null = the block is not
// drawn (it is, until such a pair exists — docs/registry.md, #498).
export type BeforeAfter = {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  caption: string;
};

export const BRIEF_ANCHOR = "brief";

export function StudioContent({
  t,
  showcase,
  beforeAfter,
  form,
}: {
  t: StudioDict;
  showcase: StudioCase | null;
  beforeAfter: BeforeAfter | null;
  form: ReactNode;
}) {
  return (
    <>
      <B2bHero
        badge={t.hero.badge}
        title={t.hero.title}
        body={t.hero.body}
        cta={t.hero.cta}
        ctaHref={`#${BRIEF_ANCHOR}`}
        imageSrc="/about/hero.jpg"
        imageAlt={t.hero.stillAlt}
      />

      <section aria-labelledby="services" className={cn(COLUMN, GUTTER, "pt-18 tablet:pt-22")}>
        <SectionLabel id="services">{t.services.label}</SectionLabel>
        <ul className="mt-7 grid grid-cols-1 gap-4 tablet:grid-cols-3 tablet:gap-5">
          {t.services.items.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-3 rounded-2xl border border-rust/30 bg-espresso-2 p-6 sm:p-7">
              <span className="font-mono text-xs tracking-[0.1em] text-gold">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="font-display text-2xl uppercase leading-[1.05] text-cream">{s.title}</h3>
              <p className="text-[15px] leading-relaxed text-cream/70">{s.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {showcase ? (
        <section aria-labelledby="work" className={cn(COLUMN, GUTTER, "pt-18 tablet:pt-22")}>
          <SectionLabel id="work">{t.work.label}</SectionLabel>
          <div className="mt-7 grid grid-cols-1 items-center gap-7 rounded-3xl border border-rust/30 bg-espresso-2 p-6 sm:p-9 tablet:grid-cols-[14rem_1fr] tablet:gap-10">
            <Link href={`/shows/${showcase.slug}`} className="block w-40 tablet:w-full" tabIndex={-1} aria-hidden>
              <Poster
                imageUrl={showcase.posterImageUrl}
                tone={toneFor(showcase.slug)}
                title={showcase.title}
                rounded="card"
                className="aspect-[2/3] w-full shadow-poster"
              />
            </Link>
            <div className="flex flex-col items-start gap-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold/75">{t.work.kicker}</p>
              <h3 className="font-display text-3xl uppercase leading-[1.0] text-cream sm:text-4xl">{showcase.title}</h3>
              {showcase.episodes || showcase.genres.length > 0 ? (
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-cream/60">
                  {[showcase.episodes, showcase.genres.join(" · ")].filter(Boolean).join(" — ")}
                </p>
              ) : null}
              <p className="max-w-xl text-[15px] leading-relaxed text-cream/70">{t.work.body}</p>
              <Link
                href={`/shows/${showcase.slug}`}
                className="mt-1 inline-flex h-[52px] items-center rounded-full border border-rust/60 bg-burgundy/45 px-7 text-sm font-semibold text-cream transition-colors hover:bg-burgundy/60"
              >
                {t.work.cta} →
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {beforeAfter ? (
        <section aria-labelledby="before-after" className={cn(COLUMN, GUTTER, "pt-18 tablet:pt-22")}>
          <SectionLabel id="before-after">{t.beforeAfter.label}</SectionLabel>
          <figure className="mt-7">
            <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
              {(
                [
                  [t.beforeAfter.before, beforeAfter.beforeSrc, beforeAfter.beforeAlt],
                  [t.beforeAfter.after, beforeAfter.afterSrc, beforeAfter.afterAlt],
                ] as const
              ).map(([label, src, alt]) => (
                <div key={label} className="relative aspect-video overflow-hidden rounded-[20px] border border-rust/30">
                  <Image src={src} alt={alt} fill sizes="(min-width: 834px) 50vw, 100vw" className="object-cover" />
                  <span className="absolute top-3 left-3 rounded-full bg-espresso/80 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-cream">
                    {label}
                  </span>
                </div>
              ))}
            </div>
            <figcaption className="mt-3 text-sm text-cream/60">{beforeAfter.caption}</figcaption>
          </figure>
        </section>
      ) : null}

      <section
        id={BRIEF_ANCHOR}
        aria-labelledby="brief-title"
        className={cn(COLUMN, GUTTER, "scroll-mt-24 py-18 tablet:py-22")}
      >
        <div className="grid grid-cols-1 gap-8 tablet:grid-cols-[1fr_1.4fr] tablet:gap-14">
          <div className="flex flex-col gap-4">
            <SectionLabel kicker>{t.form.label}</SectionLabel>
            <h2 id="brief-title" className="font-display text-4xl uppercase leading-[1.0] text-cream sm:text-5xl">
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
