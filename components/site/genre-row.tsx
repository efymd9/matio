import type { Show } from "@/db/schema";
import { ShowCard } from "./show-card";

export function GenreRow({
  genre,
  shows,
  priority = false,
}: {
  genre: string;
  shows: Show[];
  priority?: boolean;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3 px-6 sm:px-12">
        <h2 className="font-display text-3xl italic capitalize leading-none tracking-tight text-foreground/95">
          {genre}
        </h2>
        <div className="h-px flex-1 translate-y-[-0.4em] bg-gradient-to-r from-border/60 to-transparent" />
      </div>
      <div className="scrollbar-hidden overflow-x-auto">
        {/*  Padding on the inner row so hover-zoom isn't clipped at viewport edges. */}
        <ul className="flex gap-4 px-6 py-4 sm:px-12">
          {shows.map((show, i) => (
            <li key={show.id}>
              <ShowCard show={show} priority={priority && i < 4} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
