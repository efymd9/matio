"use client";

// Watch-page error boundary. lib/mux-token.ts throws if signing env is
// missing or malformed; the trial pipeline can throw on rare DB hiccups.
// Both used to land on a white screen mid-playback. Keep the styling
// cinematic (full-bleed black, centered) so the failure mode reads as
// "the screen went dark" rather than "the site broke".

import { useEffect } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";

export default function WatchSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-espresso px-6 text-center">
      <span className="rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
        {t.watchError.kicker}
      </span>
      <h1 className="mt-4 font-display text-2xl uppercase tracking-[0.01em] text-cream sm:text-3xl">
        {t.watchError.title}
      </h1>
      <p className="mt-3 max-w-sm text-sm text-cream/72">{t.watchError.body}</p>
      {error.digest && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/35">
          {t.watchError.refLabel} · {error.digest}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-full bg-gold-cta px-6 text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform duration-150 ease-out hover:brightness-105 active:scale-[0.98]"
        >
          {t.watchError.tryAgain}
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-full border border-cream/25 px-6 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
        >
          {t.watchError.backToCatalog}
        </Link>
      </div>
    </div>
  );
}
