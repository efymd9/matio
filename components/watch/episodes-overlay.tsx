"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// SSR-safe "are we on the client" flag without setState-in-effect.
// Server snapshot returns false; client snapshot returns true. No subscription
// — the value never changes after hydration.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
import { TONE_GRADIENT, toneFor } from "@/lib/design";
import { Icon } from "@/components/site/icon";
import { useT } from "@/lib/i18n/client";
import { isEpisodeLocked, type Mode, type PlayerEpisode } from "./player";

// Episode picker over the player. Rendered via portal to document.body so
// it lives OUTSIDE the <media-controller> tree — media-chrome's controller
// treats clicks inside its subtree as media gestures (play/pause toggle),
// which was preventing the close + select buttons from firing reliably.
export function EpisodesOverlay({
  episodes,
  currentEpisodeId,
  showSlug,
  mode,
  onSelect,
  onClose,
}: {
  episodes: PlayerEpisode[];
  currentEpisodeId: string;
  showSlug: string;
  mode: Mode;
  onSelect: (episodeId: string) => void;
  onClose: () => void;
}) {
  // Portals need a browser-mounted target; useSyncExternalStore returns false
  // during SSR and true once we're hydrated, so we render null on the server.
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const t = useT();

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const trapFocus = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const seasonMap = new Map<number, PlayerEpisode[]>();
  for (const ep of episodes) {
    const list = seasonMap.get(ep.seasonNumber) ?? [];
    list.push(ep);
    seasonMap.set(ep.seasonNumber, list);
  }
  const seasonNumbers = [...seasonMap.keys()].sort((a, b) => a - b);
  const tone = toneFor(showSlug);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.episodesOverlay.title}
      onClick={onClose}
      onKeyDown={trapFocus}
      className="fixed inset-0 z-[100] flex flex-col bg-espresso/90 backdrop-blur-2xl"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-4xl flex-col px-5 pt-[max(env(safe-area-inset-top),0px)] sm:px-8"
      >
        <header className="flex items-center justify-between pb-4 pt-5">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
              <span className="inline-block h-0.5 w-3.5 rounded-[1px] bg-rust" />
              <span>{t.episodesOverlay.title}</span>
            </div>
            <h2 className="mt-1.5 font-display text-2xl uppercase tracking-[0.02em] text-cream sm:text-3xl">
              {t.episodesOverlay.count(episodes.length)}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label={t.episodesOverlay.closeAria}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-cream/10 text-cream transition-colors hover:bg-cream/20"
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="scrollbar-hidden flex-1 overflow-y-auto pb-6">
          {seasonNumbers.map((sn) => {
            const eps = seasonMap.get(sn)!;
            return (
              <section key={sn} className="mb-6">
                <h3 className="mb-3 font-display text-sm uppercase tracking-[0.03em] text-gold">
                  {t.episodesOverlay.season(sn)}
                </h3>
                <ul className="space-y-2">
                  {eps.map((ep) => {
                    const isCurrent = ep.id === currentEpisodeId;
                    const locked = isEpisodeLocked(ep.tier, mode);
                    const minutes = ep.durationSeconds
                      ? Math.floor(ep.durationSeconds / 60)
                      : null;
                    return (
                      <li key={ep.id}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(ep.id);
                          }}
                          className={`group flex w-full items-start gap-4 rounded-2xl border bg-espresso-2 p-2.5 text-left transition-colors ${
                            isCurrent
                              ? "border-gold/40 ring-1 ring-gold/60"
                              : "border-rust/30 hover:border-rust/50"
                          }`}
                        >
                          <div
                            className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-[14px] sm:w-40"
                            style={
                              ep.thumbnailUrl
                                ? undefined
                                : { backgroundImage: TONE_GRADIENT[tone] }
                            }
                          >
                            {ep.thumbnailUrl ? (
                              <Image
                                src={ep.thumbnailUrl}
                                alt=""
                                aria-hidden
                                fill
                                sizes="(max-width: 640px) 128px, 160px"
                                className="object-cover"
                              />
                            ) : (
                              <div
                                className="absolute inset-0 opacity-30"
                                aria-hidden
                                style={{
                                  backgroundImage:
                                    "radial-gradient(circle at 50% 50%, rgba(230,179,102,0.25), transparent 60%)",
                                }}
                              />
                            )}
                            <div
                              aria-hidden
                              className="duotone pointer-events-none absolute inset-0"
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-burgundy/80 text-cream backdrop-blur-md">
                                <Icon
                                  name={
                                    locked
                                      ? "lock"
                                      : isCurrent
                                        ? "pause"
                                        : "play"
                                  }
                                  size={12}
                                  color="#f6efe4"
                                />
                              </div>
                            </div>
                            {isCurrent ? (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gold" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <h4
                                className={`text-sm font-semibold sm:text-base ${
                                  isCurrent ? "text-cream" : "text-cream/90"
                                }`}
                              >
                                {ep.number}. {ep.title}
                              </h4>
                              <span className="shrink-0 font-mono text-[11px] text-cream/55">
                                {locked ? (
                                  <span
                                    aria-label={t.episodesOverlay.lockedAria}
                                    className="inline-flex items-center gap-1 rounded-full bg-burgundy px-2 py-0.5 text-[10px] font-semibold text-cream"
                                  >
                                    <Icon name="lock" size={10} />
                                    {ep.tier === "member"
                                      ? t.episodesOverlay.lockedSignup
                                      : t.episodesOverlay.lockedSubscribe}
                                  </span>
                                ) : minutes ? (
                                  t.episodesOverlay.minutes(minutes)
                                ) : (
                                  ""
                                )}
                              </span>
                            </div>
                            {ep.description ? (
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-cream/60">
                                {ep.description}
                              </p>
                            ) : null}
                            {isCurrent ? (
                              <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-gold">
                                {t.episodesOverlay.nowPlaying}
                              </p>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
