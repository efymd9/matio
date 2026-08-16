"use client";

import { useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/lib/about-team";

// Accordion team slider from the «About page v3» mock: a row of gradient
// cards where the active one expands (flex-grow 1.55) and reveals name, role
// and bio; hover/focus/tap activates, prev/next rotate the window over the
// roster. Pure client state — nothing here is persisted or fetched.
//
// The visible-card count is responsive (4 from the tablet breakpoint, 3
// below). Window width is read via useSyncExternalStore, same pattern as
// SiteHeader's scroll state — React 19's `react-hooks/set-state-in-effect`
// forbids the initialize-from-window effect.

function subscribeToViewport(cb: () => void) {
  const mq = window.matchMedia("(min-width: 834px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function getViewportSnapshot() {
  return window.matchMedia("(min-width: 834px)").matches;
}
function getViewportServerSnapshot() {
  // Desktop-first SSR: the 4-card layout is what most first paints see; a
  // phone corrects to 3 on hydration.
  return true;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function TeamSlider({
  members,
  heading1,
  heading2,
  sub,
  prevLabel,
  nextLabel,
}: {
  members: TeamMember[];
  heading1: string;
  heading2: string;
  sub: string;
  prevLabel: string;
  nextLabel: string;
}) {
  const [start, setStart] = useState(0);
  const [activeSlot, setActiveSlot] = useState(0);
  const wide = useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  );

  const total = members.length;
  const visible = Math.min(wide ? 4 : 3, total);
  const counter = `${pad(start + 1)}–${pad(((start + visible - 1) % total) + 1)} / ${total}`;

  const step = (dir: 1 | -1) => {
    setStart((s) => (s + dir + total) % total);
    setActiveSlot(0);
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end gap-6">
        <div>
          <p className="font-display text-3xl uppercase leading-[1.04] tracking-[0.015em] text-cream sm:text-4xl">
            {heading1}
            <br />
            <span className="text-gold">{heading2}</span>
          </p>
          <p className="mt-3.5 font-mono text-xs tracking-[0.14em] text-cream/50">
            {sub}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3.5">
          <span
            data-testid="team-counter"
            className="font-mono text-xs tracking-[0.1em] text-cream/50"
          >
            {counter}
          </span>
          <div className="flex gap-2.5">
            <button
              type="button"
              aria-label={prevLabel}
              onClick={() => step(-1)}
              className="flex size-10 items-center justify-center rounded-full border border-cream/15 bg-cream/5 text-cream transition-colors hover:bg-cream/10"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={nextLabel}
              onClick={() => step(1)}
              className="flex size-10 items-center justify-center rounded-full border border-cream/15 bg-cream/5 text-cream transition-colors hover:bg-cream/10"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="flex h-[300px] gap-2.5 tablet:h-[340px]">
        {Array.from({ length: visible }, (_, k) => {
          const m = members[(start + k) % total];
          const active = k === activeSlot;
          return (
            <button
              key={k}
              type="button"
              onMouseEnter={() => setActiveSlot(k)}
              onFocus={() => setActiveSlot(k)}
              onClick={() => setActiveSlot(k)}
              className="relative h-full overflow-hidden rounded-2xl text-left transition-[flex] duration-500 ease-out"
              style={{
                flex: `${active ? 1.55 : 1} 1 0%`,
                backgroundImage: m.gradient,
              }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-opacity duration-300",
                  active ? "opacity-0" : "opacity-100",
                )}
              >
                <span className="font-display text-4xl tracking-[0.04em] text-gold/50">
                  {m.initials}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 bottom-0 h-[70%] bg-linear-to-t from-espresso/80 to-transparent transition-opacity duration-300",
                  active ? "opacity-0" : "opacity-100",
                )}
              />
              <span
                className={cn(
                  "absolute inset-x-4 bottom-3.5 block transition-opacity duration-300",
                  active ? "opacity-0" : "opacity-100",
                )}
              >
                <span className="block text-sm font-semibold text-cream">
                  {m.name}
                </span>
                <span className="mt-0.5 block text-[11px] text-gold/80">
                  {m.role}
                </span>
              </span>
              <span
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-0 block px-5 pt-5 transition-[opacity,transform]",
                  active
                    ? "translate-y-0 opacity-100 delay-100 duration-[450ms]"
                    : "translate-y-2 opacity-0 duration-200",
                )}
              >
                <span className="block text-[17px] font-bold text-cream">
                  {m.name}
                </span>
                <span className="mt-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-gold">
                  {m.role}
                </span>
              </span>
              <span
                className={cn(
                  "pointer-events-none absolute inset-x-0 bottom-0 block px-5 pb-4 transition-[opacity,transform]",
                  active
                    ? "translate-y-0 opacity-100 delay-100 duration-[450ms]"
                    : "translate-y-2 opacity-0 duration-200",
                )}
              >
                <span className="block text-[13px] leading-relaxed text-cream/78">
                  {m.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative mx-auto mt-6 h-[3px] w-[120px] overflow-hidden rounded-sm bg-cream/10">
        <div
          className="h-full rounded-sm bg-gold transition-transform duration-[400ms] ease-out"
          style={{
            width: `${((visible / total) * 100).toFixed(1)}%`,
            transform: `translateX(${((start * 100) / visible).toFixed(1)}%)`,
          }}
        />
      </div>
    </div>
  );
}
