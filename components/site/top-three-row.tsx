import Link from "next/link";
import type { Show } from "@/db/schema";
import { toneFor } from "@/lib/design";
import { getDict } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { Poster } from "./poster";
import { SectionRow } from "./section-row";

// "Top 3" rail — oversized Anton rank numerals (gold #1, burgundy #2/#3)
// hugging a 2:3 ranking poster. Links to the show detail page.
export async function TopThreeRow({ shows }: { shows: Show[] }) {
  const { t } = await getDict();
  return (
    <SectionRow label={t.home.top3}>
      <ol className="flex items-end gap-[22px] px-5 pt-1 pb-2 tablet:gap-[30px] tablet:px-8 xl:gap-11 xl:px-12">
        {shows.map((show, i) => (
          <li key={show.id} className="shrink-0">
            <Link
              href={`/shows/${show.slug}`}
              className="group flex items-end outline-none"
            >
              <span
                aria-hidden
                className={cn(
                  "relative z-[1] -mr-3.5 font-display leading-[0.8] text-[104px] tablet:-mr-[18px] tablet:text-[130px] xl:-mr-[22px] xl:text-[170px]",
                  i === 0 ? "text-gold" : "text-burgundy",
                )}
              >
                {i + 1}
              </span>
              <Poster
                imageUrl={show.posterImageUrl}
                tone={toneFor(show.slug || show.id)}
                title={show.title}
                rounded="card2xl"
                className="relative z-[2] aspect-[2/3] w-[136px] shadow-[0_18px_40px_-16px_rgba(0,0,0,0.8)] transition-transform duration-500 group-hover:scale-[1.02] tablet:w-[166px] xl:w-[200px]"
              />
            </Link>
          </li>
        ))}
      </ol>
    </SectionRow>
  );
}
