"use client";

import MuxPlayer from "@mux/mux-player-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function HeroBanner({
  title,
  description,
  genre,
  slug,
  heroImageUrl,
  posterImageUrl,
  previewPlaybackId,
}: {
  title: string;
  description: string | null;
  genre: string[];
  slug: string;
  heroImageUrl: string | null;
  posterImageUrl: string | null;
  previewPlaybackId: string | null;
}) {
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const backdrop = heroImageUrl ?? posterImageUrl;

  return (
    <section className="relative isolate min-h-[640px] w-full overflow-hidden bg-background pt-16 sm:h-[92vh]">
      {/* Static backdrop — image OR gradient placeholder */}
      {backdrop ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={backdrop}
          alt=""
          aria-hidden
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-1000",
            videoPlaying ? "opacity-0" : "opacity-100",
          )}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-muted via-card to-background" />
      )}

      {/* Auto-playing muted preview, swaps in once it starts. We use the
          playback id without a token — Mux rejects signed JWTs aimed at
          public playback ids. If the asset has signed policy and won't
          play here, we just stay on the backdrop image. */}
      {previewPlaybackId && !videoFailed && (
        <MuxPlayer
          playbackId={previewPlaybackId}
          autoPlay="muted"
          loop
          muted
          playsInline
          preload="auto"
          nohotkeys
          streamType="on-demand"
          className="hero-preview"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            "--media-object-fit": "cover",
            "--media-object-position": "center",
          }}
          onPlaying={() => setVideoPlaying(true)}
          onError={() => setVideoFailed(true)}
        />
      )}

      {/* Atmospheric overlays */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-3/4 bg-gradient-to-r from-background via-background/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/40 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex h-full min-h-[600px] flex-col justify-end px-6 pb-16 pt-24 sm:px-12 sm:pb-24 sm:pt-32 lg:pb-32">
        <div className="max-w-2xl space-y-5">
          {genre.length > 0 && (
            <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-accent">
              {genre.slice(0, 3).join("  ·  ")}
            </p>
          )}
          <h1 className="font-display text-6xl italic leading-[0.92] tracking-tight text-foreground sm:text-7xl lg:text-[112px]">
            {title}
          </h1>
          {description && (
            <p className="max-w-xl text-base leading-relaxed text-foreground/80 sm:text-lg">
              {description}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-3">
            <Link
              href={`/watch/${slug}`}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-7 text-sm font-medium text-background transition-all duration-300 hover:bg-accent hover:text-accent-foreground"
            >
              <PlayGlyph />
              Play
            </Link>
            <Link
              href={`/shows/${slug}`}
              className="inline-flex h-12 items-center rounded-full border border-foreground/30 bg-background/20 px-7 text-sm font-medium text-foreground backdrop-blur-md transition-all duration-300 hover:border-foreground/50 hover:bg-background/40"
            >
              More info
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlayGlyph() {
  return (
    <svg
      width="11"
      height="13"
      viewBox="0 0 11 13"
      fill="currentColor"
      aria-hidden
    >
      <path d="M0 0L11 6.5L0 13V0Z" />
    </svg>
  );
}
