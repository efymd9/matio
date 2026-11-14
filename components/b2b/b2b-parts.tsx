import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { GOLD_CTA, GUTTER } from "@/components/ideas/ideas-parts";
import { cn } from "@/lib/utils";

// Shared pieces of the two business pages (#498), in the site's existing
// language: the /about hero treatment, the rust-tick section label, the
// espresso cards. Presentational; no "use client".

export const COLUMN = "mx-auto w-full max-w-7xl";

// `kicker`: the label over a section that has its own h2 — a <p>, so the
// outline does not get two headings in a row.
export function SectionLabel({
  id,
  kicker = false,
  children,
}: {
  id?: string;
  kicker?: boolean;
  children: ReactNode;
}) {
  const Tag = kicker ? "p" : "h2";
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="inline-block h-0.5 w-[18px] rounded-[1px] bg-rust" />
      <Tag id={id} className="font-display text-xl uppercase tracking-[0.12em] text-gold sm:text-2xl">
        {children}
      </Tag>
    </div>
  );
}

export function B2bHero({
  badge,
  title,
  body,
  cta,
  ctaHref,
  imageSrc,
  imageAlt,
}: {
  badge: string;
  title: string;
  body: string;
  cta: string;
  ctaHref: string;
  imageSrc: string;
  imageAlt: string;
}) {
  return (
    <section className="relative isolate flex min-h-[520px] flex-col justify-end overflow-hidden tablet:min-h-[620px]">
      <Image src={imageSrc} alt={imageAlt} fill priority sizes="100vw" className="object-cover" />
      <div aria-hidden className="duotone-strong absolute inset-0" />
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-espresso via-espresso/50 to-transparent" />
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 hidden w-[60%] bg-linear-to-r from-espresso/85 via-espresso/35 to-transparent tablet:block"
      />
      <div className={cn(COLUMN, GUTTER, "relative z-10 flex flex-col items-start gap-4 pt-32 pb-14 tablet:pb-17")}>
        <span className="rounded-full bg-burgundy px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-cream">
          {badge}
        </span>
        <h1 className="max-w-[820px] font-display text-5xl uppercase leading-[0.98] tracking-[0.01em] text-balance text-cream sm:text-7xl">
          {title}
        </h1>
        <p className="max-w-[600px] text-base leading-relaxed text-cream/75 sm:text-lg">{body}</p>
        <a href={ctaHref} className={cn(GOLD_CTA, "mt-1.5")}>
          {cta}
        </a>
      </div>
    </section>
  );
}

// The cross-links shown on /about and /press (#498): the two business pages.
export function B2bLinksBand({
  kicker,
  heading,
  links,
}: {
  kicker: string;
  heading: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-20 sm:px-12 tablet:pb-24">
      <div className="grid items-center gap-8 rounded-3xl border border-rust/30 bg-espresso-2 p-8 sm:p-10 tablet:grid-cols-[1fr_auto] tablet:gap-12">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold/75">{kicker}</p>
          <p className="mt-3 font-display text-2xl uppercase leading-[1.05] text-cream sm:text-3xl">{heading}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex h-[52px] items-center justify-center rounded-full border border-rust/60 bg-burgundy/45 px-7 text-sm font-semibold text-cream transition-colors hover:bg-burgundy/60"
            >
              {l.label} →
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
