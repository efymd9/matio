"use client";

import { useEffect, useState } from "react";

// A vertical (portrait) show uses the TikTok-style minimal player, but only on
// mobile-width viewports. On wider screens a vertical asset already renders
// well in the standard player (it letterboxes into a centred column via the
// player's dynamic aspect ratio), so desktop keeps the familiar chrome.
//
// 768px catches phones in portrait and most phones in landscape; tablets and
// desktops fall through to the standard player. The decision is client-only
// (matchMedia), which is fine: the player chrome only renders after the
// client-side token fetch, so there's no SSR markup to mismatch, and it
// self-heals on rotation / resize via the change listener.
const MOBILE_QUERY = "(max-width: 768px)";

export function useVerticalLayout(
  orientation: "horizontal" | "vertical",
): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (orientation !== "vertical") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [orientation]);

  return orientation === "vertical" && isMobile;
}
