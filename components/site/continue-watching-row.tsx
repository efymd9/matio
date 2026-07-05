import Image from "next/image";
import Link from "next/link";
import type { ContinueWatchingItem } from "@/lib/continue-watching";
import { TONE_GRADIENT, toneFor } from "@/lib/design";
import { getDict } from "@/lib/i18n/server";
import { Icon } from "./icon";
import { SectionRow } from "./section-row";

// "Continue watching" rail — 16:9 tiles showing show hero art with a resume
// progress bar. Rendered only when there's something to resume (the caller
// checks for a non-empty list).
export async function ContinueWatchingRow({
  items,
}: {
  items: ContinueWatchingItem[];
}) {
  const { t } = await getDict();
  return (
    <SectionRow label={t.home.continueWatching}>
      <ul className="flex gap-3 px-5 pt-0.5 pb-1.5 tablet:gap-[14px] tablet:px-8 xl:gap-4 xl:px-12">
        {items.map((item) => {
          const art = item.show.heroImageUrl ?? item.show.posterImageUrl;
          const tone = toneFor(item.show.slug);
          return (
            <li key={item.show.slug} className="shrink-0">
              <Link
                // ?ep= pins the watch page to the episode this tile promises
                // — without it the page falls back to its own default episode.
                href={`/watch/${item.show.slug}?ep=${item.episodeId}`}
                className="group flex w-[220px] flex-col gap-2 outline-none tablet:w-[260px] tablet:gap-[9px] xl:w-[310px] xl:gap-2.5"
              >
                <div className="relative aspect-video overflow-hidden rounded-[14px] shadow-[0_14px_30px_-14px_rgba(0,0,0,0.8)] xl:rounded-2xl">
                  {art ? (
                    <Image
                      src={art}
                      alt=""
                      aria-hidden
                      fill
                      sizes="(min-width: 1280px) 310px, (min-width: 834px) 260px, 220px"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div
                      className="absolute inset-0"
                      style={{ backgroundImage: TONE_GRADIENT[tone] }}
                    />
                  )}
                  <div
                    aria-hidden
                    className="duotone pointer-events-none absolute inset-0"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <span className="flex size-10 items-center justify-center rounded-full bg-burgundy/80 backdrop-blur-md tablet:size-11 xl:size-12">
                      <Icon name="play" size={15} color="#f6efe4" />
                    </span>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-[3px] bg-cream/20 xl:h-1">
                    <div
                      className="h-full bg-rust"
                      style={{ width: `${item.fraction * 100}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-baseline justify-between px-0.5">
                  <p className="truncate text-xs font-semibold text-cream tablet:text-[13px] xl:text-sm">
                    {item.show.title}
                  </p>
                  <p className="ml-2 shrink-0 text-[10px] font-semibold text-cream/45 tablet:text-[11px] xl:text-xs">
                    {t.home.epShort(item.episodeNumber)}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </SectionRow>
  );
}
