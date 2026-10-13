import { APP_EMBED_PARAM, APP_EMBED_VALUE } from "@/shared/app-embed";

// A legal document as Settings and the sign-in form open it (#310): the
// site's embed variant — the document alone, with no site header (its
// Subscribe link is a purchase outside the App Store) and no trackers — at
// the English URL /v1/config sends (the site and the app are English-only,
// #445 / #447). /v1/config already sends the embed URLs; the parameter is
// added here too so this build does not depend on the server for it, and
// never twice. The query and fragment stay where they were. Anything that is
// not an absolute http(s) URL is returned untouched.
export function legalUrl(url: string): string {
  const match = /^(https?:\/\/[^?#]+)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match) return url;
  const [, base, query = "", hash = ""] = match;
  const pair = `${APP_EMBED_PARAM}=${APP_EMBED_VALUE}`;
  if (query.slice(1).split("&").includes(pair)) return url;
  return `${base}${query.length > 1 ? `${query}&` : "?"}${pair}${hash}`;
}
