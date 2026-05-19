"use client";

// Watch-page error boundary. lib/mux-token.ts throws if signing env is
// missing or malformed; the trial pipeline can throw on rare DB hiccups.
// Both used to land on a white screen mid-playback. Keep the styling
// cinematic (full-bleed black, centered) so the failure mode reads as
// "the screen went dark" rather than "the site broke".

import { useEffect } from "react";
import Link from "next/link";

export default function WatchSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black px-6 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
        Playback interrupted
      </p>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
        The reel jammed.
      </h1>
      <p className="mt-3 max-w-sm text-sm text-white/55">
        Something went wrong fetching this episode. Try again, or pick a
        different show.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
          ref · {error.digest}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-md border border-white/15 bg-white/[0.06] px-6 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
        >
          Back to catalog
        </Link>
      </div>
    </div>
  );
}
