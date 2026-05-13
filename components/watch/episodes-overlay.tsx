"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TONE_GRADIENT, toneFor } from "@/lib/design";
import { Icon } from "@/components/site/icon";
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
  // Portals need a browser-mounted target; gate the render on a client-side
  // mount flag so SSR doesn't try to portal into a non-existent body.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
      aria-label="Episodes"
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
              Episodes
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-white sm:text-2xl">
              {episodes.length} episode{episodes.length === 1 ? "" : "s"}
            </h2>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close"
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
                  Season {sn}
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
                            style={{ backgroundImage: TONE_GRADIENT[tone] }}
                          >
                            <div
                              className="absolute inset-0 opacity-30"
                              aria-hidden
                              style={{
                                backgroundImage:
                                  "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.25), transparent 60%)",
                              }}
                            />
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
                                {minutes ? `${minutes} min` : ""}
                              </span>
                            </div>
                            {ep.description ? (
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/60">
                                {ep.description}
                              </p>
                            ) : null}
                            {isCurrent ? (
                              <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#ff3d3d]">
                                Now playing
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
