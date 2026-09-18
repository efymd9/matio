// Pure catalog filter rules behind the app's Browse tab: genre chips from the
// admin's free-text `genre[]`, and title search. Universal — no imports — so
// Metro bundles it through mobile/src/shared/catalog-filters.ts and vitest
// tests it here (mobile/ has no test runner; docs/mobile-app-plan.md §3).
//
// Why the genre rule is CLIENT-side and not in /v1/catalog: the wire contract
// is permanent (a shipped build keeps reading it for months), while the
// admin's genre strings are free text — "dark Romance", "Drama", "drama",
// "Sci-Fi" all exist in production today. Folding them into one chip is a
// presentation decision an app update can revise; baking a normalised list
// into the contract would freeze it. Same reasoning as keeping the raw
// `episodes.access` on the wire (lib/api/types.ts).

export type GenreChip = { key: string; label: string };

// The identity of a genre: trimmed, lower-cased, inner whitespace collapsed.
// "dark Romance" and " Dark  romance " are the same chip.
export function normalizeGenreKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

// What the chip prints: the key with its first letter capitalised, nothing
// else touched — "dark romance" → "Dark romance". The admin's own casing is
// deliberately not preserved: it is what fragments the chips in the first
// place.
export function genreLabel(key: string): string {
  if (!key) return "";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// One chip per distinct genre key, in order of first appearance across the
// catalog (so the chips are stable between launches as long as the catalog
// order is). Empty and whitespace-only genres are dropped.
export function genreChips(shows: readonly { genre: readonly string[] }[]): GenreChip[] {
  const seen = new Set<string>();
  const chips: GenreChip[] = [];
  for (const show of shows) {
    for (const raw of show.genre) {
      const key = normalizeGenreKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      chips.push({ key, label: genreLabel(key) });
    }
  }
  return chips;
}

// Case- and accent-insensitive: NFD splits "é" into "e" + a combining mark,
// which the Diacritic class then removes — so "quedate" finds "Quédate".
function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Substring match on the folded title. An empty (or whitespace-only) query
// matches everything — the grid shows the whole catalog until the viewer
// types.
export function matchesQuery(title: string, query: string): boolean {
  const needle = foldForSearch(query);
  if (!needle) return true;
  return foldForSearch(title).includes(needle);
}

// The chip row is single-select: the whole catalog, one genre, or the
// vertical shows. A discriminated union rather than a bare key so a genre
// literally named "all" or "vertical" cannot collide with the two fixed chips.
export type ChipSelection =
  | { kind: "all" }
  | { kind: "vertical" }
  | { kind: "genre"; key: string };

// The Browse result set: the chip AND the query. Generic over the row so the
// app passes its ShowSummary DTOs straight through and gets them back typed.
export function filterShows<
  T extends { title: string; genre: readonly string[]; orientation: string },
>(shows: readonly T[], chip: ChipSelection, query: string): T[] {
  return shows.filter((show) => {
    if (chip.kind === "vertical" && show.orientation !== "vertical") return false;
    if (
      chip.kind === "genre" &&
      !show.genre.some((raw) => normalizeGenreKey(raw) === chip.key)
    ) {
      return false;
    }
    return matchesQuery(show.title, query);
  });
}
