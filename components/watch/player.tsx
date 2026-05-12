"use client";

import MuxPlayer from "@mux/mux-player-react";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { saveTrialPosition, saveWatchProgress } from "@/app/watch/actions";
import { Paywall } from "./paywall";

type Mode = "subscriber" | "trial";

export function Player({
  episodeId,
  playbackId,
  title,
  mode,
  showSlug,
  resumeSeconds,
}: {
  episodeId: string;
  playbackId: string;
  title: string;
  mode: Mode;
  showSlug: string;
  resumeSeconds?: number | null;
}) {
  const ref = useRef<ComponentRef<typeof MuxPlayer>>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [paywall, setPaywall] = useState(false);
  const lastSavedRef = useRef<number>(0);

  // Fetch playback token on mount / when episode changes.
  useEffect(() => {
    let cancelled = false;
    setToken(null);
    setExpiresAt(null);
    setPaywall(false);
    fetch(
      `/api/playback-token?episode_id=${encodeURIComponent(episodeId)}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setPaywall(true);
          return;
        }
        const data = (await r.json()) as {
          token: string;
          expiresIn: number;
        };
        setToken(data.token);
        setExpiresAt(Date.now() + data.expiresIn * 1000);
      })
      .catch(() => {
        if (cancelled) return;
        setPaywall(true);
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  // When the token expires, try refreshing — subscribers get a new 1h token
  // and keep playing; trial users get 403, so we pause the player and show
  // the paywall. This stops a buffered-ahead stream from running past the
  // trial cut-off until the next page reload.
  useEffect(() => {
    if (!expiresAt) return;
    const ms = expiresAt - Date.now();
    if (ms <= 0) return;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/playback-token?episode_id=${encodeURIComponent(episodeId)}`,
          { cache: "no-store" },
        );
        if (r.ok) {
          const data = (await r.json()) as {
            token: string;
            expiresIn: number;
          };
          setToken(data.token);
          setExpiresAt(Date.now() + data.expiresIn * 1000);
          return;
        }
      } catch {
        // fall through to paywall
      }
      const el = ref.current;
      if (el) el.pause();
      setPaywall(true);
    }, ms);
    return () => clearTimeout(timer);
  }, [expiresAt, episodeId]);

  // Save position every 10s while playing.
  useEffect(() => {
    const interval = setInterval(() => {
      const el = ref.current;
      if (!el || el.paused) return;
      const t = Math.floor(el.currentTime ?? 0);
      if (t > 0 && t !== lastSavedRef.current) {
        lastSavedRef.current = t;
        const fn = mode === "trial" ? saveTrialPosition : saveWatchProgress;
        void fn(episodeId, t, false).catch(() => {});
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [episodeId, mode]);

  // Seek to resume position once the player has metadata.
  useEffect(() => {
    if (!token || !resumeSeconds || resumeSeconds <= 0) return;
    const el = ref.current;
    if (!el) return;
    const handler = () => {
      if ((el.currentTime ?? 0) < resumeSeconds) {
        el.currentTime = resumeSeconds;
      }
    };
    el.addEventListener("loadedmetadata", handler, { once: true });
    return () => el.removeEventListener("loadedmetadata", handler);
  }, [token, resumeSeconds]);

  if (paywall) {
    return (
      <Paywall
        showSlug={showSlug}
        resumeSeconds={lastSavedRef.current || resumeSeconds || undefined}
      />
    );
  }

  if (!token) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <MuxPlayer
      ref={ref}
      playbackId={playbackId}
      tokens={{ playback: token }}
      streamType="on-demand"
      metadata={{ video_id: episodeId, video_title: title }}
      onError={() => setPaywall(true)}
      onEnded={() => {
        const el = ref.current;
        if (!el) return;
        const t = Math.floor(el.duration ?? 0);
        const fn = mode === "trial" ? saveTrialPosition : saveWatchProgress;
        void fn(episodeId, t, true).catch(() => {});
      }}
      style={{ width: "100%", aspectRatio: "16 / 9" }}
    />
  );
}
