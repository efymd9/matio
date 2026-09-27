import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Presentational pieces shared by the /ideas client form and its
// server-rendered How-it-works / FAQ blocks (#297). No "use client": the
// server sections render them on the server, the form in the browser.

// Side gutters — 24px on phones, 48px from `sm`, never inside a notch.
// The same numbers the site header uses, so the page edges line up with it.
export const GUTTER =
  "pl-[max(env(safe-area-inset-left),1.5rem)] pr-[max(env(safe-area-inset-right),1.5rem)] sm:pl-[max(env(safe-area-inset-left),3rem)] sm:pr-[max(env(safe-area-inset-right),3rem)]";

// Mono chapter label (chapters, the bar, the logline's <label>).
export const MONO_LABEL =
  "font-mono text-[11px] leading-[1.3] uppercase tracking-[0.12em] text-gold/75";

// A link inside running text.
export const TEXT_LINK = "text-gold underline underline-offset-[3px]";

// The gold pill CTA, mobile → desktop sizes (the submit and the hero CTA).
export const GOLD_CTA =
  "inline-flex h-[52px] items-center justify-center rounded-full bg-gold-cta px-8 text-[15px] font-extrabold text-gold-deep shadow-cta transition-[transform,filter] duration-150 ease-out hover:brightness-[1.08] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60 xl:h-14 xl:px-10 xl:text-base";

// The standard card (the no-prize note, "Before you send it", the steps).
export const CARD = "rounded-2xl border border-rust/30 bg-espresso-2";

// The rust-tick + Anton-gold section header — the idiom of
// components/site/section-row.tsx without its scrolling rail.
export function SectionHeading({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span aria-hidden className="block h-0.5 w-3.5 flex-none rounded-[1px] bg-rust" />
      <h2
        id={id}
        className="font-display text-base leading-[1.2] uppercase tracking-[0.12em] text-gold tablet:text-lg xl:text-xl"
      >
        {children}
      </h2>
    </div>
  );
}

// A field's error, the summary above the button and the server pills. The
// text stays cream: rust on espresso is 3.2:1, below the text minimum.
export function ErrorPill({
  id,
  role,
  className,
  children,
}: {
  id?: string;
  role?: "alert";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role={role}
      className={cn(
        "flex max-w-full items-start gap-2 self-start rounded-lg border border-rust/60 bg-rust/[0.08] px-3 py-2 text-xs leading-[1.45] text-cream/75",
        className,
      )}
    >
      <span aria-hidden className="mt-[5px] size-1.5 flex-none rounded-full bg-rust" />
      <span>{children}</span>
    </div>
  );
}
