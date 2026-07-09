import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { actors, showActors, shows } from "@/db/schema";
import { getDict } from "@/lib/i18n/server";
import { SITE_URL, canonicalUrl } from "@/lib/seo";
import {
  breadcrumbJsonLd,
  jsonLdScript,
  personJsonLd,
} from "@/lib/structured-data";
import { Icon } from "@/components/site/icon";
import { Poster } from "@/components/site/poster";
import { toneFor } from "@/lib/design";

// Public virtual-actor profile: avatar, tagline, bio, and the published
// shows the actor appears in. Reachable from every show page's cast section
// (the hover card links here; on touch the tap navigates straight here).

// React cache() so generateMetadata + the page body share one SELECT —
// same idiom as lib/show-query.ts.
const getActorBySlug = cache(async (slug: string) => {
  const [actor] = await db
    .select()
    .from(actors)
    .where(eq(actors.slug, slug))
    .limit(1);
  return actor ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const actor = await getActorBySlug(slug);
  const { t } = await getDict();
  if (!actor) return { title: t.actorPage.notFound };
  const url = canonicalUrl(`/actors/${slug}`);
  const description = actor.bio ?? t.actorPage.metaDescription(actor.name);
  return {
    title: t.actorPage.metaTitle(actor.name),
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      url,
      title: actor.name,
      description,
      ...(actor.avatarImageUrl ? { images: [actor.avatarImageUrl] } : {}),
    },
    twitter: {
      card: "summary",
      title: actor.name,
      description,
    },
  };
}

export default async function ActorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { t } = await getDict();

  const actor = await getActorBySlug(slug);
  if (!actor) notFound();

  // Only published shows — the profile must never leak drafts.
  const appearances = await db
    .select({
      slug: shows.slug,
      title: shows.title,
      posterImageUrl: shows.posterImageUrl,
      characterName: showActors.characterName,
    })
    .from(showActors)
    .innerJoin(shows, eq(showActors.showId, shows.id))
    .where(
      and(
        eq(showActors.actorId, actor.id),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .orderBy(asc(shows.title));

  const breadcrumbLd = breadcrumbJsonLd([
    { name: t.showDetail.breadcrumbHome, url: SITE_URL },
    { name: actor.name, url: canonicalUrl(`/actors/${actor.slug}`) },
  ]);
  const personLd = personJsonLd({
    slug: actor.slug,
    name: actor.name,
    description: actor.bio,
    image: actor.avatarImageUrl,
  });

  return (
    <main className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(personLd) }}
      />

      <section className="px-6 pb-10 pt-[max(env(safe-area-inset-top),1rem)] tablet:px-10 tablet:pt-24 xl:px-14">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <Link
            href="/"
            aria-label={t.showDetail.breadcrumbHome}
            className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border border-rust/60 bg-burgundy/45 text-cream backdrop-blur-xl transition-transform active:scale-[0.92] tablet:hidden"
          >
            <Icon name="back" size={18} />
          </Link>

          <div className="flex flex-col items-start gap-5 tablet:flex-row tablet:items-center tablet:gap-8">
            <span className="relative block size-28 shrink-0 overflow-hidden rounded-full border border-rust/40 bg-espresso-2 tablet:size-36">
              {actor.avatarImageUrl ? (
                <Image
                  src={actor.avatarImageUrl}
                  alt={actor.name}
                  fill
                  priority
                  sizes="(max-width: 834px) 112px, 144px"
                  className="object-cover"
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center font-display text-4xl text-cream/30">
                  {actor.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <div className="flex min-w-0 flex-col gap-2.5">
              <span className="self-start rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
                {t.actorPage.virtualActor}
              </span>
              <h1 className="font-display text-[36px] uppercase leading-[1.0] tracking-[0.01em] text-cream tablet:text-[48px]">
                {actor.name}
              </h1>
              {actor.tagline ? (
                <p className="text-sm font-semibold text-gold">
                  {actor.tagline}
                </p>
              ) : null}
            </div>
          </div>

          {actor.bio ? (
            <p className="max-w-3xl text-sm leading-[1.6] text-cream/72">
              {actor.bio}
            </p>
          ) : null}
        </div>
      </section>

      <section className="px-6 pb-16 tablet:px-10 tablet:pb-20 xl:px-14">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-0.5 w-3.5 shrink-0 rounded-[1px] bg-rust xl:w-[18px]"
            />
            <h2 className="font-display text-base uppercase tracking-[0.12em] text-gold xl:text-xl">
              {t.actorPage.appearsIn}
            </h2>
          </div>
          {appearances.length === 0 ? (
            <p className="text-sm text-cream/55">{t.actorPage.noShowsYet}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 tablet:grid-cols-4 tablet:gap-4 xl:grid-cols-6">
              {appearances.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/shows/${s.slug}`}
                    className="group block transition-transform active:scale-[0.98]"
                  >
                    <Poster
                      imageUrl={s.posterImageUrl}
                      tone={toneFor(s.slug)}
                      title={s.title}
                      rounded="card"
                      className="aspect-[2/3] w-full transition-[filter] group-hover:brightness-110"
                    />
                    <p className="mt-1.5 truncate text-xs font-bold text-cream group-hover:text-gold">
                      {s.title}
                    </p>
                    {s.characterName ? (
                      <p className="truncate text-[10px] text-cream/50">
                        {t.showDetail.castAs(s.characterName)}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
