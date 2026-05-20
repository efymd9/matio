import type { Show } from "@/db/schema";
import { getDict } from "@/lib/i18n/server";
import { ShowCard } from "./show-card";

export async function GenreRow({
  genre,
  shows,
  priority = false,
  size = "default",
}: {
  genre: string;
  shows: Show[];
  priority?: boolean;
  size?: "default" | "big";
}) {
  const { t } = await getDict();
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between px-6 sm:px-12">
        <h2 className="text-lg font-bold capitalize leading-none tracking-tight text-white sm:text-xl">
          {genre}
        </h2>
        <span className="text-[11px] font-medium text-white/45 transition-colors hover:text-white/80">
          {t.genreRow.seeAll}
        </span>
      </div>
      <div className="scrollbar-hidden overflow-x-auto">
        <ul className="flex gap-3 px-6 py-3 sm:px-12">
          {shows.map((show, i) => (
            <li key={show.id}>
              <ShowCard
                show={show}
                priority={priority && i < 4}
                size={size}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
