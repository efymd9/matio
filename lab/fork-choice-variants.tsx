import type { ReactNode } from "react";

import { Icon } from "@/components/site/icon";
import {
  forkTag,
  forkTiming,
  type ForkChoiceProps,
} from "@/components/watch/fork-choice-overlay";
import { GOLD_GLOW, TONE_GRADIENT } from "@/lib/design";
import { useT } from "@/lib/i18n/client";

// Lab-first alternatives for the fork prompt (#144). The product ships
// variant A (components/watch/fork-choice-overlay.tsx); B–E live ONLY here,
// so the owner can look at all five live on a device and swap one in with a
// single decision — the props are identical, the port is copying the
// markup into the product component. Nothing here reaches the app bundle:
// lab/ is a Storybook glob, not a Next import.
//
// Every variant reads the same clock (`remainingSeconds` / `windowSeconds`)
// and the same pick (`chosenId`); what differs is layout, typography, how
// the countdown is drawn, and how the default announces itself.

type VariantProps = Omit<ForkChoiceProps, "inline">;

// A stand-in for the player's last frame: a 16:9 (or 9:16) box with a tone
// gradient and the duotone treatment, so a variant is judged over a
// picture-like backdrop rather than flat espresso. Stories mount variants
// inline inside it.
export function PlayerFrame({
  children,
  portrait = false,
  width = 640,
}: {
  children: ReactNode;
  portrait?: boolean;
  width?: number;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-espresso-2 ${
        portrait ? "aspect-[9/16]" : "aspect-video"
      }`}
      style={{ width, maxWidth: "100%", backgroundImage: TONE_GRADIENT.c }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{ backgroundImage: GOLD_GLOW }}
      />
      <div aria-hidden className="duotone pointer-events-none absolute inset-0" />
      {children}
    </div>
  );
}

// B — "Cards": a centred sheet over a dimmed frame, the prompt as a big
// display headline, one thumbnail card per option (tone gradient, play
// glyph, label below). The countdown is a gold bar under the ARMED card's
// thumbnail, shrinking right-to-left; the default carries an "Auto" tag.
// Cinematic and unmistakable; covers most of the picture.
export function ForkChoiceCards({
  prompt,
  options,
  chosenId,
  remainingSeconds,
  windowSeconds,
  onChoose,
}: VariantProps) {
  const t = useT();
  const { seconds, remainingPct } = forkTiming(remainingSeconds, windowSeconds);
  return (
    <div
      role="group"
      aria-label={t.forkOverlay.label}
      className="@container absolute inset-0 flex items-center justify-center bg-espresso/55 p-5 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {t.forkOverlay.label}
        </p>
        <h3 className="mt-2 font-display text-3xl uppercase leading-none tracking-[0.02em] text-cream @xl:text-5xl">
          {prompt}
        </h3>
        <div
          className="mt-5 grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
          }}
        >
          {options.map((o, i) => {
            const chosen = chosenId === o.episodeId;
            const armed = chosenId === null && o.isDefault;
            const tag = forkTag(o, chosenId, t.forkOverlay);
            const tone = (["a", "d", "e"] as const)[i % 3];
            return (
              <button
                key={o.episodeId}
                type="button"
                aria-pressed={chosen}
                onClick={(e) => {
                  e.stopPropagation();
                  onChoose(o.episodeId);
                }}
                className={`rounded-2xl border bg-espresso-2 p-2.5 text-left transition-colors ${
                  chosen
                    ? "border-gold ring-1 ring-gold/60"
                    : armed
                      ? "border-gold/40"
                      : "border-rust/30 hover:border-rust/50"
                }`}
              >
                <div
                  className="relative aspect-video overflow-hidden rounded-[14px]"
                  style={{ backgroundImage: TONE_GRADIENT[tone] }}
                >
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-30"
                    style={{ backgroundImage: GOLD_GLOW }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-burgundy/80 text-cream backdrop-blur-md">
                      <Icon name={chosen ? "check" : "play"} size={14} />
                    </span>
                  </div>
                  {armed ? (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-cream/15">
                      <div
                        className="h-full bg-gold transition-[width] duration-1000 ease-linear"
                        style={{ width: `${remainingPct}%` }}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-cream">
                    {o.label}
                  </p>
                  {tag ? (
                    <span className="shrink-0 rounded-full bg-cream/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-cream/80">
                      {tag}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
        <p
          className="mt-3 font-mono text-[11px] tabular-nums text-cream/55"
          aria-live="polite"
        >
          {t.forkOverlay.autoIn(seconds)}
        </p>
      </div>
    </div>
  );
}

// Stroke ring for the corner sheet's armed radio — the countdown as an
// arc that empties clockwise.
function Ring({ remainingPct }: { remainingPct: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="absolute inset-0 h-6 w-6 -rotate-90 text-gold"
    >
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - remainingPct / 100)}
        className="transition-[stroke-dashoffset] duration-1000 ease-linear"
      />
    </svg>
  );
}

// C — "Sheet": the up-next card's twin. A compact corner sheet
// (bottom-right, espresso-2, rust border) with the prompt as a bold line
// and the options as radio rows; the armed row's radio wears a countdown
// ring and the seconds sit at its right edge. Leaves the picture almost
// entirely visible; reads as part of the existing player language.
export function ForkChoiceSheet({
  prompt,
  options,
  chosenId,
  remainingSeconds,
  windowSeconds,
  onChoose,
}: VariantProps) {
  const t = useT();
  const { seconds, remainingPct } = forkTiming(remainingSeconds, windowSeconds);
  return (
    <div
      role="group"
      aria-label={t.forkOverlay.label}
      className="@container pointer-events-none absolute inset-0 flex items-end justify-end p-5 @xl:p-8"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-rust/30 bg-espresso-2/95 p-4 shadow-sheet backdrop-blur-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {t.forkOverlay.label}
        </p>
        <h3 className="mt-1 text-base font-bold text-cream">{prompt}</h3>
        <ul className="mt-3 space-y-2">
          {options.map((o) => {
            const chosen = chosenId === o.episodeId;
            const armed = chosenId === null && o.isDefault;
            return (
              <li key={o.episodeId}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChoose(o.episodeId);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    chosen
                      ? "border-gold/60 bg-gold/10"
                      : "border-cream/10 hover:bg-cream/5"
                  }`}
                >
                  <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                    {armed ? <Ring remainingPct={remainingPct} /> : null}
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        chosen ? "bg-gold" : "bg-cream/30"
                      }`}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-cream">
                    {o.label}
                  </span>
                  {armed ? (
                    <span className="font-mono text-xs tabular-nums text-gold">
                      {seconds}
                    </span>
                  ) : chosen ? (
                    <Icon name="check" size={14} className="text-gold" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// D — "Strip": a subtitle. One centred line at the bottom — the prompt in
// a translucent pill, the options as underlined text separated by gold
// dots, the default underlined in gold. The countdown is a hairline that
// shrinks under the strip; the digits appear only in the last three
// seconds. The least intrusive of the five, typography-led, no thumbnails.
export function ForkChoiceStrip({
  prompt,
  options,
  chosenId,
  remainingSeconds,
  windowSeconds,
  onChoose,
}: VariantProps) {
  const t = useT();
  const { seconds, remainingPct } = forkTiming(remainingSeconds, windowSeconds);
  return (
    <div
      role="group"
      aria-label={t.forkOverlay.label}
      className="@container pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-5 pb-8"
    >
      <p className="pointer-events-auto max-w-3xl rounded-full bg-black/55 px-5 py-2 text-center text-sm font-semibold text-cream backdrop-blur-xl @xl:text-base">
        {prompt}
      </p>
      <p className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base @xl:text-lg">
        {options.map((o, i) => {
          const chosen = chosenId === o.episodeId;
          const armed = chosenId === null && o.isDefault;
          return (
            <span key={o.episodeId} className="contents">
              {i > 0 ? (
                <span aria-hidden className="text-gold/70">
                  ·
                </span>
              ) : null}
              <button
                type="button"
                aria-pressed={chosen}
                onClick={(e) => {
                  e.stopPropagation();
                  onChoose(o.episodeId);
                }}
                className={`font-bold underline decoration-2 underline-offset-[6px] transition-colors ${
                  chosen
                    ? "text-gold decoration-gold"
                    : armed
                      ? "text-cream decoration-gold/70"
                      : "text-cream/85 decoration-cream/30 hover:text-cream"
                }`}
              >
                {o.label}
              </button>
            </span>
          );
        })}
      </p>
      <div className="h-px w-full max-w-md bg-cream/15">
        <div
          className="h-full bg-gold transition-[width] duration-1000 ease-linear"
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      {seconds <= 3 ? (
        <p className="font-mono text-[11px] tabular-nums text-cream/65">
          {t.forkOverlay.autoIn(seconds)}
        </p>
      ) : null}
    </div>
  );
}

// E — "Halves": the whole frame becomes the control. One full-height zone
// per option, the label huge in the display face, the armed zone lit gold
// from within; the prompt hangs as a pill at the top and the countdown is
// a bar across the top edge. Bandersnatch-like, impossible to miss a tap;
// the boldest of the five.
export function ForkChoiceHalves({
  prompt,
  options,
  chosenId,
  remainingSeconds,
  windowSeconds,
  onChoose,
}: VariantProps) {
  const t = useT();
  const { remainingPct } = forkTiming(remainingSeconds, windowSeconds);
  return (
    <div
      role="group"
      aria-label={t.forkOverlay.label}
      className="@container absolute inset-0 grid"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((o) => {
        const chosen = chosenId === o.episodeId;
        const armed = chosenId === null && o.isDefault;
        const tag = forkTag(o, chosenId, t.forkOverlay);
        return (
          <button
            key={o.episodeId}
            type="button"
            aria-pressed={chosen}
            onClick={(e) => {
              e.stopPropagation();
              onChoose(o.episodeId);
            }}
            className={`relative flex flex-col items-center justify-center gap-3 border-r border-cream/10 px-4 transition-colors last:border-r-0 ${
              chosen
                ? "bg-gold/25"
                : armed
                  ? "bg-gold/10 hover:bg-gold/15"
                  : "bg-black/20 hover:bg-black/35"
            }`}
          >
            <span
              className={`text-center font-display text-3xl uppercase leading-none tracking-[0.02em] @xl:text-5xl ${
                chosen || armed ? "text-gold" : "text-cream/90"
              }`}
            >
              {o.label}
            </span>
            {tag ? (
              <span className="rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-cream/80 backdrop-blur-xl">
                {tag}
              </span>
            ) : null}
          </button>
        );
      })}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-cream/15"
      >
        <div
          className="h-full bg-gold transition-[width] duration-1000 ease-linear"
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      <p className="pointer-events-none absolute left-1/2 top-4 max-w-[80%] -translate-x-1/2 truncate rounded-full bg-black/55 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-gold backdrop-blur-xl">
        {prompt}
      </p>
    </div>
  );
}
