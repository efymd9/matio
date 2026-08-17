import Image from "next/image";
import Link from "next/link";
import type { Dict, Locale } from "@/lib/i18n/dictionaries";
import type { TeamMember } from "@/lib/about-team";
import { TeamSlider } from "./team-slider";
import { PressContact } from "./press-contact";

// The /about page body («About page v3» mock): 4K hero with the duotone
// treatment, mission/vision splits, the one-principle manifest, the values
// grid, the team slider band and the press hand-off banner. Presentational —
// the route wrapper resolves dict/locale/payments and passes them down, so
// the Lab renders this exactly as production does.

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="inline-block h-0.5 w-[18px] rounded-[1px] bg-rust"
      />
      <h2 className="font-display text-xl uppercase tracking-[0.12em] text-gold sm:text-2xl">
        {children}
      </h2>
    </div>
  );
}

export function AboutContent({
  t,
  locale,
  paymentsOn,
  team,
}: {
  t: Dict;
  locale: Locale;
  paymentsOn: boolean;
  team: TeamMember[];
}) {
  const principles = paymentsOn
    ? t.about.principlesPaid
    : t.about.principlesFree;
  return (
    <>
      <section className="relative isolate flex h-[560px] flex-col justify-end overflow-hidden tablet:h-[720px]">
        <Image
          src="/about/hero.jpg"
          alt={t.about.heroAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div aria-hidden="true" className="duotone-strong absolute inset-0" />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-linear-to-t from-espresso via-espresso/40 to-transparent"
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 hidden w-[58%] bg-linear-to-r from-espresso/85 via-espresso/35 to-transparent tablet:block"
        />
        <div className="relative z-10 flex max-w-[820px] flex-col items-start gap-4 px-6 pb-14 sm:px-12 tablet:pb-17">
          <span className="rounded-full bg-burgundy px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-cream">
            {t.about.heroBadge}
          </span>
          <h1 className="font-display text-5xl uppercase leading-[0.98] tracking-[0.01em] text-cream sm:text-7xl xl:text-8xl">
            {t.about.heroTitle1}
            <br />
            <span className="text-gold">{t.about.heroTitle2}</span>
          </h1>
          <p className="max-w-[560px] text-base leading-relaxed text-cream/75">
            {paymentsOn ? t.about.heroSub : t.about.heroSubFree}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1.5">
            <Link
              href="/"
              className="inline-flex h-[52px] items-center justify-center gap-2.5 rounded-full bg-gold-cta px-8 text-[15px] font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform active:scale-[0.98]"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 3l14 9-14 9V3z" />
              </svg>
              {t.about.browseCta}
            </Link>
            <Link
              href="/press"
              className="inline-flex h-[52px] items-center rounded-full border border-rust/60 bg-burgundy/45 px-7 text-sm font-semibold text-cream backdrop-blur-xl transition-colors hover:bg-burgundy/60"
            >
              {t.about.pressCta} →
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-6 pt-20 sm:px-12 tablet:grid-cols-[1fr_30rem] tablet:gap-16 tablet:pt-24">
        <div>
          <SectionLabel>{t.about.missionLabel}</SectionLabel>
          <p className="mt-5 text-xl font-semibold leading-snug text-cream sm:text-[26px]">
            {t.about.missionHeading}
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-cream/65">
            {t.about.missionBody}
          </p>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-[20px] border border-rust/30">
          <Image
            src="/about/still-mission.jpg"
            alt={t.about.missionAlt}
            fill
            sizes="(min-width: 834px) 30rem, 100vw"
            className="object-cover"
          />
          <div aria-hidden="true" className="duotone absolute inset-0" />
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-6 pt-16 sm:px-12 tablet:grid-cols-[30rem_1fr] tablet:gap-16 tablet:pt-22">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[20px] border border-rust/30 tablet:order-first">
          <Image
            src="/about/still-vision.jpg"
            alt={t.about.visionAlt}
            fill
            sizes="(min-width: 834px) 30rem, 100vw"
            className="object-cover"
          />
          <div aria-hidden="true" className="duotone absolute inset-0" />
        </div>
        <div>
          <SectionLabel>{t.about.visionLabel}</SectionLabel>
          <p className="mt-5 text-xl font-semibold leading-snug text-cream sm:text-[26px]">
            {t.about.visionHeading}
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-cream/65">
            {t.about.visionBody}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pt-20 text-center sm:px-12 tablet:pt-24">
        <p className="font-display text-3xl uppercase leading-[1.05] tracking-[0.01em] text-balance text-gold sm:text-5xl xl:text-6xl">
          {t.about.manifestLine1}
          <br />
          <span className="text-cream/90">{t.about.manifestLine2}</span>
        </p>
        <p className="mt-4 font-mono text-xs tracking-[0.1em] text-cream/45">
          {t.about.manifestCaption}
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-6 pt-16 sm:px-12 tablet:pt-22">
        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2 tablet:gap-5">
          {principles.map((principle, i) => (
            <div
              key={principle}
              className="flex items-start gap-5 rounded-2xl border border-rust/30 bg-espresso-2 p-6 sm:px-7"
            >
              <span className="font-mono text-xs leading-6 tracking-[0.1em] text-gold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="text-[17px] font-semibold leading-normal text-cream">
                {principle}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20 tablet:mt-24">
        <div className="mx-auto mb-6 max-w-7xl px-6 sm:px-12">
          <SectionLabel>{t.about.teamLabel}</SectionLabel>
        </div>
        <div className="relative overflow-hidden border-y border-rust/30 bg-espresso-2 px-6 py-10 sm:px-12">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-gold/45 to-transparent"
          />
          <div className="mx-auto max-w-7xl">
            <TeamSlider
              members={team}
              heading1={t.about.teamHeading1}
              heading2={t.about.teamHeading2}
              sub={t.about.teamSub(team.length)}
              prevLabel={t.about.teamPrev}
              nextLabel={t.about.teamNext}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 sm:px-12 tablet:py-24">
        <div className="grid items-center gap-8 rounded-3xl border border-rust/30 bg-espresso-2 p-8 sm:p-10 tablet:grid-cols-[1fr_auto] tablet:gap-12">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold/75">
              {t.about.pressBannerKicker}
            </p>
            <p className="mt-3 font-display text-2xl uppercase leading-[1.05] text-cream sm:text-3xl">
              {t.about.pressBannerHeading}
            </p>
          </div>
          <Link
            href="/press"
            className="inline-flex h-[52px] items-center justify-center rounded-full border border-rust/60 bg-burgundy/45 px-7 text-sm font-semibold text-cream transition-colors hover:bg-burgundy/60"
          >
            {t.about.pressBannerCta} →
          </Link>
        </div>
      </section>

      <PressContact t={t} locale={locale} />
    </>
  );
}
