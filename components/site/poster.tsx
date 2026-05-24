import { cn } from "@/lib/utils";
import { TONE_GRADIENT, type Tone } from "@/lib/design";

// Visual placeholder that stands in for show artwork when none exists.
// Renders the show's deterministic tone gradient + a soft texture pass and
// (optionally) the show title floated bottom-left. When `imageUrl` is set,
// the image takes over and content (badge, kind) still overlays it.
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
  rounded?: "md" | "lg" | "xl" | "2xl";
}) {
  const radius =
    rounded === "md"
      ? "rounded-md"
      : rounded === "lg"
        ? "rounded-lg"
        : rounded === "xl"
          ? "rounded-xl"
          : "rounded-2xl";
  return (
    <div
      className={cn(
        "poster-texture relative isolate flex flex-col justify-end overflow-hidden text-white",
        radius,
        className,
      )}
      style={
        imageUrl ? undefined : { backgroundImage: TONE_GRADIENT[tone] }
      }
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
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
      ) : null}

      {badge ? (
        <span className="absolute left-2 top-2 z-10 rounded-[3px] bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-white backdrop-blur-md">
          {badge}
        </span>
      ) : null}

      {/* Title overlay only on placeholder posters — when we have artwork
          the image speaks for itself. Kind label rides above the title. */}
      {!imageUrl && showTitleOnPlaceholder ? (
        <div className="relative z-10 p-2.5">
          {kind ? (
            <div className="mb-0.5 text-[9px] font-medium uppercase tracking-[0.04em] text-white/60">
              {kind}
            </div>
          ) : null}
          <div className="text-xs font-bold leading-tight">{title}</div>
        </div>
      ) : null}
    </div>
  );
}
