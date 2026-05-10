import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { shows, type Show } from "@/db/schema";

const UNCATEGORIZED = "Uncategorized";

export default async function HomePage() {
  const published = await db
    .select()
    .from(shows)
    .where(and(eq(shows.status, "published"), isNull(shows.deletedAt)))
    .orderBy(asc(shows.title));

  if (published.length === 0) {
    return (
      <div className="mx-auto flex max-w-5xl flex-1 items-center justify-center px-4 py-16">
        <p className="text-muted-foreground">No shows published yet.</p>
      </div>
    );
  }

  // One show may appear in multiple genre rows.
  const byGenre = new Map<string, Show[]>();
  for (const show of published) {
    const genres = show.genre.length > 0 ? show.genre : [UNCATEGORIZED];
    for (const g of genres) {
      const list = byGenre.get(g) ?? [];
      list.push(show);
      byGenre.set(g, list);
    }
  }

  // Stable order: alphabetical, with Uncategorized last.
  const sortedGenres = [...byGenre.keys()].sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-10 px-4 py-8 sm:px-8">
      {sortedGenres.map((genre) => (
        <section key={genre} className="space-y-3">
          <h2 className="text-xl font-semibold capitalize">{genre}</h2>
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-8 sm:px-8">
            <ul className="flex gap-4 pb-2">
              {byGenre.get(genre)!.map((show) => (
                <li key={show.id} className="shrink-0">
                  <Link
                    href={`/shows/${show.slug}`}
                    className="block w-44 sm:w-52"
                  >
                    <div className="aspect-[2/3] overflow-hidden rounded-md bg-muted">
                      {show.posterImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={show.posterImageUrl}
                          alt={show.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center p-3 text-center text-sm text-muted-foreground">
                          {show.title}
                        </div>
                      )}
                    </div>
                    <p className="mt-2 truncate text-sm font-medium">
                      {show.title}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
