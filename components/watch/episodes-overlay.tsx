"use client";

import { useEffect, useSyncExternalStore } from "react";
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
import type { PlayerEpisode } from "./player";

// Episode picker over the player. Rendered via portal to document.body so
// it lives OUTSIDE the <media-controller> tree — media-chrome's controller
// treats clicks inside its subtree as media gestures (play/pause toggle),
// which was preventing the close + select buttons from firing reliably.
export function EpisodesOverlay({
  episodes,
  currentEpisodeId,
  showSlug,
  onSelect,
  onClose,
}: {
  episodes: PlayerEpisode[];
  currentEpisodeId: string;
  showSlug: string;
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
      role="dialog"
      aria-modal="true"
      aria-label={t.episodesOverlay.title}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-2xl"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-4xl flex-col px-5 sm:px-8"
      >
        <header className="flex items-center justify-between pb-4 pt-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
              {t.episodesOverlay.title}
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-white sm:text-2xl">
              {t.episodesOverlay.count(episodes.length)}
            </h2>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label={t.episodesOverlay.closeAria}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="scrollbar-hidden flex-1 overflow-y-auto pb-6">
          {seasonNumbers.map((sn) => {
            const eps = seasonMap.get(sn)!;
            return (
              <section key={sn} className="mb-6">
                <h3 className="mb-3 text-sm font-bold text-white/85">
                  {t.episodesOverlay.season(sn)}
                </h3>
                <ul className="space-y-2">
                  {eps.map((ep) => {
                    const isCurrent = ep.id === currentEpisodeId;
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
                          className={`group flex w-full items-start gap-4 rounded-lg p-2.5 text-left transition-colors ${
                            isCurrent
                              ? "bg-white/[0.08] ring-1 ring-[#ff3d3d]/60"
                              : "hover:bg-white/[0.04]"
                          }`}
                        >
                          <div
                            className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md sm:w-40"
                            style={
                              ep.thumbnailUrl
                                ? undefined
                                : { backgroundImage: TONE_GRADIENT[tone] }
                            }
                          >
                            {ep.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={ep.thumbnailUrl}
                                alt=""
                                aria-hidden
                                loading="lazy"
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                            ) : (
                              <div
                                className="absolute inset-0 opacity-30"
                                aria-hidden
                                style={{
                                  backgroundImage:
                                    "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.25), transparent 60%)",
                                }}
                              />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur-md">
                                <Icon
                                  name={isCurrent ? "pause" : "play"}
                                  size={12}
                                  color="#ffffff"
                                />
                              </div>
                            </div>
                            {isCurrent ? (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#ff3d3d]" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <h4
                                className={`text-sm font-semibold sm:text-base ${
                                  isCurrent ? "text-white" : "text-white/90"
                                }`}
                              >
                                {ep.number}. {ep.title}
                              </h4>
                              <span className="shrink-0 font-mono text-[11px] text-white/55">
                                {minutes ? t.episodesOverlay.minutes(minutes) : ""}
                              </span>
                            </div>
                            {ep.description ? (
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/60">
                                {ep.description}
                              </p>
                            ) : null}
                            {isCurrent ? (
                              <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#ff3d3d]">
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
