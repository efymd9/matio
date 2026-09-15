"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";

// SSR-safe "are we on the client" flag without setState-in-effect — same
// idiom as the other portal'd overlays in this folder.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

// One option of the fork prompt. `label` is already in the site locale
// (the watch page picks label_es / label_en); the component adds only its
// own chrome copy (kicker, tags, countdown) from the dictionary.
export type ForkChoiceOption = {
  episodeId: string;
  label: string;
  isDefault: boolean;
};

export type ForkChoiceProps = {
  prompt: string;
  options: ForkChoiceOption[];
  // The viewer's pick so far — null means nothing tapped yet, so the
  // default plays when the clock runs out. The last tap before the end
  // wins; changing one's mind inside the window is allowed.
  chosenId: string | null;
  // Seconds of the parent episode still to play. The countdown IS the
  // video's own clock (a pause pauses it): the prompt opens
  // `windowSeconds` before the end and the transition happens at `ended`,
  // through the same gapless path as auto-advance — the overlay never
  // owns a timer of its own.
  remainingSeconds: number;
  windowSeconds: number;
  onChoose: (episodeId: string) => void;
  // Lab only: render in place (absolute, inside a frame) instead of the
  // body portal (fixed, over the player) the product uses.
  inline?: boolean;
};

// Countdown arithmetic shared by the product overlay and the Lab variants.
export function forkTiming(remainingSeconds: number, windowSeconds: number) {
  const seconds = Math.max(0, Math.ceil(remainingSeconds));
  const fraction =
    windowSeconds > 0
      ? Math.min(1, Math.max(0, remainingSeconds / windowSeconds))
      : 0;
  return {
    seconds,
    // Share of the window already gone (grows) / still left (shrinks).
    elapsedPct: (1 - fraction) * 100,
    remainingPct: fraction * 100,
  };
}

// Which tag an option shows: "Chosen" on the pick, "Auto" on the default
// while nothing is picked, none otherwise.
export function forkTag(
  option: ForkChoiceOption,
  chosenId: string | null,
  labels: { autoTag: string; chosenTag: string },
): string | null {
  if (chosenId === option.episodeId) return labels.chosenTag;
  if (chosenId === null && option.isDefault) return labels.autoTag;
  return null;
}

// The fork prompt — Lab-first variant A, "the bar" (chosen by the agent as
// the default; the four alternatives live in lab/fork-choice-variants.tsx
// and the owner can swap one in with a single decision). A bottom band
// over the last seconds of the parent: kicker + prompt in the display
// face, one pill per option, and the countdown embedded in the option that
// will play if nothing is tapped — its gold fill grows left to right as the
// window runs out, so the viewer reads both the deadline and the default
// from one element. A tap turns the pill solid gold.
//
// Portaled to document.body like every overlay here: media-chrome treats a
// click anywhere inside its subtree as a play/pause gesture
// (episodes-overlay.tsx), so the buttons must live outside it. The root is
// pointer-events-none — taps beside the pills still reach the player.
export function ForkChoiceOverlay({
  prompt,
  options,
  chosenId,
  remainingSeconds,
  windowSeconds,
  onChoose,
  inline = false,
}: ForkChoiceProps) {
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const t = useT();
  const defaultRef = useRef<HTMLButtonElement>(null);

  // Focus lands on the default when the prompt opens: Enter/Space confirm
  // it, Tab reaches the alternatives — a keyboard viewer is never stuck
  // with a countdown they cannot answer.
  useEffect(() => {
    defaultRef.current?.focus({ preventScroll: true });
  }, []);

  const { seconds, elapsedPct } = forkTiming(remainingSeconds, windowSeconds);

  const content = (
    <div
      role="group"
      aria-label={t.forkOverlay.label}
      // `@container`: the row/stack and type-size switches below key on the
      // overlay's OWN width (the viewport in the product, the frame in the
      // Lab), so a Lab story in a phone-sized frame shows the phone layout.
      className={`${inline ? "absolute" : "fixed"} @container inset-x-0 bottom-0 z-[100] pointer-events-none bg-gradient-to-t from-black/85 via-black/45 to-transparent px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-16 @xl:px-8 @xl:pb-[max(env(safe-area-inset-bottom),2rem)]`}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 @xl:gap-4">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
              {t.forkOverlay.label}
            </p>
            <p className="mt-1 font-display text-2xl uppercase leading-none tracking-[0.02em] text-cream @xl:text-4xl">
              {prompt}
            </p>
          </div>
          {/* Announced only in the last three seconds: focus lands on the
              default when the prompt opens (the screen reader reads it
              then), and a per-second live region would narrate a 30s window
              ("Auto in 9s… 8s…"). */}
          <p
            className="shrink-0 font-mono text-xs font-semibold tabular-nums text-cream/65"
            aria-live={seconds <= 3 ? "polite" : "off"}
            aria-atomic="true"
          >
            {t.forkOverlay.autoIn(seconds)}
          </p>
        </div>

        <div
          data-testid="fork-options"
          className="pointer-events-auto flex flex-col gap-2 @xl:flex-row @xl:gap-3"
        >
          {options.map((o) => {
            const chosen = chosenId === o.episodeId;
            // The pill that plays if the clock runs out: the pick, else the
            // default. Only an UNPICKED default carries the growing fill.
            const armed = chosenId === null && o.isDefault;
            const tag = forkTag(o, chosenId, t.forkOverlay);
            return (
              <button
                key={o.episodeId}
                ref={o.isDefault ? defaultRef : undefined}
                type="button"
                aria-pressed={chosen}
                onClick={(e) => {
                  e.stopPropagation();
                  onChoose(o.episodeId);
                }}
                className={`relative flex h-14 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full border text-sm font-extrabold backdrop-blur-xl transition-[transform,background-color,border-color] hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60 active:scale-[0.98] @xl:h-16 @xl:text-base ${
                  chosen
                    ? "border-gold bg-gold text-gold-deep shadow-cta"
                    : armed
                      ? "border-gold/60 bg-black/55 text-cream"
                      : "border-cream/25 bg-black/55 text-cream hover:bg-cream/10"
                }`}
              >
                {armed ? (
                  <span
                    aria-hidden
                    data-testid="fork-fill"
                    className="absolute inset-y-0 left-0 bg-gold/30 transition-[width] duration-300 ease-linear"
                    style={{ width: `${elapsedPct}%` }}
                  />
                ) : null}
                <span className="relative z-[1] min-w-0 truncate px-4">
                  {o.label}
                </span>
                {tag ? (
                  <span
                    className={`relative z-[1] mr-4 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
                      chosen
                        ? "bg-gold-deep/15 text-gold-deep"
                        : "bg-cream/15 text-cream/80"
                    }`}
                  >
                    {tag}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (inline) return content;
  if (!mounted) return null;
  return createPortal(content, document.body);
}
