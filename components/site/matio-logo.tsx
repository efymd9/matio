import Image from "next/image";
import { cn } from "@/lib/utils";

// Natural pixel size of public/brand/matio-wordmark.png — the gold arched
// MATIO wordmark (client-provided, final). Rendering derives width from
// the requested height so the mark never distorts.
const WORDMARK_WIDTH = 2552;
const WORDMARK_HEIGHT = 1228;
const WORDMARK_RATIO = WORDMARK_WIDTH / WORDMARK_HEIGHT;

// Brand wordmark — the ONLY logo used in page chrome (header/footer/player
// watermark). The gold "M" blob mark is reserved for the favicon / app
// icons and never appears next to the wordmark.
//
// `size` is the rendered height in px (≈20–24 header, ≈16 footer).
// The legacy `color`/`accent`/`markOnly` props from the SVG-era logo are
// accepted and ignored so call sites can migrate incrementally — the
// wordmark is a fixed-color asset now.
export function MatioLogo({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
  color?: string;
  accent?: string;
  markOnly?: boolean;
}) {
  return (
    <Image
      src="/brand/matio-wordmark.png"
      alt="MATIO"
      width={Math.round(size * WORDMARK_RATIO)}
      height={size}
      className={cn("block w-auto select-none", className)}
      style={{ height: size }}
    />
  );
}
