"use client";

import { useState } from "react";
import { Icon } from "@/components/site/icon";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

// Circular share button — mirrors the burgundy "back" pill on the other
// top corner. Prefers the native share sheet; falls back to clipboard with
// a brief gold checkmark confirmation (no toast component, just an icon
// swap) when Web Share isn't available (most desktop browsers).
export function ShareButton({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch (err) {
        // User dismissed the native share sheet — not an error.
        if (err instanceof Error && err.name === "AbortError") return;
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unsupported or denied — nothing else we can do here.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={t.showDetail.shareAria}
      className={cn(
        "inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border border-rust/60 bg-burgundy/45 text-cream backdrop-blur-xl transition-transform active:scale-[0.92]",
        className,
      )}
    >
      <Icon
        name={copied ? "check" : "share"}
        size={18}
        color={copied ? "#e6b366" : "currentColor"}
      />
    </button>
  );
}
