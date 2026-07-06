"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminT } from "@/lib/i18n/admin-client";

// Clipboard copy with a transient "copied" confirmation. Falls back to a
// hidden-textarea execCommand copy where the async Clipboard API is
// unavailable (non-secure contexts, older WebKit).
export function CopyButton({ value, name }: { value: string; name: string }) {
  const t = useAdminT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={t.links.copyAria(name)}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
        copied
          ? "bg-gold/15 text-gold"
          : "bg-white/[0.06] text-cream/70 hover:bg-white/[0.1] hover:text-cream"
      }`}
    >
      {copied ? `${t.links.copied} ✓` : t.links.copy}
    </button>
  );
}
