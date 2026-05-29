"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { TONE_GRADIENT, toneFor } from "@/lib/design";
import { useT } from "@/lib/i18n/client";
import { useMarketingConsent } from "@/lib/use-marketing-consent";
import { Icon } from "./icon";

// Public Mux Data env key. Empty when unset → Mux Data stays fully off.
const MUX_DATA_ENV_KEY = process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY ?? "";

// Lazy-load the Mux player to keep ~350KB of player+media-chrome+hls out
// of the home-page initial JS chunk. The backdrop <Image> becomes LCP;
// the autoplay preview fades in once the dynamic import resolves after
// hydration.
const MuxPlayer = dynamic(() => import("@mux/mux-player-react"), {
  ssr: false,
});

// Cinema-style hero. Layered:
//   1. backdrop image OR tone gradient
//   2. autoplaying muted Mux preview (fades in on first frame)
//   3. radial accent + vignette
//   4. bottom-to-top scrim that fades into the page background
//   5. content column with MATIO ORIGINAL kicker, title, meta, CTAs
export function HeroBanner({
  title,
  description,
  genre,
  slug,
  heroImageUrl,
  posterImageUrl,
  previewPlaybackId,
  previewToken,
}: {
  title: string;
  description: string | null;
  genre: string[];
  slug: string;
  heroImageUrl: string | null;
  posterImageUrl: string | null;
  previewPlaybackId: string | null;
  previewToken: string | null;
}) {
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const backdrop = heroImageUrl ?? posterImageUrl;
  const tone = toneFor(slug);
  const t = useT();
  // The hero autoplays on every home visit (pre-consent), so Mux Data here must
  // be gated: no env key / no consent → disableTracking + disableCookies, no
  // beacons. MuxPlayer is dynamic(ssr:false) so the consent value is settled
  // before it mounts.
  const muxDataEnabled = useMarketingConsent() && !!MUX_DATA_ENV_KEY;

  return (
    <section className="relative isolate min-h-[640px] w-full overflow-hidden bg-background sm:h-[90vh]">
      {/* Static backdrop: image or tone gradient placeholder */}
      {backdrop ? (
        <Image
          src={backdrop}
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className={cn(
            "object-cover transition-opacity duration-1000",
            videoPlaying ? "opacity-0" : "opacity-100",
          )}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ backgroundImage: TONE_GRADIENT[tone] }}
        />
      )}

      {previewPlaybackId && !videoFailed && (
        <MuxPlayer
          playbackId={previewPlaybackId}
          tokens={previewToken ? { playback: previewToken } : undefined}
          autoPlay="muted"
          loop
          muted
          playsInline
          preload="auto"
          nohotkeys
          streamType="on-demand"
          envKey={muxDataEnabled ? MUX_DATA_ENV_KEY : undefined}
          disableTracking={!muxDataEnabled}
          disableCookies={!muxDataEnabled}
          metadata={{
            video_id: slug,
            video_title: title,
            // Distinguish autoplay hero views from real episode watch-time.
            player_name: "matio-hero",
          }}
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

      {/* Atmospheric overlays — radial accent + cinema scrims. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 65% 35%, rgba(255,61,61,0.18), transparent 55%), radial-gradient(circle at 25% 80%, rgba(255,255,255,0.10), transparent 50%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-3/5 bg-gradient-to-r from-background/85 via-background/40 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex h-full min-h-[600px] flex-col justify-end px-6 pb-16 pt-28 sm:px-12 sm:pb-24">
        <div className="max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
            <Icon name="star" size={11} />
            <span>{t.hero.matioOriginal}</span>
          </div>
          <h1 className="text-5xl font-extrabold leading-[0.95] tracking-[-0.02em] text-white sm:text-6xl lg:text-7xl">
            {title}
          </h1>
          {genre.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/70">
              {genre.slice(0, 3).map((g, i) => (
                <span key={g} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden className="text-white/35">·</span>}
                  <span className="capitalize">{g}</span>
                </span>
              ))}
            </div>
          )}
          {description && (
            <p className="max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
              {description}
            </p>
          )}
          <div className="flex flex-wrap gap-2.5 pt-3">
            <Link
              href={`/watch/${slug}`}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-7 text-sm font-bold text-black transition-all duration-300 hover:bg-white/90"
            >
              <Icon name="play" size={16} color="#0a0a0c" />
              {t.hero.play}
            </Link>
            <Link
              href={`/shows/${slug}`}
              className="inline-flex h-11 items-center gap-2 rounded-md border border-white/15 bg-white/15 px-7 text-sm font-semibold text-white backdrop-blur-xl transition-colors hover:bg-white/25"
            >
              <Icon name="info" size={16} />
              {t.hero.moreInfo}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
