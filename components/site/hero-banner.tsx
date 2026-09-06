"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { Fragment, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  HERO_SCRIM_BOTTOM,
  HERO_SCRIM_SIDE,
  TONE_GRADIENT,
  toneFor,
} from "@/lib/design";
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

// Where the player asks for a fresh preview token once the server-rendered
// one has expired (app/api/hero-preview-token/route.ts). That token lives
// HERO_PREVIEW_TTL_SECONDS (60s) while the teaser loops for as long as the
// visitor stays — without a refresh the stream died after ~90s and the hero
// sat on an empty background for the rest of the visit (issue #128).
const HERO_PREVIEW_TOKEN_PATH = "/api/hero-preview-token";
// Each fresh token buys one more cycle (60s of TTL plus whatever hls.js had
// buffered). A tab parked on `/` for a day would otherwise call the route
// forever; after this many cycles the hero rests on the backdrop instead.
const MAX_TOKEN_REFRESHES = 20;

// What `<mux-player>` hands its `error` listeners. @mux/playback-core builds a
// MediaError — `{ code, fatal, muxCode, … }` — and dispatches it as
// `CustomEvent("error", { detail })`; @mux/mux-video re-dispatches it through
// the shadow roots with the same detail (dist/base.mjs, `handleEvent`). The
// player's OWN handler ignores everything that is not fatal —
// `if (!(a?.fatal)) { warn(a); return; }` (@mux/mux-player dist/base.mjs) —
// because recoverable errors DO come through: playback-core's "Attempting to
// reconnect..." is dispatched with `fatal: false` while hls.js retries. Mirror
// the library: a non-fatal error is its business, and reacting to it is how
// the teaser used to vanish for good.
type PlayerError = { code?: number; fatal?: boolean };

function isFatalPlayerError(event: Event): boolean {
  const detail = (event as CustomEvent<unknown>).detail;
  // The native `error` event carries no detail; the element still exposes the
  // error object, which is where the library's handler reads it too.
  const target = event.currentTarget as { media?: { error?: unknown } } | null;
  const raw = detail ?? target?.media?.error;
  if (typeof raw !== "object" || raw === null) return false;
  const { code, fatal } = raw as PlayerError;
  // MediaError derives `fatal` from the code when its constructor is not told:
  // 2 (NETWORK) … 5 (ENCRYPTED) are fatal, 1 (ABORTED) is not
  // (@mux/playback-core dist/index.mjs, `class MediaError`).
  return fatal ?? (typeof code === "number" && code >= 2 && code <= 5);
}

// `exp` of the compact JWT (seconds since the epoch, RFC 7519 §4.1.4) — the
// only question is whether the token's clock has run out. playback-core does
// this same parse to label a 403 "token expired" on the hls.js path
// (muxCode NETWORK_TOKEN_EXPIRED); reading it ourselves also covers Safari's
// native HLS path, where no such label is ever attached.
function tokenExpired(token: string | null, now = Date.now()): boolean {
  if (!token) return false;
  try {
    const [, payload = ""] = token.split(".");
    const { exp } = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: unknown };
    return typeof exp === "number" && exp * 1000 <= now;
  } catch {
    return false;
  }
}

