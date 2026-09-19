// The Home feed under the app's cover carousel (#248, board 3 variant «c»
// Feed): which cards appear, in what order, with which badge. Pure and
// universal — the only imports are wire TYPES — so Metro bundles it through
// mobile/src/shared/home-feed.ts and vitest tests it here (mobile/ has no
// test runner; docs/mobile-app-plan.md §3), the same split as
// lib/catalog-filters.ts.
//
// The feed is ONE vertical list of typed items; the screen renders each by
// `kind` and never re-derives order or membership. The rules are the owner's
// decisions of 2026-09-19 and are fixed:
//   (i)   signed in with something to resume ⇒ an «Up next» heading and one
//         resume card per entry, in the server's order (freshest first);
//         an anonymous viewer gets none of this — and no sign-up card either.
//   (ii)  no show twice: what the resume cards show and the featured show
//         (it opens the carousel) never come back as a show card.
//   (iii) «Just released» heading + a card per justReleased show not already
//         seen, catalog order; no heading when there is nothing under it.
//   (iv)  the «Popular now» rail carries EVERY popularNow show (compact, so
//         no exclusions) and sits after the SECOND show card; with fewer
//         than two, right after the Just released block; no rail when
//         nothing is popular.
//   (v)   every other show, catalog order; a vertical one is badged so, a
//         just-released one is badged «new» even when vertical — one pill
//         per card, new wins.
//   (vi)  an empty catalog is an empty feed; the screen keeps its own
//         «catalog being curated» line.

import type { ContinueWatchingEntry, ShowSummary } from "./api/types";

export type HomeFeedItem =
  | { kind: "heading"; id: string; label: "upNext" | "justReleased" }
  | { kind: "resume"; id: string; entry: ContinueWatchingEntry }
  | { kind: "show"; id: string; show: ShowSummary; badge: "new" | "vertical" | null }
  | { kind: "rail"; id: string; label: "popularNow"; shows: ShowSummary[] };

// Ids are stable strings — the FlatList's keyExtractor reads them — so a
// catalog refresh that keeps the same shows keeps the same keys.
function showCard(show: ShowSummary, badge: "new" | "vertical" | null): HomeFeedItem {
  return { kind: "show", id: `show:${show.id}`, show, badge };
}

export function buildHomeFeed(input: {
  shows: ShowSummary[];
  resume: ContinueWatchingEntry[];
  signedIn: boolean;
}): HomeFeedItem[] {
  const { shows, resume, signedIn } = input;
  if (shows.length === 0) return [];

  const items: HomeFeedItem[] = [];
  const seen = new Set<string>();

  // (i) Up next. The resume set only counts as "seen" when its cards are
  // actually drawn: an anonymous viewer has nothing to resume by
  // construction (the hook answers [] signed out), and a show must never
  // vanish from the feed without a card somewhere.
  if (signedIn && resume.length > 0) {
    items.push({ kind: "heading", id: "heading:upNext", label: "upNext" });
    for (const entry of resume) {
      items.push({ kind: "resume", id: `resume:${entry.episodeId}`, entry });
      seen.add(entry.show.slug);
    }
  }

  // (ii) The featured show is the carousel's opening card.
  const featured = shows.find((s) => s.featured);
  if (featured) seen.add(featured.slug);

  // (iii) Just released.
  const fresh = shows.filter((s) => s.justReleased && !seen.has(s.slug));
  if (fresh.length > 0) {
    items.push({ kind: "heading", id: "heading:justReleased", label: "justReleased" });
    for (const show of fresh) items.push(showCard(show, "new"));
  }
  const afterJustReleased = items.length;

  // (v) The rest.
  for (const show of shows) {
    if (show.justReleased || seen.has(show.slug)) continue;
    items.push(showCard(show, show.orientation === "vertical" ? "vertical" : null));
  }

  // (iv) Popular now — placed last so the show cards it slots between exist.
  const popular = shows.filter((s) => s.popularNow);
  if (popular.length > 0) {
    let at = afterJustReleased;
    let cards = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "show" && ++cards === 2) {
        at = i + 1;
        break;
      }
    }
    items.splice(at, 0, { kind: "rail", id: "rail:popularNow", label: "popularNow", shows: popular });
  }

  return items;
}
