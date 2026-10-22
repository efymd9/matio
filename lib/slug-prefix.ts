// A truncated show link (#469). YouTube shortened the channel / description
// link `https://matio.tv/shows/the-scarlet-oath` to the literal
// `/shows/the-scarlet-oa..`, and that link has spread through comments and
// reposts where nobody can fix it — 28% of all visitors in 30 days landed on
// the 404. Instead, the show page answers a slug that is a prefix of exactly
// ONE published slug with a 308 to the real path, query kept. Prefix only —
// no similarity search (by spec): a prefix two shows share, or one too short
// to mean anything, stays a 404.
//
// Universal + PURE: no env, no DB, no Next import. The page hands in the slugs
// (lib/catalog.ts:getPublishedShows(), already cached under the `catalog` tag
// — the redirect costs no query of its own).

// Shorter than this is not a truncated link: `the-` would match every
// "the-…" show, and a 404 says more than a guess.
export const SLUG_PREFIX_MIN_LENGTH = 6;

// What the truncation leaves behind — trailing `.`, `..`, `…` (U+2026) in any
// mix — and letter case: slugs are lowercase by charset rule
// (lib/slug.ts:SLUG_PATTERN), a retyped link may not be.
export function normalizeSlugPrefix(raw: string): string {
  return raw.toLowerCase().replace(/[.…]+$/u, "");
}

// The one published slug `raw` is a prefix of, or null: no match, two or more,
// a prefix under SLUG_PREFIX_MIN_LENGTH — or `raw` already IS a slug, which
// is the page's own job (a 308 onto itself would loop).
export function resolveSlugByPrefix(
  raw: string,
  slugs: readonly string[],
): string | null {
  if (slugs.includes(raw)) return null;
  const prefix = normalizeSlugPrefix(raw);
  if (prefix.length < SLUG_PREFIX_MIN_LENGTH) return null;
  const matches = slugs.filter((slug) => slug.startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

// Next 16 resolves a page's `searchParams` to this shape (a repeated key is an
// array). The 308 carries the whole query over: `?utm_*` / `?fbclid` must
// reach the real page, where proxy.ts does the cookie work — the same
// principle as the /es → bare 308 (#445).
export type PageSearchParams = Record<string, string | string[] | undefined>;

export function withSearchParams(
  path: string,
  searchParams: PageSearchParams,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (value !== undefined) {
      query.append(key, value);
    }
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}
