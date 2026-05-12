import Link from "next/link";
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT } from "@/lib/design";

// Soft-sidekick paywall (Variant B from the design): the player frame stays
// dimly visible at the top, and a slide-up sheet offers month/year plans.
// Friendlier than a blocker — preserves the connection to what they were
// watching and frames the price as continuing the story, not paying for it.
export function Paywall({
  showSlug,
  resumeSeconds,
  episodeLabel,
  showTitle,
}: {
  showSlug: string;
  resumeSeconds?: number;
  episodeLabel?: string;
  showTitle?: string;
}) {
  const params = new URLSearchParams({ show: showSlug });
  if (resumeSeconds && resumeSeconds > 0) {
    params.set("resume", String(resumeSeconds));
  }
  const subscribeHref = `/subscribe?${params.toString()}`;

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
      {/* Dim atmospheric backdrop (stand-in for the paused frame) */}
      <div
        className="absolute inset-0"
        style={{ backgroundImage: TONE_GRADIENT.a }}
      />
      <div
        className="absolute inset-0 opacity-55"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 60% 40%, rgba(255,255,255,0.18), transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,0,0,0.6), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 bg-black/55" />

      {/* "Preview ended" red chip floats above the sheet */}
      <div className="absolute left-1/2 top-[28%] -translate-x-1/2 rounded-full bg-[#ff3d3d]/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white backdrop-blur-md">
        Preview complete
      </div>

      {/* Bottom sheet */}
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-[#0f0f12]/95 px-5 pb-5 pt-3 backdrop-blur-2xl sm:px-8 sm:pb-7 sm:pt-4">
        <div className="mx-auto max-w-2xl">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20" aria-hidden />

          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#ff3d3d]">
            Continue watching
          </p>
          <h2 className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl">
            {showTitle ?? "Your story"}
            {episodeLabel ? (
              <span className="ml-2 text-white/55">· {episodeLabel}</span>
            ) : null}
            <span className="block text-sm font-semibold text-white/55 sm:text-base">
              Pick up where you left off.
            </span>
          </h2>

          {/* Plan cards */}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-white/10 bg-white/[0.05] p-3">
              <p className="text-[11px] text-white/60">Monthly</p>
              <p className="mt-1 text-base font-bold text-white">$9.99</p>
              <p className="mt-0.5 text-[10px] text-white/50">cancel anytime</p>
            </div>
            <div className="relative rounded-lg border-[1.5px] border-[#ff3d3d] bg-gradient-to-br from-[#ff3d3d33] to-white/[0.04] p-3">
              <span className="absolute -top-2 right-2.5 rounded-[3px] bg-[#ff3d3d] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-white">
                −33%
              </span>
              <p className="text-[11px] text-white/70">Annual</p>
              <p className="mt-1 text-base font-bold text-white">$79.99</p>
              <p className="mt-0.5 text-[10px] text-white/60">≈ $6.67/mo</p>
            </div>
          </div>

          <Link
            href={subscribeHref}
            className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] text-sm font-bold text-white transition-all hover:brightness-110"
          >
            <Icon name="play" size={14} color="#ffffff" />
            Continue · Subscribe
          </Link>
          <p className="mt-2 text-center text-[10px] text-white/45">
            Cancel anytime from your account.
          </p>
        </div>
      </div>
    </div>
  );
}
