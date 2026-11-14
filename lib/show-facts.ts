// Universal + PURE: the facts a B2B page states about a show (#498) — the
// episode count and the run-time range — and the licensing cards built from
// the live catalogue. The server half (lib/show-facts-db.ts) only loads rows.

import type { LicensingTitle } from "./licensing";

export type EpisodeStats = {
  count: number;
  minSeconds: number | null;
  maxSeconds: number | null;
};

// "9 episodes · 9–24 min", "1 episode · 15 min", "3 episodes". Minutes are
// rounded; a range collapses when both ends round to the same minute.
export function formatEpisodeStats(s: EpisodeStats): string | null {
  if (s.count <= 0) return null;
  const eps = `${s.count} ${s.count === 1 ? "episode" : "episodes"}`;
  if (s.minSeconds == null || s.maxSeconds == null) return eps;
  const lo = Math.max(1, Math.round(s.minSeconds / 60));
  const hi = Math.max(1, Math.round(s.maxSeconds / 60));
  return `${eps} · ${lo === hi ? lo : `${lo}–${hi}`} min`;
}

// The catalogue row the cards read — the subset of `Show` they need.
export type CatalogShow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  genre: string[];
  posterImageUrl: string | null;
  heroImageUrl: string | null;
};

export type LicensingCard = {
  slug: string;
  title: string;
  logline: string | null;
  genres: string[];
  episodes: string | null;
  languages: readonly string[];
  format: string;
  trailerUrl: string | null;
  posterImageUrl: string | null;
};

// Only http(s) — the trailer link is drawn as an <a href>.
function safeUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// In the licensing list's order; a listed slug with no published show is
// skipped (it is not on offer to viewers either, and nothing about it is
// invented). Genres are de-duplicated case-insensitively — the admin types
// them freely ("dark Romance").
export function buildLicensingCards(
  titles: readonly LicensingTitle[],
  shows: readonly CatalogShow[],
  stats: ReadonlyMap<string, EpisodeStats>,
): LicensingCard[] {
  const bySlug = new Map(shows.map((s) => [s.slug, s]));
  const cards: LicensingCard[] = [];
  for (const t of titles) {
    const show = bySlug.get(t.slug);
    if (!show) continue;
    const seen = new Set<string>();
    const genres = show.genre
      .map((g) => g.trim())
      .filter((g) => g && !seen.has(g.toLowerCase()) && seen.add(g.toLowerCase()));
    cards.push({
      slug: show.slug,
      title: show.title,
      logline: show.description?.trim() || null,
      genres,
      episodes: formatEpisodeStats(stats.get(show.id) ?? { count: 0, minSeconds: null, maxSeconds: null }),
      languages: t.languages,
      format: t.format,
      trailerUrl: safeUrl(t.trailerUrl),
      posterImageUrl: show.posterImageUrl ?? show.heroImageUrl,
    });
  }
  return cards;
}
