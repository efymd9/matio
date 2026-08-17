import Image from "next/image";
import type { Dict, Locale } from "@/lib/i18n/dictionaries";
import { PressContact } from "./press-contact";

// The /press page body («About page v3» mock, press view): press-room hero
// with the verbatim boilerplate, the press-kit band (tone-a gradient) with
// the ZIP download and asset cards, and the shared press-contact band.
// The kit cards describe what the ZIP actually contains — the mock's fact
// sheet PDF and SVG marks don't exist yet (docs/registry.md), so their cards
// deliberately don't render.

export function PressContent({
  t,
  locale,
  paymentsOn,
}: {
  t: Dict;
  locale: Locale;
  paymentsOn: boolean;
}) {
  return (
    <>
      <section className="mx-auto max-w-7xl px-6 pt-36 sm:px-12 tablet:pt-40">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-[18px] rounded-[1px] bg-rust"
          />
          <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold/75">
            {t.press.kicker}
          </span>
          {/* Owner decision (#91): the contact address is visible above the
              fold, next to the kicker — journalists shouldn't have to scroll
              to the contact band for it. */}
          <a
            href="mailto:contact@matio.tv"
            className="font-mono text-xs tracking-[0.08em] text-gold/80 transition-colors hover:text-gold sm:ml-auto"
          >
            contact@matio.tv
          </a>
        </div>
        <h1 className="mt-5 font-display text-6xl uppercase leading-[0.97] tracking-[0.01em] text-cream sm:text-7xl xl:text-8xl">
          {t.press.title1} <span className="text-gold">{t.press.title2}</span>
        </h1>
        <div className="mt-7">
          <p className="max-w-2xl text-[17px] leading-relaxed text-cream/75">
            {paymentsOn ? t.press.boilerplate : t.press.boilerplateFree}
          </p>
          <p className="mt-3.5 font-mono text-xs tracking-[0.05em] text-cream/50">
            {t.press.boilerplateNote}
          </p>
        </div>
      </section>

      <section className="tone-a mt-20 tablet:mt-24">
        <div className="mx-auto max-w-7xl px-6 py-16 sm:px-12">
          <div className="grid items-center gap-8 tablet:grid-cols-[1fr_auto] tablet:gap-12">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold/75">
                {t.press.kitKicker}
              </p>
              <p className="mt-3 font-display text-3xl uppercase leading-[1.02] text-cream sm:text-4xl">
                {t.press.kitHeading}
              </p>
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-cream/70">
                {t.press.kitBody}
              </p>
            </div>
            <a
              href="/press/matio-press-kit.zip"
              download
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
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
              </svg>
              {t.press.kitDownload}
            </a>
          </div>

          {/* No sm: step on purpose — the custom `tablet:` breakpoint's rules
              are emitted BEFORE `sm:` in the compiled CSS, so an sm: utility
              on the same property overrides tablet: at every width ≥640px
              (see docs/gotchas.md → Tailwind v4 custom breakpoint order). */}
          <div className="mt-10 grid grid-cols-1 gap-3.5 tablet:grid-cols-3">
            <div className="flex items-center gap-3.5 rounded-xl border border-rust/40 bg-espresso/50 px-4 py-3.5">
              <span className="relative block size-11 flex-none overflow-hidden rounded-lg bg-espresso-2">
                <Image
                  src="/press/logomark.png"
                  alt={t.press.logomarkAlt}
                  fill
                  sizes="44px"
                  className="object-cover"
                />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-cream">
                  {t.press.cardLogomark}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] tracking-[0.05em] text-cream/50">
                  {t.press.cardLogomarkMeta}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-3.5 rounded-xl border border-rust/40 bg-espresso/50 px-4 py-3.5">
              <span className="flex size-11 flex-none items-center justify-center overflow-hidden rounded-lg bg-espresso-2">
                <Image
                  src="/brand/matio-wordmark.png"
                  alt={t.press.wordmarkAlt}
                  width={34}
                  height={16}
                  className="h-auto w-[34px]"
                />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-cream">
                  {t.press.cardWordmark}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] tracking-[0.05em] text-cream/50">
                  {t.press.cardWordmarkMeta}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-3.5 rounded-xl border border-rust/40 bg-espresso/50 px-4 py-3.5">
              <span className="relative block size-11 flex-none overflow-hidden rounded-lg">
                <Image
                  src="/press/still-preview.jpg"
                  alt={t.press.stillsAlt}
                  fill
                  sizes="44px"
                  className="object-cover"
                />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-cream">
                  {t.press.cardStills}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] tracking-[0.05em] text-cream/50">
                  {t.press.cardStillsMeta}
                </span>
              </span>
            </div>
          </div>

          <p className="mt-5 font-mono text-xs leading-relaxed tracking-[0.03em] text-cream/55">
            <span className="text-gold">{t.press.usageLabel}</span>{" "}
            {t.press.usageBody}
          </p>
        </div>
      </section>

      <div className="mt-20 tablet:mt-24">
        <PressContact t={t} locale={locale} />
      </div>
    </>
  );
}
