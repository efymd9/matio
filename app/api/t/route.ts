import type { NextRequest } from "next/server";
import { userAgent } from "next/server";
import { normalizeUtm, normalizeUtmSource } from "@/lib/utm";
import { recordVisitorDay } from "@/lib/visitor";
import { isValidAid, VISITOR_COOKIE } from "@/lib/visitor-cookie";

export const runtime = "nodejs";

// First-party visit beacon ("t" for tracking). Called by VisitBeacon via
// navigator.sendBeacon on every route change. The aid comes ONLY from the
// httpOnly cookie (never the body), so a hostile client can dirty its own
// visit row and nothing else. Always 204 — a beacon has no reader, and an
// analytics failure must never surface as a network error in the console.
//
// Body (JSON): { p: pathname, r: document.referrer, q: location.search }.
// r/q are used exclusively for the write-once first-visit meta on the
// visitors row; the per-day flags derive from p alone.
export async function POST(req: NextRequest) {
  try {
    const aid = req.cookies.get(VISITOR_COOKIE)?.value;
    if (!isValidAid(aid)) return new Response(null, { status: 204 });
    if (userAgent({ headers: req.headers }).isBot) {
      return new Response(null, { status: 204 });
    }

    const body: unknown = await req.json().catch(() => null);
    const get = (k: string): string =>
      body && typeof body === "object" && typeof (body as Record<string, unknown>)[k] === "string"
        ? ((body as Record<string, unknown>)[k] as string)
        : "";

    const path = get("p").slice(0, 200);
    // Only site-relative document paths count as visits; the client already
    // skips /admin but a forged post shouldn't be able to log it either.
    if (!path.startsWith("/") || path.startsWith("/admin")) {
      return new Response(null, { status: 204 });
    }

    const search = get("q").slice(0, 500);
    const params = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    );

    await recordVisitorDay(
      aid,
      {
        landedHome: path === "/",
        showViewed: path.startsWith("/shows/") || path.startsWith("/watch/"),
      },
      {
        firstPath: path,
        referrer: get("r"),
        utmSource: normalizeUtmSource(params.get("utm_source")) ?? null,
        utmMedium: normalizeUtm(params.get("utm_medium")) ?? null,
        utmCampaign: normalizeUtm(params.get("utm_campaign")) ?? null,
        country: req.headers.get("x-vercel-ip-country"),
      },
    );
  } catch {
    // best-effort by contract
  }
  return new Response(null, { status: 204 });
}