// Best-effort by design: anything but a fresh token for THIS playback id
// (route down, featured show changed meanwhile, public asset with no token)
// leaves the hero on the backdrop — never a throw, never a Sentry event.
async function fetchFreshPreviewToken(
  playbackId: string,
): Promise<string | null> {
  try {
    const res = await fetch(HERO_PREVIEW_TOKEN_PATH, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { playbackId?: unknown; token?: unknown };
    return body.playbackId === playbackId && typeof body.token === "string"
      ? body.token
      : null;
  } catch {
    return null;
  }
}

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
  // No player mounted: after a fatal error, and for the round-trip to a fresh
  // token. The backdrop stands in either way — see handlePlayerError.
  const [videoFailed, setVideoFailed] = useState(false);
  // What the CURRENT player instance plays with: the server-rendered token
  // first, then whatever the token route hands back once that one expires.
  const [token, setToken] = useState(previewToken);
  const tokenRefreshes = useRef(0);
  const tokenRefreshInFlight = useRef(false);
  const backdrop = heroImageUrl ?? posterImageUrl;
  const tone = toneFor(slug);
  const t = useT();
  // The hero autoplays on every home visit (pre-consent), so Mux Data here must
  // be gated: no env key / no consent → disableTracking + disableCookies, no
  // beacons. MuxPlayer is dynamic(ssr:false) so the consent value is settled
  // before it mounts.
  const muxDataEnabled = useMarketingConsent() && !!MUX_DATA_ENV_KEY;

  // Consent flipping mid-playback REMOUNTS the player (see the `key` below).
  // Reset the "video is covering the backdrop" flag in the same breath, or the
  // backdrop stays at opacity-0 while the fresh instance is still loading and
  // the hero shows ~half a second of empty background. Render-phase adjustment,
  // not an effect — React 19's react-hooks/set-state-in-effect forbids the
  // effect form (same pattern as the watch player's per-episode visual reset).
  const [prevMuxDataEnabled, setPrevMuxDataEnabled] = useState(muxDataEnabled);
  if (prevMuxDataEnabled !== muxDataEnabled) {
    setPrevMuxDataEnabled(muxDataEnabled);
    setVideoPlaying(false);
  }

  // Issue #128: `onError` used to hide the player for good on ANY error and
  // left `videoPlaying` set — so a recoverable hiccup, or the 60s token dying
  // under the looping teaser, collapsed the hero into an empty background
  // until the next page load.
  const handlePlayerError = (event: Event) => {
    // Recoverable: hls.js is retrying and the player itself just logs and
    // moves on. Touching state here is exactly the old bug.
    if (!isFatalPlayerError(event)) return;
    // Fatal: the backdrop comes back to full opacity and the dead instance
    // goes (it has the library's error dialog up by now).
    setVideoPlaying(false);
    setVideoFailed(true);
    // The one fatal error that is ours to fix: the preview token ran out. Ask
    // for a fresh one and remount; every other failure stays on the backdrop.
    if (
      !previewPlaybackId ||
      !tokenExpired(token) ||
      tokenRefreshInFlight.current ||
      tokenRefreshes.current >= MAX_TOKEN_REFRESHES
    ) {
      return;
    }
    tokenRefreshes.current += 1;
    tokenRefreshInFlight.current = true;
    void fetchFreshPreviewToken(previewPlaybackId).then((fresh) => {
      tokenRefreshInFlight.current = false;
      if (!fresh) return;
      setToken(fresh);
      setVideoFailed(false);
    });
  };

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
          // Consent changes REMOUNT this player instead of mutating the live
          // element. `disable-tracking` / `env-key` are the only props that
          // ever change on a mounted <mux-player>, and @mux/mux-video handles
          // that attribute by tearing the stream down and restarting it —
          // `unload(); …then(() => { currentTime = t; play() })` with **no
          // .catch** (dist/base.mjs, case DISABLE_TRACKING). If the flip lands
          // while a play() is pending, Chrome rejects it with
          // "AbortError: The play() request was interrupted by a new load
          // request", which surfaces as an unhandled rejection in Sentry
          // (issue #126, seen in production 24.08.2026).
          //
          // A remount does the same teardown honestly, with no dangling
          // promise. Do NOT "simplify" this away, and do NOT freeze consent in
          // a mount-time snapshot instead: live consent is what stops beacons
          // the moment a viewer withdraws it (the AUDIT.md H2 leak).
          key={muxDataEnabled ? "mux-data-on" : "mux-data-off"}
          playbackId={previewPlaybackId}
          tokens={token ? { playback: token } : undefined}
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
          onError={handlePlayerError}
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
          backgroundImage: HERO_SCRIM_BOTTOM,
        }}
      />
      {/* Left column scrim — tablet/desktop only (58% desktop, 70% tablet). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[70%] tablet:block xl:w-[58%]"
        style={{
          backgroundImage: HERO_SCRIM_SIDE,
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
            className="inline-flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-gold-cta px-8 text-[15px] font-extrabold text-gold-deep shadow-cta transition-transform active:scale-[0.98] tablet:h-[52px] tablet:flex-none tablet:self-start xl:h-14 xl:px-10 xl:text-base"
          >
            <Icon name="play" size={17} />
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
