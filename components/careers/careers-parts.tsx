import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Presentational pieces of the /careers page (#376), shared by the client
// landing and the server-rendered FAQ. No "use client". The atoms both
// fan-facing landings use (gutters, the gold CTA, the error pill, the text
// link) come from components/ideas/ideas-parts.tsx, so the two pages cannot
// drift apart.

// The page's content column: full width inside the gutters on phones, the
// 1200 grid of the design on desktop.
export const COLUMN = "mx-auto w-full max-w-[1200px]";

// The rust tick + Anton-gold section label over every section heading
// (variant A of the canvas). A span, not a heading: the h2 under it is the
// section's name.
export function SectionLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span aria-hidden className="block h-0.5 w-[18px] flex-none rounded-[1px] bg-rust" />
      <span className="font-display text-[15px] leading-[1.2] uppercase tracking-[0.14em] text-gold xl:text-base">
        {children}
      </span>
    </div>
  );
}

// A two-line section heading, the second line gold.
export function SplitHeading({
  id,
  lines,
  className,
}: {
  id?: string;
  lines: [string, string];
  className?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "font-display text-[40px] leading-none uppercase tracking-[0.02em] text-cream xl:text-[80px] xl:leading-[0.98]",
        className,
      )}
    >
      {lines[0]}
      <br />
      <span className="text-gold">{lines[1]}</span>
    </h2>
  );
}

// Mono kicker: the vacancy counter, list labels, figure captions.
export const MONO = "font-mono text-xs leading-[1.35] uppercase tracking-[0.14em]";
