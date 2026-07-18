"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Fires the first-party visit beacon (/api/t) on every route change.
// Consent-exempt audience measurement — see lib/visitor-cookie.ts. Renders
// nothing; mounted once in the root layout. Crawlers never run this (no
// JS) and Next.js route prefetches never mount it, so a beacon means a
// real page view in a real browser. document.referrer keeps the original
// external referrer across client-side navigations, which is exactly what
// the write-once first-visit meta wants.
export function VisitBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    try {
      const payload = JSON.stringify({
        p: pathname,
        r: document.referrer || "",
        q: window.location.search || "",
      });
      const blob = new Blob([payload], { type: "application/json" });
      if (!navigator.sendBeacon?.("/api/t", blob)) {
        void fetch("/api/t", {
          method: "POST",
          body: payload,
          headers: { "content-type": "application/json" },
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // measurement must never break the page
    }
  }, [pathname]);

  return null;
}
