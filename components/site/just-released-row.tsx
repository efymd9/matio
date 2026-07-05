import Link from "next/link";
import type { Show } from "@/db/schema";
import { toneFor } from "@/lib/design";
import { getDict } from "@/lib/i18n/server";
import { Poster } from "./poster";
import { SectionRow } from "./section-row";

// "Just released" rail — 2:3 posters with a burgundy "New" pill on shows
// actually flagged justReleased, plus title + genre caption below. Links to
// the show detail page.
export async function JustReleasedRow({ shows }: { shows: Show[] }) {
  const { t } = await getDict();
  return (
    <SectionRow label={t.home.justReleased}>
      <ul className="flex gap-4 px-5 pt-0.5 pb-2 tablet:px-8 xl:px-12">
        {shows.map((show) => (
          <li key={show.id} className="shrink-0">
            <Link
              href={`/shows/${show.slug}`}
              className="group flex w-[148px] flex-col gap-[9px] outline-none tablet:w-[164px] xl:w-[186px]"
            >
              <Poster
                imageUrl={show.posterImageUrl}
                tone={toneFor(show.slug || show.id)}
                title={show.title}
                badge={show.justReleased ? t.home.newBadge : null}
                rounded="card"
                className="aspect-[2/3] shadow-[0_14px_30px_-14px_rgba(0,0,0,0.8)] transition-transform duration-500 group-hover:scale-[1.02]"
              />
              <div className="flex flex-col gap-0.5 px-0.5">
                <p className="text-[13px] font-semibold leading-tight text-cream">
                  {show.title}
                </p>
                {show.genre[0] ? (
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-cream/40">
                    {show.genre[0]}
                  </p>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </SectionRow>
  );
}
