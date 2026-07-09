"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState } from "react";

// One cast member on the show page: a circular avatar + name that links to
// the actor's profile page, with a hover card carrying the tagline / bio /
// character credit. Hover (or keyboard focus) opens the card on pointer
// devices; on touch there is no hover, so a tap simply navigates to the
// profile page — the card is a desktop affordance, not the only path to the
// detail. All labels arrive pre-localized (dict functions can't cross the
// RSC boundary).
export function ActorChip({
  href,
  name,
  characterLabel,
  tagline,
  bio,
  avatarUrl,
  viewProfileLabel,
}: {
  href: string;
  name: string;
  characterLabel: string | null;
  tagline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  viewProfileLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // Horizontal correction keeping the card on-screen for chips near the
  // viewport edges (the card is wider than the chip and centered on it).
  const [shift, setShift] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    let dx = 0;
    if (rect.left < margin) dx = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) {
      dx = window.innerWidth - margin - rect.right;
    }
    // Accumulate: the measurement already includes any previous shift, so
    // this converges in one pass and stays correct across re-opens.
    if (dx !== 0) setShift((s) => s + dx);
  }, [open]);

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link
        href={href}
        aria-describedby={open ? cardId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="group flex w-[84px] flex-col items-center gap-2 text-center tablet:w-[96px]"
      >
        <span className="relative block size-16 overflow-hidden rounded-full border border-rust/40 bg-espresso-2 transition-[border-color,transform] duration-150 group-hover:scale-105 group-hover:border-gold/70 group-focus-visible:border-gold/70 tablet:size-20">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              aria-hidden
              fill
              sizes="80px"
              className="object-cover"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center font-display text-xl text-cream/30">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-bold leading-tight text-cream group-hover:text-gold">
            {name}
          </span>
          {characterLabel ? (
            <span className="text-[10px] leading-tight text-cream/50">
              {characterLabel}
            </span>
          ) : null}
        </span>
      </Link>

      {open ? (
        <div
          ref={cardRef}
          id={cardId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 w-64 rounded-2xl border border-rust/30 bg-espresso-2 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
          style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
        >
          <div className="flex items-center gap-3">
            <span className="relative block size-11 shrink-0 overflow-hidden rounded-full border border-rust/40 bg-black/40">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  aria-hidden
                  fill
                  sizes="44px"
                  className="object-cover"
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center font-display text-base text-cream/30">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight text-cream">
                {name}
              </p>
              {tagline ? (
                <p className="mt-0.5 text-[11px] leading-snug text-gold/90">
                  {tagline}
                </p>
              ) : null}
            </div>
          </div>
          {characterLabel ? (
            <p className="mt-2.5 text-[11px] font-semibold text-cream/55">
              {characterLabel}
            </p>
          ) : null}
          {bio ? (
            <p className="mt-1.5 line-clamp-4 text-xs leading-normal text-cream/70">
              {bio}
            </p>
          ) : null}
          <p className="mt-2.5 text-[11px] font-bold text-gold">
            {viewProfileLabel}
          </p>
        </div>
      ) : null}
    </div>
  );
}
