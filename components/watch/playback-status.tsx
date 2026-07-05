"use client";

// Non-paywall end-states for the player. Distinct from <Paywall>, which is
// reserved for the legitimate "your 60-second preview ended → here are the
// plans" case (status 403 in trial mode).
//
// - <RateLimitedNotice> renders on 429 (too many trial starts from this
//   IP bucket in the last hour). Frames the cap as a "take a breather"
//   moment and still offers Subscribe as the way out.
// - <PlaybackUnavailable> renders on 5xx / network failure / video decode
//   error. Offers a retry without sending the user to the paywall — a
//   transient hiccup shouldn't be framed as a payment issue.

import Link from "next/link";
import { TONE_GRADIENT } from "@/lib/design";
import { useT } from "@/lib/i18n/client";

export function RateLimitedNotice({ showSlug }: { showSlug: string }) {
  const t = useT();
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-espresso sm:aspect-video sm:h-auto">
      <div
        className="absolute inset-0"
        aria-hidden
        style={{ backgroundImage: TONE_GRADIENT.c }}
      />
      <div className="duotone pointer-events-none absolute inset-0" aria-hidden />
      <div className="absolute inset-0 bg-espresso/70" aria-hidden />
      <div className="relative mx-auto max-w-md px-6 text-center">
        <span className="inline-flex rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
          {t.watch.rateLimitedKicker}
        </span>
        <h2 className="mt-4 font-display text-2xl uppercase leading-tight tracking-[0.01em] text-cream sm:text-3xl">
          {t.watch.rateLimitedTitle}
        </h2>
        <p className="mt-3 text-sm text-cream/72">{t.watch.rateLimitedBody}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href={`/subscribe?show=${encodeURIComponent(showSlug)}`}
            className="inline-flex h-11 items-center rounded-full bg-gold-cta px-6 text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform duration-150 ease-out hover:brightness-105 active:scale-[0.98]"
          >
            {t.watch.rateLimitedSubscribe}
          </Link>
          <Link
            href={`/shows/${showSlug}`}
            className="inline-flex h-11 items-center rounded-full border border-cream/25 px-6 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            {t.watch.rateLimitedBack}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function PlaybackUnavailable({
  showSlug,
  onRetry,
}: {
  showSlug: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-espresso sm:aspect-video sm:h-auto">
      <div
        className="absolute inset-0"
        aria-hidden
        style={{ backgroundImage: TONE_GRADIENT.f }}
      />
      <div className="duotone pointer-events-none absolute inset-0" aria-hidden />
      <div className="absolute inset-0 bg-espresso/70" aria-hidden />
      <div className="relative mx-auto max-w-md px-6 text-center">
        <span className="inline-flex rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
          {t.watch.unavailableKicker}
        </span>
        <h2 className="mt-4 font-display text-2xl uppercase leading-tight tracking-[0.01em] text-cream sm:text-3xl">
          {t.watch.unavailableTitle}
        </h2>
        <p className="mt-3 text-sm text-cream/72">{t.watch.unavailableBody}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center rounded-full bg-gold-cta px-6 text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform duration-150 ease-out hover:brightness-105 active:scale-[0.98]"
          >
            {t.watch.unavailableRetry}
          </button>
          <Link
            href={`/shows/${showSlug}`}
            className="inline-flex h-11 items-center rounded-full border border-cream/25 px-6 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            {t.watch.unavailableBack}
          </Link>
        </div>
      </div>
    </div>
  );
}
