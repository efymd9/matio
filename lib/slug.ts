// Slug charset rule + generator, shared by the admin forms (client-side
// `pattern` attribute + auto-slugify from the title) and the admin server
// actions' validation — one constant so the two sides can't drift.
// Applies to shows.slug and actors.slug (public URL segments).
//
// Universal module: imported by both client components and "use server"
// actions. Keep it dependency-free.

// Source for the <input pattern> attribute (anchored implicitly by HTML).
export const SLUG_PATTERN = "[a-z0-9-]+";

const SLUG_RE = new RegExp(`^${SLUG_PATTERN}$`);

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// Russian → Latin transliteration for auto-slugify. The admin panel is
// staffed by Russian speakers — a Cyrillic title should still yield a
// usable slug instead of an empty string. Lowercase-only: input is
// lowercased before this map is applied.
const RU_TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

// Best-effort title → slug: lowercase, transliterate Cyrillic, fold Latin
// diacritics (QUÉDATE → quedate, via NFKD + stripping combining marks),
// collapse everything else into single hyphens. Can return "" (e.g. an
// all-CJK title) — callers must treat that as "no suggestion", not as a
// valid slug.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => RU_TRANSLIT[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
