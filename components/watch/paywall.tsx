"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT } from "@/lib/design";
import { cn } from "@/lib/utils";

// Soft-sidekick paywall (Variant B from the design): the player frame stays
// dimly visible at the top, and a slide-up sheet offers month/year plans.
// Friendlier than a blocker — preserves the connection to what they were
// watching and frames the price as continuing the story, not paying for it.
//
// Client component because:
//   1. The two plan cards are an interactive selection (state-driven
//      highlight, default Annual).
//   2. The CTA uses useTransition so the button can show press feedback
//      (active:scale) + a spinner while navigating to /subscribe; the
//      pending state stays true until the new page commits.
// The selected plan is appended to the /subscribe URL so the next page
// boots with the same plan already chosen — no double-click.
type Plan = "monthly" | "annual";

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
  const [plan, setPlan] = useState<Plan>("annual");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const continueToSubscribe = () => {
    const params = new URLSearchParams({ show: showSlug, plan });
    if (resumeSeconds && resumeSeconds > 0) {
      params.set("resume", String(resumeSeconds));
    }
    const href = `/subscribe?${params.toString()}`;
    startTransition(() => router.push(href));
  };

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

          {/* Plan cards — buttons that toggle the selected plan. Visual
              highlight is driven by the `plan` state, so a single click
              both selects and shows the change. Aria-pressed reflects
              selection for screen readers. */}
          <div
            className="mt-4 grid grid-cols-2 gap-2.5"
            role="radiogroup"
            aria-label="Choose a subscription plan"
          >
            <PlanOption
              kind="monthly"
              selected={plan === "monthly"}
              onSelect={() => setPlan("monthly")}
            />
            <PlanOption
              kind="annual"
              selected={plan === "annual"}
              onSelect={() => setPlan("annual")}
              discountBadge="−33%"
            />
          </div>

          <button
            type="button"
            onClick={continueToSubscribe}
            disabled={isPending}
            aria-busy={isPending}
            className="group/cta relative mt-4 inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12] active:scale-[0.98] disabled:cursor-wait disabled:opacity-90"
          >
            {isPending ? (
              <>
                <Spinner />
                <span>Continuing to checkout…</span>
              </>
            ) : (
              <>
                <Icon name="play" size={14} color="#ffffff" />
                <span>Continue · Subscribe</span>
              </>
            )}
          </button>
          <p className="mt-2 text-center text-[10px] text-white/45">
            Cancel anytime from your account.
          </p>
        </div>
      </div>
    </div>
  );
}

function PlanOption({
  kind,
  selected,
  onSelect,
  discountBadge,
}: {
  kind: Plan;
  selected: boolean;
  onSelect: () => void;
  discountBadge?: string;
}) {
  const isAnnual = kind === "annual";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group/plan relative cursor-pointer overflow-hidden rounded-lg p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12]",
        selected
          ? "border-[1.5px] border-[#ff3d3d] bg-gradient-to-br from-[#ff3d3d33] to-white/[0.04] shadow-[0_10px_30px_-18px_rgba(255,61,61,0.6)]"
          : "border border-white/10 bg-white/[0.05] hover:border-white/25 hover:bg-white/[0.08]",
      )}
    >
      {discountBadge ? (
        <span
          className={cn(
            "absolute -top-2 right-2.5 rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-white transition-colors",
            selected ? "bg-[#ff3d3d]" : "bg-white/15",
          )}
        >
          {discountBadge}
        </span>
      ) : null}
      <p
        className={cn(
          "text-[11px] transition-colors",
          selected ? "text-white" : "text-white/60",
        )}
      >
        {isAnnual ? "Annual" : "Monthly"}
      </p>
      <p className="mt-1 text-base font-bold text-white">
        {isAnnual ? "$79.99" : "$9.99"}
      </p>
      <p
        className={cn(
          "mt-0.5 text-[10px] transition-colors",
          selected ? "text-white/75" : "text-white/50",
        )}
      >
        {isAnnual ? "≈ $6.67/mo" : "cancel anytime"}
      </p>

      {/* Small radio dot top-left — empty ring by default, filled when
          selected. Only visible briefly enough to read as "this is the
          one that's chosen" without competing with the price. */}
      <span
        aria-hidden
        className={cn(
          "absolute bottom-2.5 right-2.5 inline-flex size-3.5 items-center justify-center rounded-full border transition-colors",
          selected ? "border-[#ff3d3d]" : "border-white/25",
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full bg-[#ff3d3d] transition-transform duration-150",
            selected ? "scale-100" : "scale-0",
          )}
        />
      </span>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
