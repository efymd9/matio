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
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT } from "@/lib/design";
import { useT } from "@/lib/i18n/client";

export function RateLimitedNotice({ showSlug }: { showSlug: string }) {
  const t = useT();
  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: TONE_GRADIENT.c }}
      />
      <div className="absolute inset-0 bg-black/65" />
      <div className="relative mx-auto max-w-md px-6 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-amber-300">
          {t.watch.rateLimitedKicker}
        </p>
        <h2 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
          {t.watch.rateLimitedTitle}
        </h2>
        <p className="mt-3 text-sm text-white/65">
          {t.watch.rateLimitedBody}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href={`/subscribe?show=${encodeURIComponent(showSlug)}`}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-6 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter] hover:brightness-110 active:scale-[0.98]"
          >
            <Icon name="play" size={14} color="#ffffff" />
            {t.watch.rateLimitedSubscribe}
          </Link>
          <Link
            href={`/shows/${showSlug}`}
            className="inline-flex h-11 items-center rounded-md border border-white/15 bg-white/[0.06] px-6 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
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
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: TONE_GRADIENT.f }}
      />
      <div className="absolute inset-0 bg-black/65" />
      <div className="relative mx-auto max-w-md px-6 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
          {t.watch.unavailableKicker}
        </p>
        <h2 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
          {t.watch.unavailableTitle}
        </h2>
        <p className="mt-3 text-sm text-white/65">
          {t.watch.unavailableBody}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            {t.watch.unavailableRetry}
          </button>
          <Link
            href={`/shows/${showSlug}`}
            className="inline-flex h-11 items-center rounded-md border border-white/15 bg-white/[0.06] px-6 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
          >
            {t.watch.unavailableBack}
          </Link>
        </div>
      </div>
    </div>
  );
}
