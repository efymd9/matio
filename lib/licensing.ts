// The titles Matio offers for licensing on /licensing (#498). Universal.
//
// This list — not the viewer catalogue — decides what a buyer sees: a title
// leaves /licensing by losing its row here, and stays on the site for
// viewers. The reverse holds too: a row whose show is not published (or is
// soft-deleted) is not drawn, because the poster, the logline and the
// episode facts are read from the live catalogue (lib/licensing-catalog.ts)
// and nothing about a title is invented here.
//
// What the catalogue does not know lives on the row, and only the team
// fills it in, when it confirms the title: the languages a buyer can get it
// in, the delivery format and, if there is one, a PUBLIC trailer link. Rights
// by territory and term are never listed — the team answers them per request.
//
// EMPTY until the team confirms the first titles (docs/registry.md, #498):
// the page then says the catalogue is being prepared and the form still
// takes a general enquiry.

export type LicensingTitle = {
  /** shows.slug of a published show. */
  slug: string;
  /** e.g. ["English (original)", "Spanish subtitles"]. */
  languages: readonly string[];
  /** e.g. "Scripted series · 16:9 · 4K". */
  format: string;
  /** A public trailer URL (YouTube / Vimeo), never a private screener. */
  trailerUrl?: string;
};

export const LICENSING_TITLES: readonly LicensingTitle[] = [];

export const LICENSING_SLUGS: readonly string[] = LICENSING_TITLES.map((t) => t.slug);
