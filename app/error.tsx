"use client";

// Segment-level fallback for any thrown error inside the app's children.
// Catches misbehaviour in admin server actions, /subscribe, /watch — every
// throw that used to produce a white screen now lands here.

import { useEffect } from "react";
import Link from "next/link";
import { MatioLogo } from "@/components/site/matio-logo";
import { useT } from "@/lib/i18n/client";

export default function GlobalSegmentError({
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-5">
        <MatioLogo size={28} accent="#ff3d3d" />
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
          {t.appError.kicker}
        </p>
        <h1 className="text-3xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-4xl">
          {t.appError.title}
        </h1>
        <p className="max-w-sm text-sm text-white/55">
          {t.appError.body}
        </p>
        {error.digest && (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
            {t.appError.refLabel} · {error.digest}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            {t.appError.tryAgain}
          </button>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-md border border-white/15 bg-white/[0.06] px-6 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
          >
            {t.appError.backHome}
          </Link>
        </div>
      </div>
    </main>
  );
}
