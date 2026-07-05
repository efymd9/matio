"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { TONE_GRADIENT, toneFor } from "@/lib/design";
import { useT } from "@/lib/i18n/client";
import { useMarketingConsent } from "@/lib/use-marketing-consent";
import { Icon } from "./icon";
import { MetaDot } from "./meta-dot";

// Public Mux Data env key. Empty when unset → Mux Data stays fully off.
const MUX_DATA_ENV_KEY = process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY ?? "";

// Lazy-load the Mux player to keep ~350KB of player+media-chrome+hls out
// of the home-page initial JS chunk. The backdrop <Image> becomes LCP;
// the autoplay preview fades in once the dynamic import resolves after
// hydration.
const MuxPlayer = dynamic(() => import("@mux/mux-player-react"), {
  ssr: false,
});

// Cinema-style hero (gold-duotone redesign). Layers bottom-up:
//   1. backdrop image OR tone gradient
//   2. autoplaying muted Mux preview (fades in on first frame)
//   3. duotone-strong overlay
//   4. scrims: bottom fade + (tablet/desktop) left column + (mobile/tablet)
//      burgundy floor glow
//   5. content column — premiere badge, Anton title, meta, CTAs
export function HeroBanner({
  title,
  description,
  genre,
  slug,
  heroImageUrl,
  posterImageUrl,
  previewPlaybackId,
  previewToken,
  episodeCount,
  year,
  paymentsOn,
}: {
  title: string;
  description: string | null;
  genre: string[];
  slug: string;
  heroImageUrl: string | null;
  posterImageUrl: string | null;
  previewPlaybackId: string | null;
  previewToken: string | null;
  episodeCount: number;
  year: number;
  // Payments kill-switch (server-read, prop-drilled): the CTA must not
  // promise "Watch free" while a paid gate is live.
  paymentsOn: boolean;
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

  // Meta row: genre · N episodes · 16+ (· year on tablet/desktop). Each entry
  // flags whether it's hidden below the tablet breakpoint; only the genre
  // gets title-cased (DB genres are lowercase).
  const meta: Array<{ label: string; tabletUp?: boolean; capitalize?: boolean }> =
    [];
  if (genre[0]) meta.push({ label: genre[0], capitalize: true });
  if (episodeCount > 0) {
    meta.push({ label: t.showDetail.episodeCount(episodeCount) });
  }
  meta.push({ label: t.showDetail.ageRating });
  meta.push({ label: String(year), tabletUp: true });

  return (
    <section className="relative isolate flex h-[640px] w-full flex-col justify-end overflow-hidden bg-background tablet:h-[600px] xl:h-[760px]">
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

      {/* Signature duotone still-treatment. */}
      <div
        aria-hidden
        className="duotone-strong pointer-events-none absolute inset-0"
      />

      {/* Bottom scrim fading into the page background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to top, #0f0a07 4%, rgba(15,10,7,0.4) 40%, transparent 66%)",
        }}
      />
      {/* Left column scrim — tablet/desktop only (58% desktop, 70% tablet). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[70%] tablet:block xl:w-[58%]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(15,10,7,0.85), rgba(15,10,7,0.35), transparent)",
        }}
      />
      {/* Burgundy floor glow — mobile/tablet only (absent on desktop by design). */}
      <div
        aria-hidden
        className="glow-floor pointer-events-none absolute inset-0 xl:hidden"
      />

      {/* Content */}
      <div className="relative z-10 flex max-w-full flex-col gap-[13px] px-6 pb-7 tablet:max-w-[520px] tablet:gap-4 tablet:px-8 tablet:pb-13 xl:max-w-[680px] xl:gap-5 xl:px-12 xl:pb-[72px]">
        <span className="self-start rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream xl:text-[11px]">
          {t.hero.premiereBadge}
        </span>
        <h1 className="font-display text-[46px] uppercase leading-[1.0] tracking-[0.01em] text-cream tablet:text-[62px] xl:text-[84px] xl:leading-[0.98]">
          {title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-semibold text-cream/75 xl:gap-x-3 xl:text-sm">
          {meta.map((item, i) => (
            <Fragment key={item.label}>
              {i > 0 && (
                <MetaDot
                  className={cn(item.tabletUp && "hidden tablet:inline-block")}
                />
              )}
              <span
                className={cn(
                  item.capitalize && "capitalize",
                  item.tabletUp && "hidden tablet:inline",
                )}
              >
                {item.label}
              </span>
            </Fragment>
          ))}
        </div>
        {description && (
          <p className="hidden max-w-[480px] leading-relaxed text-cream/72 tablet:block tablet:text-sm xl:text-base">
            {description}
          </p>
        )}
        <div className="flex items-center gap-2.5 pt-1.5 tablet:gap-2.5">
          <Link
            href={`/watch/${slug}`}
            className="inline-flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-gold-cta px-8 text-[15px] font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform active:scale-[0.98] tablet:h-[52px] tablet:flex-none tablet:self-start xl:h-14 xl:px-10 xl:text-base"
          >
            <Icon name="play" size={17} color="#241205" />
            {paymentsOn ? t.hero.play : t.hero.watchFree}
          </Link>
          <Link
            href={`/shows/${slug}`}
            aria-label={t.hero.moreInfo}
            className="inline-flex size-[52px] shrink-0 items-center justify-center rounded-full border border-rust/60 bg-burgundy/45 text-cream backdrop-blur-xl transition-transform active:scale-[0.98] xl:size-14"
          >
            <Icon name="info" size={19} />
          </Link>
        </div>
      </div>
    </section>
  );
}
