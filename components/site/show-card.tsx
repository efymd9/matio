import Link from "next/link";
import type { Show } from "@/db/schema";

export function ShowCard({
  show,
  priority = false,
}: {
  show: Show;
  priority?: boolean;
}) {
  return (
    <Link
      href={`/shows/${show.slug}`}
      className="group relative block w-44 shrink-0 outline-none transition-transform duration-500 ease-out hover:z-10 hover:scale-[1.07] focus-visible:scale-[1.07] sm:w-52"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-muted shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)] ring-1 ring-border/60 transition-all duration-500 group-hover:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9)] group-hover:ring-accent/60 group-focus-visible:ring-accent/70">
        {show.posterImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={show.posterImageUrl}
            alt={show.title}
            loading={priority ? "eager" : "lazy"}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted via-card to-background p-5 text-center">
            <span className="font-display text-lg italic leading-tight text-foreground/70">
              {show.title}
            </span>
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        <div className="absolute inset-x-0 bottom-0 translate-y-2 p-3 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
          <p className="font-display text-base italic leading-tight text-foreground">
            {show.title}
          </p>
          {show.genre.length > 0 && (
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-accent/90">
              {show.genre.slice(0, 2).join(" · ")}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
