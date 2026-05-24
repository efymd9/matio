import Link from "next/link";
import type { Show } from "@/db/schema";
import { Poster } from "./poster";
import { toneFor } from "@/lib/design";
import { cn } from "@/lib/utils";

// Vertical poster card for catalog rows. Two sizes:
//   default — 105×150 (compact dense rows)
//   big     — 130×185 (featured / "new" rows)
// Hover lifts and reveals a subtle gradient + title for keyboard parity.
export function ShowCard({
  show,
  priority = false,
  size = "default",
}: {
  show: Show;
  priority?: boolean;
  size?: "default" | "big";
}) {
  const tone = toneFor(show.slug || show.id);
  const dimensions =
    size === "big"
      ? "w-[130px] sm:w-[150px]"
      : "w-[105px] sm:w-[120px]";
  return (
    <Link
      href={`/shows/${show.slug}`}
      className={cn(
        // Scale-up is desktop-only via Tailwind's hover: (already gated
        // to @media hover:hover). Touch devices skip the lift to avoid
        // iOS sticky-hover where a tapped card stays scaled after
        // navigation.
        "group relative block shrink-0 outline-none transition-transform duration-500 ease-out hover:z-10 hover:scale-[1.05] focus-visible:scale-[1.05]",
        dimensions,
      )}
    >
      <Poster
        imageUrl={show.posterImageUrl}
        tone={tone}
        title={show.title}
        kind={show.genre[0] ?? null}
        priority={priority}
        className="aspect-[2/3] shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.06] transition-shadow duration-500 group-hover:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9)] group-hover:ring-white/15"
        showTitleOnPlaceholder
      />
      {/* Label for image posters (placeholder posters carry their own
          title baked in, so we only show this when we have artwork).
          Visible by default on touch devices (no :hover state to reveal
          it) and on focus-visible; animates in on hover for desktop. */}
      {show.posterImageUrl ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-md bg-gradient-to-t from-black/85 to-transparent p-2 transition-all duration-300 opacity-0 translate-y-1 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 pointer-coarse:opacity-100 pointer-coarse:translate-y-0">
          <p className="text-[11px] font-semibold leading-tight text-white">
            {show.title}
          </p>
          {show.genre.length > 0 ? (
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.06em] text-white/70">
              {show.genre.slice(0, 2).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
