import { cn } from "@/lib/utils";
import { TONE_GRADIENT, type Tone } from "@/lib/design";

// Corner radii. `card` = the redesign's 14px poster radius; `card2xl` bumps
// to 16px on desktop (ranking posters). The generic md/lg/xl/2xl stay for
// backward compatibility with any non-catalog caller.
type Rounded = "md" | "lg" | "xl" | "2xl" | "card" | "card2xl";
const RADIUS: Record<Rounded, string> = {
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  card: "rounded-[14px]",
  card2xl: "rounded-[14px] xl:rounded-2xl",
};

// Visual placeholder that stands in for show artwork when none exists.
// Renders the show's deterministic tone gradient + a soft gold texture pass
// and (optionally) the show title floated bottom-left. When `imageUrl` is
// set, the image takes over under the signature duotone-soft overlay, and
// content (badge, kind) still overlays it.
export function Poster({
  imageUrl,
  tone,
  title,
  kind,
  badge,
  className,
  showTitleOnPlaceholder = true,
  imgClassName,
  priority = false,
  rounded = "md",
}: {
  imageUrl?: string | null;
  tone: Tone;
  title: string;
  kind?: string | null;
  badge?: string | null;
  className?: string;
  showTitleOnPlaceholder?: boolean;
  imgClassName?: string;
  priority?: boolean;
  rounded?: Rounded;
}) {
  return (
    <div
      className={cn(
        "relative isolate flex flex-col justify-end overflow-hidden text-cream",
        // Gold radial texture only on placeholders — a real still carries the
        // duotone-soft treatment instead.
        !imageUrl && "poster-texture",
        RADIUS[rounded],
        className,
      )}
      style={imageUrl ? undefined : { backgroundImage: TONE_GRADIENT[tone] }}
    >
      {imageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={title}
            width={214}
            height={321}
            loading={priority ? "eager" : "lazy"}
            // aspect-[2/3] on the img itself, not just the parent. Without it,
            // landscape source images (e.g. Mux thumbnails set as
            // posterImageUrl: thumbnail.png?width=214&height=121) collapse to
            // their intrinsic ratio because `height: 100%` doesn't always
            // resolve against an aspect-ratio-derived parent height (Safari
            // < 16.4 most notably). Pinning the img's own aspect makes the box
            // 2:3 regardless of the source dimensions, then object-cover crops
            // to fill.
            className={cn(
              "absolute inset-0 aspect-[2/3] h-full w-full object-cover",
              imgClassName,
            )}
          />
          <div
            aria-hidden
            className="duotone-soft pointer-events-none absolute inset-0"
          />
        </>
      ) : null}

      {badge ? (
        <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-burgundy px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.1em] text-cream">
          {badge}
        </span>
      ) : null}

      {/* Title overlay only on placeholder posters — when we have artwork
          the image speaks for itself. Kind label rides above the title. */}
      {!imageUrl && showTitleOnPlaceholder ? (
        <div className="relative z-10 p-3.5">
          {kind ? (
            <div className="mb-0.5 text-[9px] font-medium uppercase tracking-[0.04em] text-cream/60">
              {kind}
            </div>
          ) : null}
          <div className="text-[15px] font-bold leading-tight">{title}</div>
        </div>
      ) : null}
    </div>
  );
}
