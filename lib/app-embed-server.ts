import "server-only";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import { APP_EMBED_HEADER, APP_EMBED_VALUE } from "./app-embed";

// Is this render the app's embed variant of a legal document (#310)? Only
// proxy.ts sets the header, and only on /terms, /privacy and /cookies (+ /es)
// with `?embed=app` — see lib/app-embed.ts. One read per request, shared by
// the layout, the page and its cross-links.
export const isAppEmbed = cache(async (): Promise<boolean> => {
  return (await headers()).get(APP_EMBED_HEADER) === APP_EMBED_VALUE;
});

// The legal pages' robots. The embed variant is a second URL of the same
// document, so it stays out of the index; its canonical (localeAlternates,
// never the query) already names the normal page.
export async function legalPageRobots(): Promise<NonNullable<Metadata["robots"]>> {
  return (await isAppEmbed())
    ? { index: false, follow: true }
    : { index: true, follow: true };
}
